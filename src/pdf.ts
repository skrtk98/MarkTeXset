import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { chromium, type Page } from "playwright";
import type { CompileResult } from "./compiler.js";
import { SERIF_STACK, ensureTrueTypeFonts, fontFaceCss, missingFontFiles, resolveFontRequest } from "./fonts.js";
import { breakParagraphs } from "./linebreak.js";

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

function pageContent(config: Record<string, any>, style?: string): string {
  const format = String(config.layout?.page?.number?.format ?? "{page.arabic}");
  const styles: Record<string, string> = { arabic: "decimal", roman: "lower-roman", Roman: "upper-roman", alph: "lower-alpha", Alph: "upper-alpha" };
  const parts = format.split(/\{page\.([A-Za-z]+)\}/);
  const tokens: string[] = [];
  parts.forEach((part, index) => {
    if (index % 2 === 1) tokens.push("counter(page, " + (style ?? styles[part] ?? "decimal") + ")");
    else if (part) tokens.push(`"${part.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`);
  });
  return tokens.join(" ");
}

// The table of contents prints the page counter in the style of the page number format, without its other text, like \thepage.
function pageNumberStyle(config: Record<string, any>): string {
  return String(config.layout?.page?.number?.format ?? "{page.arabic}").match(/\{page\.([A-Za-z]+)\}/)?.[1] ?? "arabic";
}

const COUNTER_STYLES: Record<string, string> = { arabic: "decimal", roman: "lower-roman", Roman: "upper-roman", alph: "lower-alpha", Alph: "upper-alpha" };

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

const PAGE_WIDTHS: Record<string, string> = { A3: "297mm", A4: "210mm", A5: "148mm", B4: "250mm", B5: "176mm", "JIS-B4": "257mm", "JIS-B5": "182mm", letter: "8.5in", legal: "8.5in", ledger: "11in" };

function contentWidth(config: Record<string, any>): string {
  const margins = pageMargins(config.layout?.margins).split(" ");
  const [right, left] = margins.length === 4 ? [margins[1], margins[3]] : [margins[0], margins[0]];
  return "calc(" + PAGE_WIDTHS[pageSize(config.layout?.size)] + " - " + left + " - " + right + ")";
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

// A chapter or the contents of a report or book starts a page anyway, so a page break right before it would
// leave an empty page; LaTeX's \newpage before \chapter has no effect either.
function dropBreaksBeforeChapters(html: string, config: Record<string, any>): string {
  if (config.layout?.class !== "report" && config.layout?.class !== "book") return html;
  const directives = "(?:<div class=\"mathmd-directive [^\"]*\"[^>]*><\\/div>\\s*)*";
  return html.replace(new RegExp("(?:<div class=\"mathmd-directive mathmd-pagebreak\"[^>]*><\\/div>\\s*)+(?=" + directives + "(?:<h1\\b[^>]*\\bclass=\"chapter|<nav class=\"table-of-contents\"))", "g"), "");
}

// <frontmatter />, <mainmatter />, and <backmatter /> each start a section that runs to the next one,
// so the front matter can have its own page numbering.
function wrapMatter(html: string): string {
  const directive = /<div class="mathmd-directive mathmd-(frontmatter|mainmatter|backmatter)"><\/div>/;
  const start = html.search(/<body\b/);
  const end = html.lastIndexOf("</body>");
  if (start < 0 || end < 0 || !directive.test(html)) return html;
  const open = html.indexOf(">", start) + 1;
  const parts = html.slice(open, end).split(new RegExp(directive.source));
  let body = parts[0];
  for (let index = 1; index < parts.length; index += 2) body += "<div class=\"mathmd-matter mathmd-" + parts[index] + "\">" + parts[index + 1] + "</div>";
  return html.slice(0, open) + body + html.slice(end);
}

// report and book follow LaTeX: chapters start a new page (a right-hand page in a book), the title gets a page
// of its own, and a book sets running heads on facing pages and numbers its front matter with roman numerals.
function chapterCss(config: Record<string, any>, pageNumber: string): string {
  const documentClass = config.layout?.class;
  if (documentClass !== "report" && documentClass !== "book") return "";
  const book = documentClass === "book";
  const opening = book ? "right" : "page";
  const margins = config.layout?.margins;
  const mirrored = book && margins && typeof margins === "object" ? `@page :left { margin-left: ${cssLength(margins.right ?? "25mm")}; margin-right: ${cssLength(margins.left ?? "25mm")}; }` : "";
  const front = config.layout?.page?.number?.visible === false ? "none" : pageContent(config, "lower-roman") || "none";
  return `
h1.chapter { break-before: ${opening}; font-size: 2.488em; line-height: 1.2; margin: 50pt 0 40pt; }
h1.chapter .heading-number { display: block; font-size: 0.833em; margin-bottom: 20pt; }
h2 { font-size: 1.44em; } h3 { font-size: 1.2em; } h4, h5, h6 { font-size: 1em; }
h1 { string-set: mathmd-chapter content(text), mathmd-section content(text); }
.table-of-contents { break-before: ${opening}; }
.toc-title { font-size: 2.488em; line-height: 1.2; margin: 50pt 0 40pt; }
.document-title { page: mathmd-title; break-after: ${opening}; padding-top: 60pt; }
.document-title + *, .mathmd-mainmatter { counter-reset: page 1; }
.mathmd-frontmatter { page: mathmd-front; }
@page mathmd-title { @top-center { content: none; } @top-left { content: none; } @top-right { content: none; } @bottom-center { content: none; } }
@page mathmd-front { @bottom-center { content: ${front}; } }
@page :blank { @top-center { content: none; } @top-left { content: none; } @top-right { content: none; } @bottom-center { content: none; } }
${book ? `@page :left { @top-center { content: none; } @top-left { content: ${pageNumber}; font-size: 9pt; } @top-right { content: string(mathmd-chapter, first); font-size: 9pt; font-style: italic; } }
@page :right { @top-center { content: none; } @top-left { content: string(mathmd-section, first); font-size: 9pt; font-style: italic; } @top-right { content: ${pageNumber}; font-size: 9pt; } }
@page mathmd-front:left { @top-left { content: ${front}; } }
@page mathmd-front:right { @top-right { content: ${front}; } }
${mirrored}` : ""}
@page mathmd-front:blank { @top-left { content: none; } @top-right { content: none; } @bottom-center { content: none; } }`;
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
table, .callout, .math-block, img, .figure, .tikzcd { break-inside: avoid; max-width: 100%; }
/* Like LaTeX's default [tbp] placement: a figure goes to the top of its page, or of the next page when it does not fit. */
.figure { float: top; float-reference: page; margin: 0 auto 1.4em; }
/* Code may break across pages like a verbatim block, keeping at least three lines on each side. */
.code-block, .callout { break-inside: auto; }
pre, .code-block pre, .code-content { max-width: 100%; overflow: visible; orphans: 3; widows: 3; }
.code-header, .callout-title { break-after: avoid; }
pre, .code-block pre { white-space: pre-wrap; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; }
h1, h2 { string-set: mathmd-section content(text); }
.mathmd-table { margin-left: auto; margin-right: auto; }
/* booktabs rules, as in Pandoc's LaTeX tables; :where() keeps them below any user table style. */
:where(.mathmd-table) { border-collapse: collapse; border-top: 0.08em solid; border-bottom: 0.08em solid; }
:where(.mathmd-table thead tr:last-child > th) { border-bottom: 0.05em solid; }
:where(.mathmd-table th, .mathmd-table td) { padding: 0.1em 0.5em; }
:where(.mathmd-table th) { text-align: left; }
.table-caption { caption-side: top; margin-bottom: 0.5em; text-align: center; }
.figure-caption, .table-caption { font-size: 1em; }
.document-title-heading { font-size: 1.728em; line-height: 1.25; margin: 0 0 0.6em; }
.document-title .author, .document-title .date { font-size: 1.2em; }
.table-of-contents { border: none !important; padding: 0 !important; background: none !important; }
.toc-list { list-style: none; padding-left: 0; }
.toc-list li { display: flex; align-items: baseline; }
.toc-list .toc-level-2 { padding-left: 1.5em; } .toc-list .toc-level-3 { padding-left: 3em; } .toc-list .toc-level-4, .toc-list .toc-level-5, .toc-list .toc-level-6 { padding-left: 4.5em; }
.toc-list a { color: inherit; text-decoration: none; display: flex; flex: 1; align-items: baseline; }
.toc-list a::after { content: target-counter(attr(href url), page, ${COUNTER_STYLES[pageNumberStyle(config)] ?? "decimal"}); flex: none; padding-left: 0.5em; }
.toc-list a::before { content: ""; order: 1; flex: 1; border-bottom: 1px dotted; margin: 0 0.3em; }
.toc-list a::after { order: 2; }
.toc-list .toc-level-1 { font-weight: bold; margin-top: 0.5em; }
.toc-list .toc-level-1 > a::before { border-bottom: none; }
.mathmd-pagebreak { break-before: page; height: 0; }
.mathmd-footnote { float: footnote; font-size: 0.8em; line-height: 1.4; text-align: justify; }
.mathmd-footnote-paragraph + .mathmd-footnote-paragraph { display: block; }
.mathmd-line .mathmd-footnote { white-space: normal; text-align-last: auto; text-indent: 0; word-spacing: normal; }
.mathmd-footnote::footnote-call, .mathmd-footnote-repeat { font-size: 0.7em; vertical-align: super; line-height: 0; }
.mathmd-footnote::footnote-marker { content: counter(footnote) ". "; }
${chapterCss(config, pageNumber)}
</style>`;
  // The title is not a section: keep it out of the PDF outline, the tag tree's headings, and the running head.
  const titled = html.replace(/<h1 class="document-title-heading">([\s\S]*?)<\/h1>/, "<div class=\"document-title-heading\">$1</div>");
  const prepared = wrapMatter(dropBreaksBeforeChapters(bindPageStyleMarkers(inlineFootnotes(titled)), config)).replace(/(<ul class="toc-list">[\s\S]*?<\/ul>)/, (list) => list.replace(/<a href="#([^"]+)"/g, "<a href=\"#$1\" data-mathmd-toc-target=\"$1\""));
  return embedLocalImages(prepared.replace("</head>", css + "</head>"), baseDirectory);
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Chromium takes the PDF's /Lang and document title from the viewer page, not from the paginated document.
function viewerHtml(config: Record<string, any>): string {
  const title = config.meta?.title ? "<title>" + escapeText(String(config.meta.title)) + "</title>" : "";
  return `<!doctype html><html lang="${escapeText(String(config.meta?.language ?? "en"))}"><head><meta charset="utf-8">${title}<style>html,body{margin:0;padding:0}</style>
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
  let documentHtml = pdfHtml(result.html, result.config, path.dirname(sourceFile));
  const vivliostyle = fs.readFileSync(require.resolve("@vivliostyle/core"), "utf8");
  // Serve everything from a private origin; nothing reaches the network.
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url === ORIGIN + "/viewer.html") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: viewerHtml(result.config) });
    if (url === ORIGIN + "/document.html") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: documentHtml });
    if (url === ORIGIN + "/measure.html") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: documentHtml.replace("</head>", "<style id=\"mathmd-measure\">body { width: " + contentWidth(result.config) + " !important; }</style></head>") });
    if (url === ORIGIN + "/vivliostyle.js") return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: vivliostyle });
    const fontPath = url.startsWith(ORIGIN + "/fonts/") ? resolveFontRequest(decodeURIComponent(url.slice((ORIGIN + "/fonts/").length))) : undefined;
    if (fontPath) return route.fulfill({ status: 200, contentType: fontPath.endsWith(".ttf") ? "font/ttf" : "font/otf", body: fs.readFileSync(fontPath) });
    return route.abort();
  });
  if ((result.config.layout?.["line-break"] ?? "optimal") === "optimal") {
    // Choose line breaks on a single-column copy of the document at the page's text width, then paginate the result.
    await page.goto(ORIGIN + "/measure.html");
    await page.evaluate(() => document.fonts.ready);
    await breakParagraphs(page);
    documentHtml = "<!doctype html>\n" + await page.evaluate(() => { document.getElementById("mathmd-measure")?.remove(); return document.documentElement.outerHTML; });
  }
  await page.goto(ORIGIN + "/viewer.html");
  await page.waitForFunction(() => (window as any).__mathmd.done || (window as any).__mathmd.error, undefined, { timeout: 120_000 });
  const error = await page.evaluate(() => (window as any).__mathmd.error as string | null);
  if (error) throw new Error("Vivliostyle pagination failed: " + error);
  await page.evaluate(() => document.fonts.ready);
  await applyPageStyles(page, String(result.config.layout?.page?.style ?? "plain"), result.config.layout?.class === "book");
  if (result.config.layout?.class === "report" || result.config.layout?.class === "book") await numberTocEntries(page, pageNumberStyle(result.config));
}

// Page styles follow LaTeX's \pagestyle: a marker switches the style from its page onward.
// A book's running heads sit in the top corners and replace the page number at the bottom,
// except on a chapter's opening page, which is plain as with LaTeX's \chapter.
async function applyPageStyles(page: Page, initial: string, book: boolean): Promise<void> {
  await page.evaluate(({ initialStyle, book }) => {
    let style = initialStyle;
    for (const container of document.querySelectorAll<HTMLElement>("[data-vivliostyle-page-container]")) {
      const markers = container.querySelectorAll<HTMLElement>(".mathmd-pagestyle");
      if (markers.length) style = markers[markers.length - 1].getAttribute("data-name") ?? style;
      if (!["empty", "plain", "headings"].includes(style)) style = "plain";
      const pageStyle = book && style === "headings" && container.querySelector("h1.chapter, .toc-title") ? "plain" : style;
      container.setAttribute("data-mathmd-page-style", pageStyle);
      const headers = container.querySelectorAll<HTMLElement>("[data-vivliostyle-page-margin-box=top-center], [data-vivliostyle-page-margin-box=top-left], [data-vivliostyle-page-margin-box=top-right]");
      const footer = container.querySelector<HTMLElement>("[data-vivliostyle-page-margin-box=bottom-center]");
      if (pageStyle !== "headings") for (const header of headers) header.style.visibility = "hidden";
      if (footer && (pageStyle === "empty" || book && pageStyle === "headings")) footer.style.visibility = "hidden";
    }
  }, { initialStyle: initial, book });
}

// Vivliostyle's target-counter() keeps the reset value of the page counter for every heading after a reset,
// so a report or book, which restarts page numbers after the title and the front matter, fills them in itself.
async function numberTocEntries(page: Page, style: string): Promise<void> {
  await page.evaluate((style) => {
    // No named functions here: the test runner's transpiler would wrap them in a helper the page does not have.
    const numerals = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const;
    const numbers = new Map<string, string>();
    let value = 0;
    let afterTitle = false;
    let mainmatter = false;
    for (const container of document.querySelectorAll<HTMLElement>("[data-vivliostyle-page-container]")) {
      value++;
      const area = container.querySelector<HTMLElement>("[data-vivliostyle-page-area]");
      const filled = Boolean(area?.textContent?.trim() || area?.querySelector("svg, img, table"));
      // The element after the title and the main matter each restart the count on the page where they begin.
      if (afterTitle && filled) { value = 1; afterTitle = false; }
      if (!mainmatter && container.querySelector(".mathmd-mainmatter")) { value = 1; mainmatter = true; }
      if (container.querySelector(".document-title")) afterTitle = true;
      // Front matter is numbered in lowercase roman numerals, as with LaTeX's \frontmatter.
      const format = container.querySelector(".mathmd-frontmatter") && !mainmatter ? "roman" : style;
      let label = String(value);
      if (format === "roman" || format === "Roman") {
        label = "";
        let rest = value;
        for (const [amount, digits] of numerals) for (; rest >= amount; rest -= amount) label += digits;
        if (format === "Roman") label = label.toUpperCase();
      } else if (format === "alph" || format === "Alph") {
        label = "";
        for (let rest = value; rest > 0; rest = Math.floor((rest - 1) / 26)) label = String.fromCharCode(97 + (rest - 1) % 26) + label;
        if (format === "Alph") label = label.toUpperCase();
      }
      for (const element of container.querySelectorAll<HTMLElement>("[id]")) if (!numbers.has(element.id)) numbers.set(element.id, label);
    }
    for (const link of document.querySelectorAll<HTMLElement>("a[data-mathmd-toc-target]")) {
      const number = numbers.get(link.getAttribute("data-mathmd-toc-target") ?? "");
      const counter = link.querySelector<HTMLElement>("[data-vivliostyle-target-counter]");
      if (number && counter) counter.textContent = number;
    }
  }, style);
}

async function readLayoutDiagnostics(page: Page, book = false): Promise<LayoutDiagnostic[]> {
  return page.evaluate((book) => {
    const diagnostics: Array<{ code: string; message: string }> = [];
    const containers = [...document.querySelectorAll<HTMLElement>("[data-vivliostyle-page-container]")];
    for (const [index, container] of containers.entries()) {
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
      const blocks = [...area.querySelectorAll<HTMLElement>("body > *, [data-vivliostyle-column] > * > *, .mathmd-matter > *")].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !element.closest(".mathmd-footnote") && !element.classList.contains("mathmd-matter");
      });
      for (let i = 0; i < blocks.length; i++) {
        const a = blocks[i].getBoundingClientRect();
        for (let j = i + 1; j < blocks.length; j++) {
          if (blocks[i].contains(blocks[j]) || blocks[j].contains(blocks[i])) continue;
          const b = blocks[j].getBoundingClientRect();
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) diagnostics.push({ code: "LAYOUT_OVERLAP", message: "Block elements overlap on a page." });
        }
      }
      // A book leaves blank the left-hand page before a chapter or the contents, and the back of the title page.
      const intended = book && container.getAttribute("data-vivliostyle-page-side") === "left" && Boolean(containers[index + 1]?.querySelector("h1.chapter, .toc-title") || containers[index - 1]?.querySelector(".document-title"));
      if (!intended && !area.textContent?.trim() && !area.querySelector("svg, img, table")) diagnostics.push({ code: "EMPTY_PAGE", message: "A blank page was generated." });
    }
    return diagnostics;
  }, book);
}

async function withPaginatedPage<T>(result: CompileResult, sourceFile: string, action: (page: Page) => Promise<T>): Promise<T> {
  // Hinting rounds glyph advances to whole pixels at text sizes; unhinted layout keeps the font's exact metrics.
  const browser = await chromium.launch({ headless: true, args: ["--font-render-hinting=none"] });
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
    await paginate(page, result, sourceFile);
    return await action(page);
  } finally {
    await browser.close();
  }
}

// Runs before pagination so fonts installed before TrueType conversion existed are converted on first use.
function fontDiagnostics(): LayoutDiagnostic[] {
  const missing = missingFontFiles();
  const unconverted = ensureTrueTypeFonts();
  return [
    ...missing.length ? [{ code: "FONT_NOT_INSTALLED", message: "Default fonts are not installed (" + missing.map((font) => font.file).join(", ") + "); falling back to system fonts. Run 'marktexset fonts install'." }] : [],
    ...unconverted.length ? [{ code: "FONT_CONVERSION_FAILED", message: "Could not convert " + unconverted.join(", ") + " to TrueType; the PDF embeds them as Type 3 fonts. Run 'marktexset fonts install --force'." }] : [],
  ];
}

export async function inspectLayout(result: CompileResult, sourceFile: string): Promise<LayoutDiagnostic[]> {
  const fonts = fontDiagnostics();
  return [...fonts, ...await withPaginatedPage(result, sourceFile, (page) => readLayoutDiagnostics(page, result.config.layout?.class === "book"))];
}

function authorNames(author: unknown): string[] {
  const list = Array.isArray(author) ? author : author === undefined || author === null ? [] : [author];
  return list.map((item) => typeof item === "string" ? item : item && typeof item === "object" ? String((item as Record<string, unknown>).name ?? "") : "").filter(Boolean);
}

// Chromium writes the title but not the author; add document metadata without touching the page content.
async function writeMetadata(output: string, config: Record<string, any>): Promise<void> {
  const document = await PDFDocument.load(fs.readFileSync(output), { updateMetadata: false });
  if (config.meta?.title) document.setTitle(String(config.meta.title), { showInWindowTitleBar: true });
  const authors = authorNames(config.meta?.author);
  if (authors.length) document.setAuthor(authors.join(", "));
  document.setLanguage(String(config.meta?.language ?? "en"));
  document.setCreator("MarkTeXset");
  fs.writeFileSync(output, await document.save({ useObjectStreams: false }));
}

export async function renderPdf(result: CompileResult, output: string, sourceFile: string): Promise<void> {
  const fonts = fontDiagnostics();
  await withPaginatedPage(result, sourceFile, async (page) => {
    for (const diagnostic of [...fonts, ...await readLayoutDiagnostics(page, result.config.layout?.class === "book")]) result.diagnostics.warning(diagnostic.code, diagnostic.message);
    await page.pdf({ path: output, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, outline: true, tagged: true });
  });
  if (!fs.existsSync(output)) throw new Error("Chromium did not create the PDF output.");
  await writeMetadata(output, result.config);
}
