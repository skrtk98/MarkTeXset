import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { chromium, type Page } from "playwright";
import type { CompileResult } from "./compiler.js";
import { mathFont, mathPathsToText } from "./mathfont.js";
import { HEADING_SANS_STACK, JAPANESE_SCALE, SERIF_STACK, SLANTED_STACK, headingSansStack, serifStack, ensureTrueTypeFonts, fontFaceCss, missingFontFiles, resolveFontRequest } from "./fonts.js";
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

// TeX measures in points of 1/72.27 in; CSS points are 1/72 in.
function texPt(value: number): string {
  return Number((value * 72 / 72.27).toFixed(3)) + "pt";
}

const A4_TEX = { width: 597.51, height: 845.05 };

export interface LatexLayout { left: number; evenLeft: number; width: number; top: number; topskip: number; baselineskip: number; lines: number; headsep: number; footskip: number; }

// The A4 page layouts of the standard classes at 10pt, read from TeX in TeX points: the left margin of right-hand
// and left-hand pages (1in + \oddsidemargin, \evensidemargin), \textwidth, the top of the text block
// (1in + \topmargin + \headheight + \headsep), \topskip, \baselineskip, the lines a page holds, \headsep, and
// \footskip. report uses article's layout and ltjsreport ltjsarticle's.
const LATEX_LAYOUTS: Record<string, LatexLayout> = {
  article: { left: 125.27, evenLeft: 125.27, width: 345, top: 126.27, topskip: 10, baselineskip: 12, lines: 50, headsep: 25, footskip: 30 },
  book: { left: 100.27, evenLeft: 151.27, width: 345, top: 125.34, topskip: 10, baselineskip: 12, lines: 50, headsep: 18.07, footskip: 25.29 },
  ltjsarticle: { left: 72.2, evenLeft: 72.2, width: 453.11, top: 112.72, topskip: 12.76, baselineskip: 16, lines: 40, headsep: 15.7, footskip: 28.46 },
  ltjsbook: { left: 53.7, evenLeft: 173.92, width: 369.89, top: 110.25, topskip: 12.76, baselineskip: 16, lines: 42, headsep: 14.31, footskip: 28.46 },
};

// How far a line's baseline sits below the middle of its line box, in TeX points, for the body font at 10pt.
const BASELINE_SHIFT: Record<string, number> = { en: 4.1, ja: 4.1 };

/** The LaTeX layout the page follows, unless `layout.margins` sets the margins. */
export function latexLayout(config: Record<string, any>): LatexLayout | undefined {
  if (config.layout?.margins !== undefined || pageSize(config.layout?.size) !== "A4") return undefined;
  return LATEX_LAYOUTS[(/^ja/i.test(String(config.meta?.language)) ? "ltjs" : "") + (config.layout?.class === "book" ? "book" : "article")];
}

// Places the text block so that its baselines fall where LaTeX's do, and the running head and the page number
// on LaTeX's head and foot baselines.
function latexPageCss(layout: LatexLayout, language: string): string {
  const baseline = layout.baselineskip / 2 + BASELINE_SHIFT[/^ja/i.test(language) ? "ja" : "en"];
  const top = layout.top + layout.topskip - baseline;
  const height = layout.lines * layout.baselineskip + 0.5;
  const lastBaseline = layout.top + layout.topskip + (layout.lines - 1) * layout.baselineskip;
  const head = `vertical-align: bottom; line-height: ${texPt(layout.baselineskip)}; margin-bottom: ${texPt(top - (layout.top - layout.headsep) - (layout.baselineskip - baseline))};`;
  const foot = `vertical-align: top; line-height: ${texPt(layout.baselineskip)}; padding-top: ${texPt(lastBaseline + layout.footskip - top - height - baseline)};`;
  const evenRight = A4_TEX.width - layout.evenLeft - layout.width;
  return `@page { margin: ${texPt(top)} ${texPt(A4_TEX.width - layout.left - layout.width)} ${texPt(A4_TEX.height - top - height)} ${texPt(layout.left)};
  @top-left { ${head} } @top-right { ${head} } @bottom-center { ${foot} } }
@page :left { margin-left: ${texPt(layout.evenLeft)}; margin-right: ${texPt(evenRight)}; }`;
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
  const layout = latexLayout(config);
  if (layout) return texPt(layout.width);
  const margins = pageMargins(config.layout?.margins).split(" ");
  const [right, left] = margins.length === 4 ? [margins[1], margins[3]] : [margins[0], margins[0]];
  return "calc(" + PAGE_WIDTHS[pageSize(config.layout?.size)] + " - " + left + " - " + right + ")";
}

// How far below a text line's baseline a heading's baseline sits in its line box, in ems of the heading, by its size in
// pt: Latin Modern 12 bold at 14.4pt on 18pt and at 12pt on 14.4pt, and 10 bold at 10pt on 12.5pt, against 10pt on 12pt.
const HEADING_RISE: Record<number, number> = { 14.4: 0.3417, 12: 0.175, 10: 0.026 };

// Latin Modern's ascent and descent (hhea), which set the strut of a CSS line box, and its ascender and descender.
const LM_ASCENT = 1.127, LM_DESCENT = 0.29, LM_ASCENDER = 0.694, LM_DESCENDER = 0.194;

/**
 * Keeps inline math from spreading lines that TeX would not spread. TeX keeps lines \baselineskip apart unless the
 * depth of one and the height of the next leave less than \lineskip (1pt) between them; CSS widens a line whenever
 * inline content leaves its strut. Each formula's margins let it reach as far as TeX allows next to ordinary text,
 * and widen the line by as much as TeX would beyond that.
 */
function settleInlineMath(html: string, lineHeight: number): string {
  const strutTop = LM_ASCENT + (lineHeight - LM_ASCENT - LM_DESCENT) / 2;
  const strutBottom = LM_DESCENT + (lineHeight - LM_ASCENT - LM_DESCENT) / 2;
  const maxHeight = lineHeight - 0.1 - LM_DESCENDER;
  const maxDepth = lineHeight - 0.1 - LM_ASCENDER;
  return html.replace(/(<mjx-container class="MathJax" jax="SVG"(?! display="true")[^>]*>\s*<svg style=")vertical-align: (-?[\d.]+)em;([^>]*?height="([\d.]+)em")/g, (_match, start: string, align: string, rest: string, size: string) => {
    const depth = -Number(align);
    const height = Number(size) - depth;
    // A replaced element sits on its bottom margin edge, so the formula is raised to the depth the line should
    // make room for and a negative bottom margin lowers it back into place.
    const top = height <= maxHeight ? Math.min(0, strutTop - height) : strutTop - maxHeight;
    const room = depth <= maxDepth ? Math.min(depth, strutBottom) : strutBottom + depth - maxDepth;
    return start + "vertical-align: " + (-room).toFixed(4) + "em; margin-top: " + top.toFixed(4) + "em; margin-bottom: " + (room - depth).toFixed(4) + "em;" + rest;
  });
}

/**
 * Sets LaTeX's quad after a heading number: the space there, kept for the outline, is a Latin Modern word space (a
 * third of an em) and the number's margin is the rest. Each heading that marks the running head gets a hidden copy of
 * the mark, which the head takes with content(text): the number and the title a quad apart in article (\sectionmark),
 * "1." and a space between them in report and book (\chaptermark: "CHAPTER 1.  TITLE"), and 1zw apart in jsclasses.
 */
function runningMarks(html: string, config: Record<string, any>): string {
  const documentClass = config.layout?.class;
  const japanese = /^ja/i.test(String(config.meta?.language));
  const separator = japanese ? "\u3000" : documentClass === "report" || documentClass === "book" ? ".\u00a0\u00a0" : "\u00a0\u00a0\u00a0";
  const marked = documentClass === "book" ? /^h[12]$/ : /^h1$/;
  const text = (markup: string) => markup.replace(/<[^>]*>/g, "");
  return html.replace(/<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/g, (_match, tag: string, attributes: string, inner: string) => {
    const numbered = inner.match(/^<span class="heading-number">([\s\S]*?)<\/span> ([\s\S]*)$/);
    const body = numbered ? "<span class=\"heading-number\">" + numbered[1] + "</span><span class=\"mathmd-heading-space\"> </span>" + numbered[2] : inner;
    if (!marked.test(tag)) return "<" + tag + attributes + ">" + body + "</" + tag + ">";
    const mark = numbered ? text(numbered[1]) + separator + text(numbered[2]) : text(inner);
    return "<" + tag + attributes + "><span class=\"mathmd-mark mathmd-mark-" + tag + "\" aria-hidden=\"true\">" + mark + "</span>" + body + "</" + tag + ">";
  });
}

// LuaTeX-ja's xkanjiskip: 0.25zw between a Japanese character and a Latin one or inline math, in place of any space
// written there. It is a Latin Modern space (0.333em) set small enough, so it stretches and breaks like glue.
const XKANJISKIP = "<span class=\"mathmd-xkanjiskip\"> </span>";
const JAPANESE_CHAR = /[\u3041-\u309f\u30a1-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005\u3006]/;
const LATIN_CHAR = /[A-Za-z0-9\u00c0-\u024f]/;
const BLOCK_TAGS = /^(?:p|div|li|ul|ol|dl|dt|dd|h[1-6]|table|thead|tbody|tr|td|th|caption|figure|figcaption|blockquote|section|nav|header|footer|pre|br|hr)$/;

/** Puts xkanjiskip between Japanese and Latin text or inline math in a Japanese document. */
function insertXkanjiskip(html: string): string {
  const tokens = html.match(/<[^>]*>|[^<]+/g) ?? [];
  // Elements read as one unit: inline math and code are Latin; footnotes, scripts, and heading numbers break the run.
  const atomOf = (tag: string): { name: string; kind: string } | undefined => {
    const name = tag.match(/^<([a-zA-Z][\w-]*)/)?.[1].toLowerCase();
    if (!name) return undefined;
    if (name === "span" && /class="math-render"/.test(tag)) return { name, kind: "A" };
    if (name === "code" || name === "kbd" || name === "samp") return { name, kind: "A" };
    if (name === "span" && /class="(?:mathmd-footnote|mathmd-footnote-repeat|heading-number|mathmd-mark mathmd-mark-h\d)"/.test(tag)) return { name, kind: "X" };
    if (/^(?:sup|sub|svg|style|script|math|mjx-container|img|input)$/.test(name)) return { name, kind: "X" };
    return undefined;
  };
  const output: string[] = [];
  let last = "";
  let pending: Array<{ index: number; text: string }> = [];
  // A new unit of the given kind starts at the end of the output; returns whether xkanjiskip goes before it.
  const meet = (kind: string): boolean => {
    const join = (last === "J" && kind === "A") || (last === "A" && kind === "J");
    if (join) for (const space of pending) output[space.index] = "";
    pending = [];
    last = kind;
    return join;
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("<")) {
      const name = token.match(/^<\/?([a-zA-Z][\w-]*)/)?.[1].toLowerCase() ?? "";
      const atom = token.startsWith("</") || token.endsWith("/>") ? undefined : atomOf(token);
      if (atom) {
        // Copy the element whole, tracking nested elements of the same name.
        let depth = 0, end = i;
        for (; end < tokens.length; end++) {
          const inner = tokens[end].match(/^<(\/?)([a-zA-Z][\w-]*)/);
          if (inner && inner[2].toLowerCase() === atom.name && !tokens[end].endsWith("/>")) depth += inner[1] ? -1 : 1;
          if (depth === 0) break;
        }
        // A heading number such as 第1章 is spaced inside, but not against the title.
        const inner = /heading-number/.test(token) ? token + insertXkanjiskip(tokens.slice(i + 1, end).join("")) + (tokens[end] ?? "") : tokens.slice(i, end + 1).join("");
        output.push((meet(atom.kind) ? XKANJISKIP : "") + inner);
        if (atom.kind === "X") last = "";
        i = end;
        continue;
      }
      if (BLOCK_TAGS.test(name)) { last = ""; pending = []; }
      output.push(token);
      continue;
    }
    let text = "";
    for (let j = 0; j < token.length; j++) {
      const char = token[j];
      if (/[ \t\n]/.test(char)) { text += char; continue; }
      if (char === "&") {
        const entity = token.slice(j).match(/^&[#\w]+;/)?.[0] ?? "&";
        meet("X");
        text += entity;
        j += entity.length - 1;
        continue;
      }
      const kind = JAPANESE_CHAR.test(char) ? "J" : LATIN_CHAR.test(char) ? "A" : "X";
      // Spaces earlier in this token are pending as part of the text so far.
      const trailing = text.match(/[ \t\n]+$/)?.[0] ?? "";
      if (trailing) { output.push(text.slice(0, -trailing.length)); pending.push({ index: output.length, text: trailing }); output.push(trailing); text = ""; }
      if (meet(kind)) { output.push(text); text = XKANJISKIP; }
      text += char;
    }
    const trailing = text.match(/[ \t\n]+$/)?.[0] ?? "";
    if (trailing) { output.push(text.slice(0, -trailing.length)); pending.push({ index: output.length, text: trailing }); output.push(trailing); }
    else output.push(text);
  }
  return output.join("");
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
function chapterCss(config: Record<string, any>, pageNumber: string, heads: RunningHeads): string {
  const documentClass = config.layout?.class;
  if (documentClass !== "report" && documentClass !== "book") return "";
  const book = documentClass === "book";
  const opening = book ? "right" : "page";
  const margins = config.layout?.margins;
  const mirrored = book && margins && typeof margins === "object" ? `@page :left { margin-left: ${cssLength(margins.right ?? "25mm")}; margin-right: ${cssLength(margins.left ?? "25mm")}; }` : "";
  const front = config.layout?.page?.number?.visible === false ? "none" : pageContent(config, "lower-roman") || "none";
  return `
/* \\@makechapterhead: "Chapter 1" in \\huge 75pt below where a page's first line sits, the title in \\Huge 50pt below it,
   and the text 52pt below the title; jsclasses set them 60pt, 49pt, and 64pt apart. */
h1.chapter { break-before: ${opening}; font-size: 2.488em; line-height: 1.2; margin: 63.78pt 0 37.34pt; }
h1.chapter .heading-number { display: block; font-size: 0.833em; margin-bottom: 20.69pt; }
:lang(ja) h1.chapter { margin: 50.72pt 0 47.32pt; } :lang(ja) h1.chapter .heading-number { margin-bottom: 19.79pt; }
h3 { font-family: ${serifStack(12)}; } :lang(ja) h3 { font-family: ${headingSansStack(12)}; }
:lang(ja) h1.chapter, :lang(ja) .toc-title { font-family: ${headingSansStack(24.88)}; }
/* Below a chapter, \\section is \\Large and \\subsection \\large. */
h2 { font-size: 1.44em; line-height: 1.25; margin: ${1.136 + HEADING_RISE[14.4]}em 0 0.6em; } h2::before { margin-bottom: -${HEADING_RISE[14.4]}em; }
h3 { font-size: 1.2em; line-height: 1.2; margin: ${1.146 + HEADING_RISE[12]}em 0 0.485em; } h3::before { margin-bottom: -${HEADING_RISE[12]}em; }
h4, h5, h6 { font-size: 1em; margin: ${1.4 + HEADING_RISE[10]}em 0 0.6em; } :is(h4, h5, h6)::before { margin-bottom: -${HEADING_RISE[10]}em; }
h1.chapter::before, .toc-title::before { content: none; }
:lang(ja) h2 { margin: 0 0 0.6em; padding-top: 1.275em; } :lang(ja) h3 { margin: 0 0 0.786em; padding-top: 1.43em; } :lang(ja) :is(h4, h5, h6) { margin: 0 0 0.163em; padding-top: 1.79em; }
${book ? ".mathmd-mark-h1 { string-set: mathmd-chapter content(text), mathmd-section \"\"; } .mathmd-mark-h2 { string-set: mathmd-section content(text); }" : ""}
.table-of-contents { break-before: ${opening}; }
/* \\@makeschapterhead, placed as LaTeX places the title of the contents. */
.toc-title { font-size: 2.488em; line-height: 1.2; margin: 64.47pt 0 47.29pt; }
:lang(ja) .toc-title { padding-top: 52.69pt; margin: 0 0 46.44pt; }
/* ltjsreport's contents, measured: titles of chapters and sections 4.683zw from the margin, subsections 3.5zw further. */
:lang(ja) .toc-list .toc-level-1 .heading-number { min-width: ${4.683 * JAPANESE_SCALE}em; }
:lang(ja) .toc-list .toc-level-2 .heading-number { min-width: ${3.683 * JAPANESE_SCALE}em; }
:lang(ja) .toc-list :is(.toc-level-3, .toc-level-4, .toc-level-5, .toc-level-6) { padding-left: ${4.683 * JAPANESE_SCALE}em; } :lang(ja) .toc-list :is(.toc-level-3, .toc-level-4, .toc-level-5, .toc-level-6) .heading-number { min-width: ${3.5 * JAPANESE_SCALE}em; }
.document-title { page: mathmd-title; break-after: ${opening}; padding-top: 60pt; }
.document-title + *, .mathmd-mainmatter { counter-reset: page 1; }
.mathmd-frontmatter { page: mathmd-front; }
@page mathmd-title { @top-left { content: none; } @top-right { content: none; } @bottom-center { content: none; } }
@page mathmd-front { @bottom-center { content: ${front}; } }
@page :blank { @top-left { content: none; } @top-right { content: none; } @bottom-center { content: none; } }
${book ? `@page :left { @top-left { content: ${pageNumber}; ${heads.number} } @top-right { content: string(mathmd-chapter, first); ${heads.mark} } }
@page mathmd-front:left { @top-left { content: ${front}; } }
@page mathmd-front:right { @top-right { content: ${front}; } }
${mirrored}` : ""}
@page mathmd-front:blank { @top-left { content: none; } @top-right { content: none; } @bottom-center { content: none; } }`;
}

interface RunningHeads { mark: string; number: string; }

// LaTeX's headings style sets the mark in slanted capitals on the left and the page number on the right;
// jsclasses set them upright, with the page number in bold, over a rule.
function runningHeads(config: Record<string, any>): RunningHeads {
  const japanese = /^ja/i.test(String(config.meta?.language));
  const rule = japanese ? `border-bottom: ${texPt(0.4)} solid;` : "";
  return {
    mark: `font-size: ${texPt(10)}; font-weight: normal; ${japanese ? "font-style: normal; text-transform: none;" : `font-family: ${SLANTED_STACK}; font-style: normal; text-transform: uppercase;`} ${rule}`,
    number: `font-size: ${texPt(10)}; font-weight: ${japanese ? "bold" : "normal"}; font-style: normal; text-transform: none; ${rule}`,
  };
}

export function pdfHtml(html: string, config: Record<string, any>, baseDirectory: string): string {
  const margins = pageMargins(config.layout?.margins);
  const size = pageSize(config.layout?.size);
  const layout = latexLayout(config);
  const pageNumber = config.layout?.page?.number?.visible === false ? "none" : pageContent(config) || "none";
  const heads = runningHeads(config);
  const japanese = /^ja/i.test(String(config.meta?.language));
  const css = `<style data-mathmd-style-origin="pdf">
${fontFaceCss((file) => ORIGIN + "/fonts/" + encodeURIComponent(file))}
@page { size: ${size}; margin: ${margins}; font-family: ${SERIF_STACK}; @top-left { content: string(mathmd-section, first); ${heads.mark} } @top-right { content: ${pageNumber}; ${heads.number} } @bottom-center { content: ${pageNumber}; font-size: ${texPt(10)}; } }
${layout ? latexPageCss(layout, String(config.meta?.language)) : ""}
html, body { margin: 0 !important; max-width: none !important; }
/* LaTeX's 10pt type on a 12pt \\baselineskip; ltjsarticle sets a 16pt one. */
body { font-size: ${texPt(10)}; line-height: ${texPt(12)}; }
body:lang(ja) { line-height: ${texPt(16)}; }
p { margin: 0; orphans: 2; widows: 2; }
/* LaTeX indents every paragraph but the first after an English heading; Japanese classes indent that one too. */
p + p, :is(body, .mathmd-matter) > p { text-indent: 1.5em; }
:is(body, .mathmd-matter) > :is(h1, h2, h3, h4, h5, h6) + p { text-indent: 0; }
:lang(ja) p + p, :lang(ja) :is(body, .mathmd-matter) > p, :lang(ja) :is(body, .mathmd-matter) > :is(h1, h2, h3, h4, h5, h6) + p { text-indent: ${JAPANESE_SCALE}em; }
li > p, td > p, th > p, .figure p { text-indent: 0; }
/* \\section, \\subsection, and \\subsubsection: \\Large, \\large, and \\normalsize bold with LaTeX's space around them. */
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.6em; }
h1 { font-size: 1.44em; margin: ${1.136 + HEADING_RISE[14.4]}em 0 0.6em; } h2 { font-size: 1.2em; line-height: 1.2; margin: ${1.146 + HEADING_RISE[12]}em 0 0.485em; } h3, h4, h5, h6 { font-size: 1em; margin-top: ${1.4 + HEADING_RISE[10]}em; }
/* LaTeX drops the space above a heading at the top of a page and puts the heading's baseline where a first line's
   would be. Vivliostyle drops the margin at the page breaks it chooses, and the margin is dropped here at the others;
   a heading's text is raised by the distance between its baseline and a text line's, and its margin grows by as
   much. The empty block before the text keeps the negative margin from collapsing into the heading's. jsclasses keep
   the space, so Japanese headings take it as padding. */
h1::before, h2::before, h3::before, h4::before, h5::before, h6::before, .toc-title::before { content: ""; display: block; height: 0.01px; }
h1::before, .toc-title::before { margin-bottom: -${HEADING_RISE[14.4]}em; } h2::before { margin-bottom: -${HEADING_RISE[12]}em; } :is(h3, h4, h5, h6)::before { margin-bottom: -${HEADING_RISE[10]}em; }
:is(body, .mathmd-matter) > :first-child:not(.chapter, .table-of-contents), .mathmd-pagebreak + :not(.chapter, .table-of-contents),
.mathmd-class-article > .table-of-contents:first-child > .toc-title, .mathmd-class-article .mathmd-pagebreak + .table-of-contents > .toc-title { margin-top: 0; }
:lang(ja) :is(h1, h2, h3, h4, h5, h6, .toc-title)::before { content: none; }
/* Latin Modern's optical sizes, as LaTeX picks them: the 12pt designs from 11pt up, the 17pt design for the title,
   and the 8, 7, and 6pt designs for footnotes, footnote calls, and the marks in front of the notes. */
h1, h2, .toc-title, .document-title .author, .document-title .date { font-family: ${serifStack(12)}; }
.document-title-heading { font-family: ${serifStack(17.28)}; }
/* The number is followed by a quad, as with \\@seccntformat. */
.heading-number { margin-right: 0.667em; }
.mathmd-mark { font-size: 0; }
.mathmd-heading-space { font-family: ${SERIF_STACK}; font-weight: normal; font-style: normal; }
.mathmd-xkanjiskip { font-family: ${SERIF_STACK}; font-size: ${(0.25 * JAPANESE_SCALE / 0.333 * 100).toFixed(2)}%; line-height: 0; }
:lang(ja) { text-autospace: no-autospace; }
/* jsclasses set headings in Gothic and sans serif at regular weight, on whole lines of the 16pt grid. */
:lang(ja) :is(h1, h2, h3, h4, h5, h6) { font-family: ${HEADING_SANS_STACK}; font-weight: normal; }
:lang(ja) :is(h1, h2), :lang(ja) .toc-title { font-family: ${headingSansStack(12)}; }
:lang(ja) h1 { margin: 0 0 0.6em; padding-top: 1.275em; } :lang(ja) h2 { margin: 0 0 0.786em; padding-top: 1.43em; } :lang(ja) :is(h3, h4, h5, h6) { margin: 0 0 0.163em; padding-top: 1.79em; }
.math-block, .callout, .figure, .code-block, table, .tikzcd, ul, ol, dl { margin-top: 0.7em; margin-bottom: 0.7em; }
.mathml, mjx-assistive-mml { position: absolute !important; width: 1px !important; height: 1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; white-space: nowrap !important; }
.math-svg { display: inline; }
.code-copy { display: none !important; }
table, .callout, .math-block, img, .figure, .tikzcd { break-inside: avoid; max-width: 100%; }
/* Like LaTeX's default [tbp] placement: a figure goes to the top of its page, or of the next page when it does not fit. */
/* \\textfloatsep separates a top float from the text. */
.figure, .mathmd-table-float { float: top; float-reference: page; margin: 0 auto ${texPt(20)}; }
.mathmd-table-float { width: 100%; break-inside: avoid; }
.mathmd-float-bottom { float: bottom; margin: ${texPt(20)} auto 0; }
/* Code may break across pages like a verbatim block, keeping at least three lines on each side. */
.code-block, .callout { break-inside: auto; }
pre, .code-block pre, .code-content { max-width: 100%; overflow: visible; orphans: 3; widows: 3; }
.code-header, .callout-title { break-after: avoid; }
pre, .code-block pre { white-space: pre-wrap; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; }
.mathmd-mark-h1 { string-set: mathmd-section content(text); }
.mathmd-table { margin-left: auto; margin-right: auto; }
/* booktabs rules, as in Pandoc's LaTeX tables; :where() keeps them below any user table style. */
:where(.mathmd-table) { border-collapse: collapse; border-top: 0.08em solid; border-bottom: 0.08em solid; }
:where(.mathmd-table thead tr:last-child > th) { border-bottom: 0.05em solid; }
/* Cells as in a tabular, with booktabs' space below and above the rules. These outrank the base style, and user styles come later. */
.mathmd-table th, .mathmd-table td { padding: 0 ${texPt(6)}; }
.mathmd-table th { text-align: left; font-weight: normal; }
.mathmd-table tr:first-child > * { padding-top: ${texPt(2.8)}; }
.mathmd-table tr:last-child > * { padding-bottom: ${texPt(1.7)}; }
/* The caption spans the measure, not the table, as LaTeX's does. */
.table-caption { margin: 8.4pt 0 10.7pt; text-align: center; break-after: avoid; }
.table-caption + table { margin-top: 0; }
.figure-caption, .table-caption { font-size: 1em; }
/* \\maketitle: the title in \\LARGE, the author and the date in \\large, with LaTeX's space around them. */
.document-title-heading { font-size: 1.728em; line-height: 1.25; margin: 0 0 13.3pt; }
:lang(ja) .document-title-heading { margin-bottom: 16.3pt; }
.document-title .author, .document-title .date { font-size: 1.2em; line-height: ${texPt(14)}; }
.document-title .date { margin-top: 9.1pt; }
:lang(ja) .document-title .date { margin-top: 11.9pt; }
body:not(.mathmd-class-report):not(.mathmd-class-book) .document-title { padding-top: 34pt; margin-bottom: 22.5pt; }
body:lang(ja):not(.mathmd-class-report):not(.mathmd-class-book) .document-title { padding-top: 39pt; margin-bottom: 24.9pt; }
.table-of-contents { border: none !important; padding: 0 !important; background: none !important; }
.toc-list { list-style: none; padding-left: 0; }
.toc-list li { display: flex; align-items: baseline; margin: 0; }
/* \\tableofcontents: the title as \\section*, entries indented 0, 1.5em, and 3.8em with numbers in boxes 1.5em, 2.3em,
   and 3.2em wide, the top level in bold after 1em of space. ltjsarticle indents entries 0, 1zw, and 2zw with numbers
   in boxes 4zw, 3zw, and 4zw wide, so section and subsection titles align. */
.toc-title { font-size: 1.44em; line-height: 1.25; margin: ${1.81 + HEADING_RISE[14.4]}em 0 0.62em; }
.toc-list > li:first-child { margin-top: 0; }
:lang(ja) .toc-title { margin: 0 0 0.6em; padding-top: 1.275em; }
.toc-list { margin: 0; }
.toc-list .heading-number { display: inline-block; margin-right: 0; }
.toc-list .toc-level-1 .heading-number { min-width: 1.5em; } .toc-list .toc-level-2 .heading-number { min-width: 2.3em; } .toc-list :is(.toc-level-3, .toc-level-4, .toc-level-5, .toc-level-6) .heading-number { min-width: 3.2em; }
.toc-list .toc-level-2 { padding-left: 1.5em; } .toc-list :is(.toc-level-3, .toc-level-4, .toc-level-5, .toc-level-6) { padding-left: 3.8em; }
:lang(ja) .toc-list .toc-level-1 { font-family: ${HEADING_SANS_STACK}; font-weight: normal; }
:lang(ja) .toc-list .toc-level-1 .heading-number { min-width: ${4 * JAPANESE_SCALE}em; }
:lang(ja) .toc-list .toc-level-2 { padding-left: ${JAPANESE_SCALE}em; } :lang(ja) .toc-list .toc-level-2 .heading-number { min-width: ${3 * JAPANESE_SCALE}em; }
:lang(ja) .toc-list :is(.toc-level-3, .toc-level-4, .toc-level-5, .toc-level-6) { padding-left: ${2 * JAPANESE_SCALE}em; } :lang(ja) .toc-list :is(.toc-level-3, .toc-level-4, .toc-level-5, .toc-level-6) .heading-number { min-width: ${4 * JAPANESE_SCALE}em; }
.toc-list a { color: inherit; text-decoration: none; display: flex; flex: 1; align-items: baseline; min-width: 0; }
.toc-list a::after { content: target-counter(attr(href url), page, ${COUNTER_STYLES[pageNumberStyle(config)] ?? "decimal"}); flex: none; padding-left: 0.5em; }
/* \\@dottedtocline: periods with 4.5mu on each side, aligned from the right. */
.toc-list a::before { content: "${".".repeat(300)}"; order: 1; flex: 1; margin: 0 0.3em; letter-spacing: 0.5em; white-space: nowrap; overflow: hidden; direction: rtl; font-weight: normal; min-width: 0; }
.toc-list a::after { order: 2; }
.toc-list .toc-level-1 { font-weight: bold; margin-top: 1em; }
.toc-list .toc-level-1 > a::before { visibility: hidden; }
.mathmd-pagebreak { break-before: page; height: 0; }
/* \\footnotesize: 8pt on 9.5pt. Lengths are absolute because Vivliostyle resolves em in the footnote area against the root. */
.mathmd-footnote { float: footnote; font-family: ${serifStack(8)}; font-size: ${texPt(8)}; line-height: ${texPt(9.5)}; text-align: justify; text-indent: 0; }
.mathmd-footnote-paragraph + .mathmd-footnote-paragraph { display: block; }
.mathmd-line .mathmd-footnote { white-space: normal; text-align-last: auto; text-indent: 0; word-spacing: normal; }
.mathmd-footnote::footnote-call, .mathmd-footnote-repeat { font-family: ${serifStack(7)}; font-size: 0.7em; vertical-align: super; line-height: 0; }
/* \\@makefntext: the superscript mark ends a 1.8em box before the note. jsclasses indent the note by 3zw,
   hang the mark "*1" in front of it 0.3zw away, and mark the call "*1" too. */
.mathmd-footnote::footnote-marker { content: counter(footnote); display: inline-block; font-family: ${serifStack(6)}; font-size: 0.75em; width: 2.4em; text-align: right; vertical-align: super; line-height: 0; }
:lang(ja) .mathmd-footnote { padding-left: ${3 * JAPANESE_SCALE}em; text-indent: -${3 * JAPANESE_SCALE}em; }
:lang(ja) .mathmd-footnote::footnote-marker { content: "*" counter(footnote); width: ${4 * JAPANESE_SCALE}em; padding-right: ${0.4 * JAPANESE_SCALE}em; box-sizing: border-box; }
:lang(ja) .mathmd-footnote::footnote-call { content: "*" counter(footnote); }
:lang(ja) .mathmd-footnote-repeat::before { content: "*"; }
${chapterCss(config, pageNumber, heads)}
</style>`;
  // The title is not a section: keep it out of the PDF outline, the tag tree's headings, and the running head.
  const titled = html.replace(/<h1 class="document-title-heading">([\s\S]*?)<\/h1>/, "<div class=\"document-title-heading\">$1</div>");
  // A captioned table floats like LaTeX's table environment, with its caption above it across the measure.
  const captioned = titled.replace(/(<table\b[^>]*>)<caption class="table-caption">([\s\S]*?)<\/caption>([\s\S]*?<\/table>)/g, "<div class=\"mathmd-table-float\"><div class=\"table-caption\">$2</div>$1$3</div>");
  const prepared = wrapMatter(dropBreaksBeforeChapters(bindPageStyleMarkers(inlineFootnotes(runningMarks(captioned, config))), config)).replace(/(<ul class="toc-list">[\s\S]*?<\/ul>)/, (list) => list.replace(/<a href="#([^"]+)"/g, "<a href=\"#$1\" data-mathmd-toc-target=\"$1\""));
  const spaced = japanese ? insertXkanjiskip(prepared) : prepared;
  const math = mathPathsToText(settleInlineMath(spaced, japanese ? 1.6 : 1.2));
  const mathFaces = [...math.families].sort().map((family) => "@font-face { font-family: \"" + family + "\"; src: url(\"" + ORIGIN + "/mathfonts/" + family + ".ttf\") format(\"truetype\"); font-display: block; } .mathmd-glyph-" + family + " { font-family: \"" + family + "\"; }").join("\n");
  return embedLocalImages(math.html.replace("</head>", css.replace("</style>", mathFaces + "\n</style>") + "</head>"), baseDirectory);
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
    const mathFontData = url.startsWith(ORIGIN + "/mathfonts/") ? mathFont(decodeURIComponent(url.slice((ORIGIN + "/mathfonts/").length)).replace(/\.ttf$/, "")) : undefined;
    if (mathFontData) return route.fulfill({ status: 200, contentType: "font/ttf", body: mathFontData });
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
  const layOut = async () => {
    await page.goto(ORIGIN + "/viewer.html");
    await page.waitForFunction(() => (window as any).__mathmd.done || (window as any).__mathmd.error, undefined, { timeout: 120_000 });
    const error = await page.evaluate(() => (window as any).__mathmd.error as string | null);
    if (error) throw new Error("Vivliostyle pagination failed: " + error);
    await page.evaluate(() => document.fonts.ready);
  };
  const documentClass = result.config.layout?.class;
  const chapters = documentClass === "report" || documentClass === "book";
  const floats = chapters && /class="(?:figure|mathmd-table-float)"/.test(documentHtml);
  if (floats) documentHtml = await editDocument(page, () => {
    let float = 0, block = 0;
    for (const element of document.querySelectorAll<HTMLElement>(".figure, .mathmd-table-float")) element.setAttribute("data-mathmd-float", String(++float));
    for (const element of document.querySelectorAll<HTMLElement>("body > *, .mathmd-matter > *")) element.setAttribute("data-mathmd-block", String(++block));
  });
  await layOut();
  if (floats) {
    const moves = await chapterPageFloats(page);
    if (moves.length) {
      documentHtml = await editDocument(page, (moves) => {
        for (const move of moves) {
          const float = document.querySelector<HTMLElement>("[data-mathmd-float=\"" + move.float + "\"]");
          const before = move.before ? document.querySelector<HTMLElement>("[data-mathmd-block=\"" + move.before + "\"]") : null;
          if (move.bottom) float?.classList.add("mathmd-float-bottom");
          else if (float && before) before.before(float);
        }
      }, moves);
      await layOut();
    }
  }
  await applyPageStyles(page, String(result.config.layout?.page?.style ?? "plain"), documentClass === "report" || documentClass === "book", documentClass === "book" && /^ja/i.test(String(result.config.meta?.language)), /^ja/i.test(String(result.config.meta?.language)));
  if (chapters) await numberTocEntries(page, pageNumberStyle(result.config));
}

/** Loads the document to be paginated as it stands, changes it with the function, and returns it serialized. */
async function editDocument(page: Page, edit: (argument: any) => void, argument?: unknown): Promise<string> {
  await page.goto(ORIGIN + "/document.html");
  await page.evaluate(edit, argument);
  return "<!doctype html>\n" + await page.evaluate(() => document.documentElement.outerHTML);
}

/**
 * LaTeX sets no float at the top of a page that opens a chapter (\chapter sets \@topnum to 0). Finds the floats
 * placed there: each goes to the page bottom if it takes at most \bottomfraction (0.3) of the text block, and
 * otherwise to the top of the next page, before the first block that starts there.
 */
async function chapterPageFloats(page: Page): Promise<Array<{ float: string; bottom: boolean; before?: string }>> {
  return page.evaluate(() => {
    const moves: Array<{ float: string; bottom: boolean; before?: string }> = [];
    const seen = new Set<string>();
    const containers = [...document.querySelectorAll<HTMLElement>("[data-vivliostyle-page-container]")];
    containers.forEach((container, index) => {
      const area = container.querySelector<HTMLElement>("[data-vivliostyle-page-area]");
      for (const element of container.querySelectorAll<HTMLElement>("[data-mathmd-block]")) seen.add(element.getAttribute("data-mathmd-block")!);
      if (!area || !area.querySelector("h1.chapter, .toc-title")) return;
      // Vivliostyle sets page floats beside the page area, not in it.
      for (const float of container.querySelectorAll<HTMLElement>("[data-mathmd-float]:not(.mathmd-float-bottom)")) {
        if (float.getBoundingClientRect().top > area.querySelector<HTMLElement>("h1.chapter, .toc-title")!.getBoundingClientRect().top) continue;
        const id = float.getAttribute("data-mathmd-float")!;
        if (float.getBoundingClientRect().height <= 0.3 * area.getBoundingClientRect().height) { moves.push({ float: id, bottom: true }); continue; }
        const next = [...(containers[index + 1]?.querySelectorAll<HTMLElement>("[data-mathmd-block]") ?? [])].find((element) => !seen.has(element.getAttribute("data-mathmd-block")!) && !element.hasAttribute("data-mathmd-float"));
        moves.push({ float: id, bottom: false, before: next?.getAttribute("data-mathmd-block") ?? undefined });
      }
    });
    return moves;
  });
}

// Page styles follow LaTeX's \pagestyle: a marker switches the style from its page onward.
// Running heads replace the page number at the bottom, except on the title page and, in a report or book,
// on the opening page of a chapter, which are plain as with \maketitle and \chapter. jsbook's plain style
// puts the page number at the top outer corner instead (plainhead).
async function applyPageStyles(page: Page, initial: string, chapters: boolean, plainHead: boolean, japanese: boolean): Promise<void> {
  await page.evaluate(({ initialStyle, chapters, plainHead, japanese }) => {
    let style = initialStyle;
    for (const container of document.querySelectorAll<HTMLElement>("[data-vivliostyle-page-container]")) {
      const markers = container.querySelectorAll<HTMLElement>(".mathmd-pagestyle");
      if (markers.length) style = markers[markers.length - 1].getAttribute("data-name") ?? style;
      if (!["empty", "plain", "headings"].includes(style)) style = "plain";
      const pageStyle = style === "headings" && container.querySelector(chapters ? "h1.chapter, .toc-title, .document-title" : ".document-title") ? "plain" : style;
      container.setAttribute("data-mathmd-page-style", pageStyle);
      const headers = container.querySelectorAll<HTMLElement>("[data-vivliostyle-page-margin-box=top-left], [data-vivliostyle-page-margin-box=top-right]");
      const footer = container.querySelector<HTMLElement>("[data-vivliostyle-page-margin-box=bottom-center]");
      const outer = container.querySelector<HTMLElement>("[data-vivliostyle-page-margin-box=" + (container.getAttribute("data-vivliostyle-page-side") === "left" ? "top-left" : "top-right") + "]");
      // jsarticle's \\maketitle page keeps only the page number in the head under the headings style (headnombre).
      const numberOnly = pageStyle === "plain" && (plainHead || japanese && !chapters && style === "headings");
      if (pageStyle !== "headings") for (const header of headers) if (!(numberOnly && header === outer)) header.style.visibility = "hidden";
      if (numberOnly && outer) Object.assign(outer.style, { fontWeight: plainHead ? "normal" : "", borderBottom: "none" });
      if (footer && (pageStyle === "empty" || pageStyle === "headings" || numberOnly)) footer.style.visibility = "hidden";
    }
  }, { initialStyle: initial, chapters, plainHead, japanese });
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
