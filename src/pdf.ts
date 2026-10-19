import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import type { CompileResult } from "./compiler.js";
import { FONT_FILES, SERIF_STACK, fontDirectory, fontFaceCss, missingFontFiles } from "./fonts.js";

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

const PAGE_SIZES = new Set(["A3", "A4", "A5", "B4", "B5", "JIS-B4", "JIS-B5", "letter", "legal", "ledger"]);
const ORIGIN = "http://marktexset.invalid";

function pageSize(value: unknown): string {
  return typeof value === "string" && PAGE_SIZES.has(value) ? value : "A4";
}

// Vivliostyle floats `.mathmd-footnote` spans to the page bottom, so each first
// reference is replaced by its note text and later references repeat the number.
function inlineFootnotes(html: string): string {
  const notes = new Map<string, string>();
  const section = html.match(/<hr class="footnotes-sep">\s*<section class="footnotes">[\s\S]*?<\/section>\s*/);
  if (!section) return html;
  for (const item of section[0].matchAll(/<li id="fn(\d+)" class="footnote-item">([\s\S]*?)<\/li>/g)) {
    const body = item[2].replace(/\s*<a href="#fnref[^"]*" class="footnote-backref">[^<]*<\/a>/g, "").replace(/<p>/g, "<span class=\"mathmd-footnote-paragraph\">").replace(/<\/p>/g, "</span>").trim();
    notes.set(item[1], body);
  }
  const used = new Set<string>();
  return html.replace(section[0], "").replace(/<sup class="footnote-ref"><a href="#fn(\d+)" id="fnref[^"]*">[^<]*<\/a><\/sup>/g, (match, id: string) => {
    const note = notes.get(id);
    if (note === undefined) return match;
    if (used.has(id)) return "<sup class=\"mathmd-footnote-repeat\">" + id + "</sup>";
    used.add(id);
    return "<span class=\"mathmd-footnote\">" + note + "</span>";
  });
}

// A page style marker placed right before page breaks applies to the page that follows them.
function bindPageStyleMarkers(html: string): string {
  const breaks = "(?:\\s*<div class=\"mathmd-directive mathmd-pagebreak\"[^>]*><\\/div>)+";
  return html.replace(new RegExp("(<div class=\"mathmd-directive mathmd-pagestyle\" data-name=\"[^\"]*\"><\\/div>)(" + breaks + ")", "g"), "$2$1");
}

export function pdfHtml(html: string, config: Record<string, any>, baseDirectory: string): string {
  const margins = pageMargins(config.layout?.margins);
  const size = pageSize(config.layout?.size);
  const pageNumber = config.layout?.page?.number?.visible === false ? "none" : pageContent(config) || "none";
  const css = `<style data-mathmd-style-origin="pdf">
${fontFaceCss((file) => ORIGIN + "/fonts/" + encodeURIComponent(file))}
@page { size: ${size}; margin: ${margins}; font-family: ${SERIF_STACK}; @top-center { content: string(mathmd-section, first); font-size: 9pt; } @bottom-center { content: ${pageNumber}; font-size: 9pt; } }
html, body { margin: 0 !important; max-width: none !important; }
body { font-size: 10pt; line-height: 1.4; }
body:lang(ja) { line-height: 1.7; }
p { margin: 0; orphans: 2; widows: 2; }
p + p { text-indent: 1.5em; }
:lang(ja) p + p { text-indent: 1em; }
:lang(ja) h1 + p, :lang(ja) h2 + p, :lang(ja) h3 + p, :lang(ja) h4 + p, :lang(ja) h5 + p, :lang(ja) h6 + p { text-indent: 1em; }
li > p, td > p, th > p, .figure p { text-indent: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.6em; }
h1 { font-size: 1.44em; } h2 { font-size: 1.2em; } h3, h4, h5, h6 { font-size: 1em; }
.math-block, .callout, .figure, .code-block, table, .tikzcd, ul, ol, dl { margin-top: 0.7em; margin-bottom: 0.7em; }
.mathml, mjx-assistive-mml { position: absolute !important; width: 1px !important; height: 1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; white-space: nowrap !important; }
.math-svg { display: inline; }
.code-copy { display: none !important; }
pre, table, .callout, .math-block, img, .figure, .tikzcd { break-inside: avoid; max-width: 100%; }
pre, .code-block pre { white-space: pre-wrap; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; }
h1, h2 { string-set: mathmd-section content(text); }
.mathmd-pagebreak { break-before: page; height: 0; }
.mathmd-footnote { float: footnote; font-size: 0.8em; line-height: 1.4; text-align: justify; }
.mathmd-footnote-paragraph + .mathmd-footnote-paragraph { display: block; }
.mathmd-footnote::footnote-call, .mathmd-footnote-repeat { font-size: 0.7em; vertical-align: super; line-height: 0; }
.mathmd-footnote::footnote-marker { content: counter(footnote) ". "; }
</style>`;
  const prepared = bindPageStyleMarkers(inlineFootnotes(html));
  return embedLocalImages(prepared.replace("</head>", css + "</head>"), baseDirectory);
}

function viewerHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style>
<script>var module={exports:{}},exports=module.exports;</script><script src="${ORIGIN}/vivliostyle.js"></script>
<script>window.vivliostyle=module.exports;</script></head><body><div id="viewport"></div><script>
window.__mathmd={done:false,error:null};
var viewer=new vivliostyle.CoreViewer({viewportElement:document.getElementById("viewport"),window:window,debug:false},{});
viewer.addListener("readystatechange",function(){if(viewer.readyState==="complete")window.__mathmd.done=true;});
viewer.addListener("error",function(event){var detail=event&&event.content;window.__mathmd.error=String(detail&&(detail.message||detail.error&&detail.error.message)||"Vivliostyle failed");});
viewer.loadDocument({url:"${ORIGIN}/document.html"},{},{});
</script></body></html>`;
}

export interface LayoutDiagnostic { code: string; message: string; }

async function paginate(page: Page, result: CompileResult, sourceFile: string): Promise<void> {
  const documentHtml = pdfHtml(result.html, result.config, path.dirname(sourceFile));
  const vivliostyle = fs.readFileSync(require.resolve("@vivliostyle/core"), "utf8");
  // Serve everything from a private origin; nothing reaches the network.
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url === ORIGIN + "/viewer.html") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: viewerHtml() });
    if (url === ORIGIN + "/document.html") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: documentHtml });
    if (url === ORIGIN + "/vivliostyle.js") return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: vivliostyle });
    const font = FONT_FILES.find((item) => url === ORIGIN + "/fonts/" + encodeURIComponent(item.file));
    const fontPath = font && path.join(fontDirectory(), font.file);
    if (fontPath && fs.existsSync(fontPath)) return route.fulfill({ status: 200, contentType: "font/otf", body: fs.readFileSync(fontPath) });
    return route.abort();
  });
  await page.goto(ORIGIN + "/viewer.html");
  await page.waitForFunction(() => (window as any).__mathmd.done || (window as any).__mathmd.error, undefined, { timeout: 120_000 });
  const error = await page.evaluate(() => (window as any).__mathmd.error as string | null);
  if (error) throw new Error("Vivliostyle pagination failed: " + error);
  await page.evaluate(() => document.fonts.ready);
  await applyPageStyles(page, String(result.config.layout?.page?.style ?? "plain"));
}

// Page styles follow LaTeX's \pagestyle: a marker switches the style from its page onward.
async function applyPageStyles(page: Page, initial: string): Promise<void> {
  await page.evaluate((initialStyle) => {
    let style = initialStyle;
    for (const container of document.querySelectorAll<HTMLElement>("[data-vivliostyle-page-container]")) {
      const markers = container.querySelectorAll<HTMLElement>(".mathmd-pagestyle");
      if (markers.length) style = markers[markers.length - 1].getAttribute("data-name") ?? style;
      if (!["empty", "plain", "headings"].includes(style)) style = "plain";
      container.setAttribute("data-mathmd-page-style", style);
      const header = container.querySelector<HTMLElement>("[data-vivliostyle-page-margin-box=top-center]");
      const footer = container.querySelector<HTMLElement>("[data-vivliostyle-page-margin-box=bottom-center]");
      if (header && style !== "headings") header.style.visibility = "hidden";
      if (footer && style === "empty") footer.style.visibility = "hidden";
    }
  }, initial);
}

async function readLayoutDiagnostics(page: Page): Promise<LayoutDiagnostic[]> {
  return page.evaluate(() => {
    const diagnostics: Array<{ code: string; message: string }> = [];
    for (const container of document.querySelectorAll<HTMLElement>("[data-vivliostyle-page-container]")) {
      const area = container.querySelector<HTMLElement>("[data-vivliostyle-page-area]");
      if (!area) continue;
      const areaRect = area.getBoundingClientRect();
      for (const element of area.querySelectorAll<HTMLElement>("pre, table, .math-block, img")) {
        const rect = element.getBoundingClientRect();
        const longPreformattedLine = element.tagName === "PRE" && (element.textContent ?? "").split("\n").some((line) => line.length > 120);
        if (rect.right > areaRect.right + 1 || rect.left < areaRect.left - 1 || rect.bottom > areaRect.bottom + 1 || element.scrollWidth > element.clientWidth + 1 || longPreformattedLine) {
          diagnostics.push({ code: "LAYOUT_OVERFLOW", message: `${element.tagName.toLowerCase()} exceeds the page content area.` });
        }
      }
      const blocks = [...area.querySelectorAll<HTMLElement>("body > *, [data-vivliostyle-column] > * > *")].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !element.closest(".mathmd-footnote");
      });
      for (let i = 0; i < blocks.length; i++) {
        const a = blocks[i].getBoundingClientRect();
        for (let j = i + 1; j < blocks.length; j++) {
          if (blocks[i].contains(blocks[j]) || blocks[j].contains(blocks[i])) continue;
          const b = blocks[j].getBoundingClientRect();
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) diagnostics.push({ code: "LAYOUT_OVERLAP", message: "Block elements overlap on a page." });
        }
      }
      if (!area.textContent?.trim() && !area.querySelector("svg, img, table")) diagnostics.push({ code: "EMPTY_PAGE", message: "A blank page was generated." });
    }
    return diagnostics;
  });
}

async function withPaginatedPage<T>(result: CompileResult, sourceFile: string, action: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
    await paginate(page, result, sourceFile);
    return await action(page);
  } finally {
    await browser.close();
  }
}

function fontDiagnostics(): LayoutDiagnostic[] {
  const missing = missingFontFiles();
  return missing.length ? [{ code: "FONT_NOT_INSTALLED", message: "Default fonts are not installed (" + missing.map((font) => font.file).join(", ") + "); falling back to system fonts. Run 'marktexset fonts install'." }] : [];
}

export async function inspectLayout(result: CompileResult, sourceFile: string): Promise<LayoutDiagnostic[]> {
  return [...fontDiagnostics(), ...await withPaginatedPage(result, sourceFile, readLayoutDiagnostics)];
}

export async function renderPdf(result: CompileResult, output: string, sourceFile: string): Promise<void> {
  await withPaginatedPage(result, sourceFile, async (page) => {
    for (const diagnostic of [...fontDiagnostics(), ...await readLayoutDiagnostics(page)]) result.diagnostics.warning(diagnostic.code, diagnostic.message);
    await page.pdf({ path: output, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  });
  if (!fs.existsSync(output)) throw new Error("Chromium did not create the PDF output.");
}
