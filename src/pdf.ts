import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import type { CompileResult } from "./compiler.js";

const require = createRequire(import.meta.url);

function cssLength(value: unknown): string {
  return typeof value === "string" && /^(?:0|[0-9]+(?:\.[0-9]+)?)(?:mm|cm|in|pt)$/.test(value) ? value : "25mm";
}

function pageMargins(value: unknown): string {
  if (!value || typeof value === "string") return cssLength(value ?? "25mm");
  if (typeof value !== "object" || Array.isArray(value)) return "25mm";
  const margins = value as Record<string, unknown>;
  return [margins.top, margins.right, margins.bottom, margins.left].map((item) => cssLength(item ?? "25mm")).join(" ");
}

function pageContent(config: Record<string, any>): string {
  const format = String(config.layout?.page?.number?.format ?? "{page.arabic}");
  const parts = format.split("{page.arabic}");
  const tokens: string[] = [];
  parts.forEach((part, index) => {
    if (part) tokens.push(`"${part.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`);
    if (index < parts.length - 1) tokens.push("counter(page)");
  });
  return tokens.join(" ");
}

function embedLocalImages(html: string, baseDirectory: string): string {
  return html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (match, prefix: string, source: string, suffix: string) => {
    if (/^(?:data:|https?:|#)/i.test(source)) return match;
    const file = path.resolve(baseDirectory, source);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return match;
    const extension = path.extname(file).toLowerCase();
    const mime = extension === ".svg" ? "image/svg+xml" : extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "application/octet-stream";
    return prefix + "data:" + mime + ";base64," + fs.readFileSync(file).toString("base64") + suffix;
  });
}

function pdfHtml(html: string, config: Record<string, any>, baseDirectory: string): string {
  const margins = pageMargins(config.layout?.margins);
  const pageNumber = config.layout?.page?.number?.visible === false ? "none" : pageContent(config);
  const phaseTwoCss = `<style>
@page { size: A4; margin: ${margins}; @bottom-center { content: ${pageNumber}; font: 10pt serif; } }
html, body { margin: 0 !important; max-width: none !important; }
body { font-family: serif; }
.mathmd-pagebreak { break-before: page; page-break-before: always; height: 0; }
.mathmd-pagestyle[data-name="empty"] { break-after: avoid; }
 .mathml, mjx-assistive-mml { position: absolute !important; width: 1px !important; height: 1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; white-space: nowrap !important; }
.math-svg { display: inline; }
.math-block { break-inside: avoid; }
pre, table, .callout, .math-block, img { break-inside: avoid; max-width: 100%; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
p { break-inside: avoid; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; }
.table-of-contents { break-inside: avoid; }
@media print { .mathmd-pagebreak { break-before: page; page-break-before: always; } }
</style>`;
  return embedLocalImages(html.replace("<head>", "<head><base href=\"" + pathToFileURL(baseDirectory + path.sep).href + "\">").replace("</head>", phaseTwoCss + "</head>"), baseDirectory);
}

export interface LayoutDiagnostic { code: string; message: string; }

async function preparePagedPage(page: Page, result: CompileResult, sourceFile: string): Promise<void> {
  await page.setContent(pdfHtml(result.html, result.config, path.dirname(sourceFile)), { waitUntil: "load" });
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.addEventListener("load", () => resolve(), { once: true }); image.addEventListener("error", () => resolve(), { once: true }); }))));
  const pagedPath = path.resolve(path.dirname(require.resolve("pagedjs")), "../dist/paged.polyfill.js");
  await page.addScriptTag({ path: pagedPath });
  await page.waitForFunction(() => document.querySelectorAll(".pagedjs_page").length > 0, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready);
  let previousPageCount = -1;
  let stableCycles = 0;
  for (let cycle = 0; cycle < 300 && stableCycles < 3; cycle++) {
    const pageCount = await page.locator(".pagedjs_page").count();
    if (pageCount === previousPageCount) stableCycles++;
    else { previousPageCount = pageCount; stableCycles = 0; }
    if (stableCycles < 3) await page.waitForTimeout(100);
  }
}

async function readLayoutDiagnostics(page: Page): Promise<LayoutDiagnostic[]> {
  return page.evaluate(() => {
      const diagnostics: Array<{ code: string; message: string }> = [];
      const pages = [...document.querySelectorAll<HTMLElement>(".pagedjs_page")];
      for (const page of pages) {
        const content = page.querySelector<HTMLElement>(".pagedjs_page_content") ?? page;
        const pageRect = content.getBoundingClientRect();
        for (const element of [...content.querySelectorAll<HTMLElement>("pre, table, .math-block, img")]) {
          const rect = element.getBoundingClientRect();
          const longPreformattedLine = element.tagName === "PRE" && [...(element.textContent ?? "").split("\n")].some((line) => line.length > 120);
          if (rect.right > pageRect.right + 1 || rect.left < pageRect.left - 1 || rect.bottom > pageRect.bottom + 1 || element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1 || longPreformattedLine) {
            diagnostics.push({ code: "LAYOUT_OVERFLOW", message: `${element.tagName.toLowerCase()} exceeds the page content area.` });
          }
        }
        const blocks = [...content.children].map((element) => element as HTMLElement).filter((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
        for (let i = 0; i < blocks.length; i++) {
          const a = blocks[i].getBoundingClientRect();
          for (let j = i + 1; j < blocks.length; j++) {
            const b = blocks[j].getBoundingClientRect();
            const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
            if (overlap) diagnostics.push({ code: "LAYOUT_OVERLAP", message: "Block elements overlap on a page." });
          }
        }
        if (!content.textContent?.trim() && !content.querySelector("svg, img, table")) diagnostics.push({ code: "EMPTY_PAGE", message: "A blank page was generated." });
      }
      return diagnostics;
    });
}

export async function inspectLayout(result: CompileResult, sourceFile: string): Promise<LayoutDiagnostic[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
    await preparePagedPage(page, result, sourceFile);
    return await readLayoutDiagnostics(page);
  } finally {
    await browser.close();
  }
}

export async function renderPdf(result: CompileResult, output: string, sourceFile: string): Promise<void> {
  const layoutDiagnostics = await inspectLayout(result, sourceFile);
  for (const diagnostic of layoutDiagnostics) result.diagnostics.warning(diagnostic.code, diagnostic.message);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
    await preparePagedPage(page, result, sourceFile);
    await page.pdf({ path: output, format: "A4", printBackground: true, displayHeaderFooter: false, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
  } finally {
    await browser.close();
  }
  if (!fs.existsSync(output)) throw new Error("Chromium did not create the PDF output.");
}
