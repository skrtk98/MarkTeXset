import { execFileSync } from "node:child_process";

export interface TextLine { xMin: number; xMax: number; yMin: number; yMax: number; text: string; }
export interface PdfPage { width: number; height: number; lines: TextLine[]; }

export interface QualityReport {
  pages: number;
  bodyLines: number;
  /** Mean and worst share of the text block left empty at the bottom of non-final pages. */
  bottomWhitespace: { mean: number; max: number };
  /** Lines that extend past the right edge of the text block by more than 1.5pt. */
  overfullLines: number;
  hyphenatedLineEnds: number;
  maxConsecutiveHyphens: number;
  /** Japanese lines that start or end with a character JIS X 4051 forbids there. */
  kinsokuViolations: number;
  fonts: string[];
  fallbackFonts: string[];
  unembeddedFonts: string[];
}

const LINE_START_FORBIDDEN = new Set([..."、。，．・：；？！）」』】〕〉》｝］ゝゞーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖ々…‥"]);
const LINE_END_FORBIDDEN = new Set([..."（「『【〔〈《｛［"]);
// Line-end punctuation is set half-width (JIS X 4051), but its glyph box still reports a full em.
const HALF_WIDTH_AT_LINE_END = new Set([..."、。，．）」』】〕〉》｝］"]);
// With microtype (loaded by Pandoc's LaTeX template), these hang into the right margin; that is protrusion, not overflow.
const PROTRUDING_AT_LINE_END = /[-\u2010.,;:!?)\]\u2019\u201d]$/;

function lineEndAllowance(line: TextLine, protrusion: boolean): number {
  const text = line.text.trim();
  const height = line.yMax - line.yMin;
  if (HALF_WIDTH_AT_LINE_END.has([...text].at(-1) ?? "")) return height / 2;
  return protrusion && PROTRUDING_AT_LINE_END.test(text) ? height * 0.3 : 0;
}

/** `protrusion` allows Latin punctuation to hang into the margin, for PDFs typeset with microtype. */
export interface AnalyzeOptions { protrusion?: boolean; }
const FALLBACK_FONTS = /Liberation|DejaVu|Noto(?!.*CJK)|Arial|Helvetica|Times|Nimbus/i;

const decode = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const number = (attributes: string, name: string) => Number(attributes.match(new RegExp(name + "=\"([^\"]+)\""))?.[1] ?? "0");

/** Parses `pdftotext -bbox-layout` output into pages of positioned lines. */
export function parseBboxLayout(xml: string): PdfPage[] {
  const pages: PdfPage[] = [];
  for (const page of xml.matchAll(/<page ([^>]*)>([\s\S]*?)<\/page>/g)) {
    const lines: TextLine[] = [];
    for (const line of page[2].matchAll(/<line ([^>]*)>([\s\S]*?)<\/line>/g)) {
      const words = [...line[2].matchAll(/<word [^>]*>([\s\S]*?)<\/word>/g)].map((word) => decode(word[1]));
      lines.push({ xMin: number(line[1], "xMin"), xMax: number(line[1], "xMax"), yMin: number(line[1], "yMin"), yMax: number(line[1], "yMax"), text: words.join(" ") });
    }
    pages.push({ width: number(page[1], "width"), height: number(page[1], "height"), lines });
  }
  return pages;
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

// Running heads and page numbers are set apart from the body by a wide gap and recur at the
// same height on most pages (a page number may also stand alone); they are not body text.
function bodyLines(pages: PdfPage[]): TextLine[][] {
  const counts = new Map<number, number>();
  for (const page of pages) for (const y of new Set(page.lines.map((line) => Math.round(line.yMin)))) counts.set(y, (counts.get(y) ?? 0) + 1);
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  const sortedPages = pages.map((page) => [...page.lines].sort((a, b) => a.yMin - b.yMin));
  const gaps = sortedPages.flatMap((lines) => lines.slice(1).map((line, index) => line.yMin - lines[index].yMin)).filter((gap) => gap > 1);
  const wide = 1.8 * percentile(gaps, 0.5);
  return sortedPages.map((lines) => {
    const running = (line: TextLine | undefined, gap: number) => line !== undefined && gap > wide && line.text.length < 80 && ((counts.get(Math.round(line.yMin)) ?? 0) >= threshold || /^\d+$/.test(line.text.trim()));
    const head = running(lines[0], (lines[1]?.yMin ?? Infinity) - (lines[0]?.yMin ?? 0)) ? lines[0] : undefined;
    const foot = lines.length > 1 && running(lines.at(-1), lines.at(-1)!.yMin - lines.at(-2)!.yMin) ? lines.at(-1) : undefined;
    return lines.filter((line) => line !== head && line !== foot);
  });
}

export function analyzeLayout(pages: PdfPage[], fontList: string[] = [], options: AnalyzeOptions = {}): QualityReport {
  const body = bodyLines(pages);
  const all = body.flat();
  // Justified body lines share the right edge, so the median right edge of long lines marks the text block.
  const widest = Math.max(0, ...all.map((line) => line.xMax - line.xMin));
  const right = percentile(all.filter((line) => line.xMax - line.xMin >= 0.6 * widest).map((line) => line.xMax), 0.5);
  const top = percentile(body.filter((lines) => lines.length).map((lines) => Math.min(...lines.map((line) => line.yMin))), 0.1);
  const bottom = percentile(body.filter((lines) => lines.length).map((lines) => Math.max(...lines.map((line) => line.yMax))), 0.9);
  const whitespace = body.slice(0, -1).filter((lines) => lines.length).map((lines) => Math.max(0, (bottom - Math.max(...lines.map((line) => line.yMax))) / Math.max(1, bottom - top)));
  let hyphenated = 0;
  let consecutive = 0;
  let maxConsecutive = 0;
  for (const lines of body) for (const line of [...lines].sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)) {
    if (/[A-Za-z][-\u2010\u00ad]$/.test(line.text)) { hyphenated++; consecutive++; maxConsecutive = Math.max(maxConsecutive, consecutive); }
    else consecutive = 0;
  }
  const japanese = all.filter((line) => /[぀-ヿ一-鿿]/.test(line.text));
  const kinsoku = japanese.filter((line) => LINE_START_FORBIDDEN.has([...line.text.trim()][0] ?? "") || LINE_END_FORBIDDEN.has([...line.text.trim()].at(-1) ?? "")).length;
  const fonts = fontList.map((font) => font.replace(/^[A-Z]{6}\+/, "").split(/\s+/)[0]);
  return {
    pages: pages.length,
    bodyLines: all.length,
    bottomWhitespace: { mean: whitespace.length ? whitespace.reduce((sum, value) => sum + value, 0) / whitespace.length : 0, max: whitespace.length ? Math.max(...whitespace) : 0 },
    overfullLines: all.filter((line) => line.xMax - lineEndAllowance(line, options.protrusion === true) > right + 1.5).length,
    hyphenatedLineEnds: hyphenated,
    maxConsecutiveHyphens: maxConsecutive,
    kinsokuViolations: kinsoku,
    fonts: [...new Set(fonts)].sort(),
    fallbackFonts: [...new Set(fonts.filter((font) => FALLBACK_FONTS.test(font)))].sort(),
    unembeddedFonts: [...new Set(fontList.filter((font) => / no +(?:yes|no) +(?:yes|no) +\d+ +\d+$/.test(font)).map((font) => font.split(/\s+/)[0]))].sort(),
  };
}

/** Analyzes a PDF with Poppler's pdftotext and pdffonts. */
export function analyzePdf(file: string, options: AnalyzeOptions = {}): QualityReport {
  const xml = execFileSync("pdftotext", ["-bbox-layout", file, "-"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const fonts = execFileSync("pdffonts", [file], { encoding: "utf8" }).split("\n").slice(2).filter((line) => line.trim());
  return analyzeLayout(parseBboxLayout(xml), fonts, options);
}

const percent = (value: number) => (value * 100).toFixed(1) + "%";

export function formatReports(reports: Array<{ name: string; report: QualityReport }>): string {
  const rows: Array<[string, (report: QualityReport) => string]> = [
    ["Pages", (report) => String(report.pages)],
    ["Body lines", (report) => String(report.bodyLines)],
    ["Bottom whitespace (mean / max)", (report) => percent(report.bottomWhitespace.mean) + " / " + percent(report.bottomWhitespace.max)],
    ["Overfull lines", (report) => String(report.overfullLines)],
    ["Hyphenated line ends (max run)", (report) => report.hyphenatedLineEnds + " (" + report.maxConsecutiveHyphens + ")"],
    ["Kinsoku violations", (report) => String(report.kinsokuViolations)],
    ["Fonts", (report) => report.fonts.join(", ")],
    ["Fallback / unembedded fonts", (report) => [...report.fallbackFonts, ...report.unembeddedFonts].join(", ") || "none"],
  ];
  const header = "| Metric | " + reports.map((item) => item.name).join(" | ") + " |\n|---|" + reports.map(() => "---|").join("") + "\n";
  return header + rows.map(([label, value]) => "| " + label + " | " + reports.map((item) => value(item.report)).join(" | ") + " |").join("\n") + "\n";
}
