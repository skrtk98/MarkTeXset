import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compile } from "../src/compiler.js";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { pdfHtml, renderPdf } from "../src/pdf.js";
import { missingFontFiles } from "../src/fonts.js";
import { hyphenationPoints } from "../src/linebreak.js";
import { parseBboxLayout } from "../src/quality.js";

test("renders phase-two PDF output with MathML and page breaks", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-pdf-"));
  const output = path.join(directory, "document.pdf");
  const result = compile("# First\n\nInline $x^2$.\n\n<pagebreak />\n\n# Second\n");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /mjx-assistive-mml/);
  await renderPdf(result, output, path.join(directory, "document.md"));
  assert.ok(fs.statSync(output).size > 0);
  const metadata = execFileSync("pdfinfo", [output], { encoding: "utf8" });
  assert.match(metadata, /Pages:\s+2/);
});

test("reports an overflowing preformatted line during PDF layout", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-overflow-"));
  const output = path.join(directory, "document.pdf");
  const result = compile("# Overflow\n\n```text\n" + "x".repeat(180) + "\n```\n\n# After overflow\n\nThis content must remain in the PDF.\n");
  await renderPdf(result, output, path.join(directory, "document.md"));
  assert.ok(result.diagnostics.items.some((item) => item.code === "LAYOUT_OVERFLOW"));
  const text = execFileSync("pdftotext", [output, "-"], { encoding: "utf8" });
  assert.match(text, /After overflow/);
  assert.match(text, /This content must remain in the PDF/);
});

function pageText(pdf: string, page: number): string {
  return execFileSync("pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdf, "-"], { encoding: "utf8" });
}

test("places footnotes at the bottom of the page that references them", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-footnote-"));
  const output = path.join(directory, "document.pdf");
  const result = compile("# One\n\nFirst page text.[^a] Again.[^a]\n\n<pagebreak />\n\n# Two\n\nSecond page.[^b]\n\n[^a]: Note on page one.\n[^b]: Note on page two.\n");
  await renderPdf(result, output, path.join(directory, "document.md"));
  const first = pageText(output, 1);
  const second = pageText(output, 2);
  assert.match(first, /1\s*Note on page one\./);
  assert.doesNotMatch(first, /Note on page two/);
  assert.match(second, /2\s*Note on page two\./);
  assert.ok(first.indexOf("First page text") < first.indexOf("Note on page one"));
});

test("applies page styles from the page that follows a style marker", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-pagestyle-"));
  const output = path.join(directory, "document.pdf");
  const source = "---\nmathmd:\n  layout:\n    page:\n      style: headings\n---\n\n# Alpha\n\nText.\n\n<pagestyle name=\"empty\" />\n<pagebreak />\n\n# Beta\n\nText.\n\n<pagestyle name=\"plain\" />\n<pagebreak />\n\n# Gamma\n\nText.\n";
  const result = compile(source);
  assert.equal(result.diagnostics.hasErrors, false);
  await renderPdf(result, output, path.join(directory, "document.md"));
  const [first, second, third] = [1, 2, 3].map((page) => pageText(output, page).trim().split("\n").map((line) => line.trim()).filter(Boolean));
  assert.match(first[0], /^1\s{2,}ALPHA\s+1$/, "headings style sets the section a quad after its number and the page number in the head, as LaTeX's does");
  assert.ok(!first.slice(1).includes("1"), "headings style has no page number at the bottom");
  assert.ok(!second.includes("2"), "empty style hides the page number");
  assert.deepEqual(second.filter((line) => /Beta/i.test(line)).map((line) => line.replace(/\s+/g, " ")), ["2 Beta"], "empty style has no running head");
  assert.equal(third.at(-1), "3", "plain style shows the page number");
  assert.deepEqual(third.filter((line) => /Gamma/i.test(line)).map((line) => line.replace(/\s+/g, " ")), ["3 Gamma"], "plain style has no running head");
});

test("a book opens chapters on right-hand pages, numbers front matter in roman, and sets facing running heads", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-book-"));
  const output = path.join(directory, "document.pdf");
  const paragraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".repeat(6);
  const chapter = (name: string) => "# " + name + "\n\n" + paragraph + "\n\n## " + name + " section\n\n" + Array(8).fill(paragraph).join("\n\n") + "\n\n";
  const source = "---\nmathmd:\n  meta:\n    title: A Book\n  layout:\n    class: book\n---\n<maketitle />\n\n<frontmatter />\n\n<maketoc />\n\n# Preface\n\n" + paragraph + "\n\n<mainmatter />\n\n" + chapter("Alpha") + chapter("Beta") + "<backmatter />\n\n# Index\n\n" + paragraph + "\n";
  const result = compile(source);
  assert.deepEqual(result.diagnostics.items, []);
  await renderPdf(result, output, path.join(directory, "document.md"));
  assert.deepEqual(result.diagnostics.items, [], "the blank left-hand pages before chapters are intended");
  const pages = Array.from({ length: 15 }, (_, index) => pageText(output, index + 1).split("\n").map((line) => line.trim()).filter(Boolean));
  assert.equal(pages[0][0], "A Book");
  assert.ok(!pages[0].includes("1"), "the title page has no page number");
  assert.deepEqual(pages[1], [], "the back of the title page is blank");
  assert.deepEqual(pages[2].map((line) => line.replace(/(?: \.)+/g, "").replace(/\s+/g, " ")), ["Contents", "Preface iii", "1 Alpha 1", "1.1 Alpha section 1", "2 Beta 5", "2.1 Beta section 5", "Index 9", "i"], "the contents page is plain and lists front matter pages in roman");
  assert.deepEqual(pages[3], [], "a blank left-hand page has no running head or number");
  assert.deepEqual([pages[4][0], pages[4].at(-1)], ["Preface", "iii"]);
  assert.deepEqual([pages[6][0], pages[6][1], pages[6].at(-1)], ["Chapter 1", "Alpha", "1"], "a chapter opens on a plain right-hand page");
  assert.match(pages[7][0], /^2\s+CHAPTER 1\.\s+ALPHA$/, "a left-hand page has the page number and the chapter in its head");
  assert.ok(!pages[7].slice(1).includes("2"), "running-head pages have no page number at the bottom");
  assert.match(pages[8][0], /^1\.1\.\s+ALPHA SECTION\s+3$/, "a right-hand page has the section and the page number in its head");
  assert.deepEqual([pages[10][0], pages[14][0], pages[14].at(-1)], ["Chapter 2", "Index", "9"]);
});

test("a book still reports a blank left-hand page that no chapter explains", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-book-blank-"));
  const output = path.join(directory, "document.pdf");
  const result = compile("---\nmathmd:\n  layout:\n    class: book\n---\n# Alpha\n\nOne.\n\n<pagebreak />\n\n<pagebreak />\n\nTwo.\n");
  const before = result.diagnostics.items.filter((item) => item.code === "EMPTY_PAGE").length;
  await renderPdf(result, output, path.join(directory, "document.md"));
  assert.equal(result.diagnostics.items.filter((item) => item.code === "EMPTY_PAGE").length, before + 1);
});

test("the table of contents prints page numbers in the style of the page number format", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-toc-style-"));
  for (const documentClass of ["article", "report"]) {
    const output = path.join(directory, documentClass + ".pdf");
    const result = compile("---\nmathmd:\n  layout:\n    class: " + documentClass + "\n    page:\n      number:\n        format: \"- {page.Roman} -\"\n---\n<maketoc />\n\n<pagebreak />\n\n# Alpha\n\nOne.\n\n<pagebreak />\n\n# Beta\n\nTwo.\n");
    await renderPdf(result, output, path.join(directory, "document.md"));
    const contents = pageText(output, 1).split("\n").map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean);
    assert.ok(contents.some((line) => /Alpha II$/.test(line)), documentClass + ": " + contents.join(" | "));
    assert.ok(contents.some((line) => /Beta III$/.test(line)), documentClass + ": " + contents.join(" | "));
    assert.equal(result.diagnostics.items.filter((item) => item.code === "EMPTY_PAGE").length, 0, "a page break before a chapter adds no empty page");
  }
});

test("a report starts each chapter on a new page after a title page", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-report-"));
  const output = path.join(directory, "document.pdf");
  const result = compile("---\nmathmd:\n  meta:\n    title: A Report\n  layout:\n    class: report\n---\n<maketitle />\n\n# Alpha\n\nOne.\n\n# Beta\n\nTwo.\n");
  await renderPdf(result, output, path.join(directory, "document.md"));
  assert.deepEqual(result.diagnostics.items, []);
  assert.match(execFileSync("pdfinfo", [output], { encoding: "utf8" }), /Pages:\s+3/);
  const pages = [1, 2, 3].map((page) => pageText(output, page).split("\n").map((line) => line.trim()).filter(Boolean));
  assert.deepEqual(pages, [["A Report", new Date().toISOString().slice(0, 10)], ["Chapter 1", "Alpha", "One.", "1"], ["Chapter 2", "Beta", "Two.", "2"]]);
});

test("splits long paragraphs across pages instead of pushing them to the next page", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-paragraph-"));
  const output = path.join(directory, "document.pdf");
  const filler = Array.from({ length: 40 }, (_, index) => "Filler paragraph " + index + ".").join("\n\n");
  const long = Array.from({ length: 60 }, (_, index) => "Sentence" + index + " continues the long paragraph.").join(" ");
  const result = compile("# Start\n\n" + filler + "\n\n" + long + "\n");
  await renderPdf(result, output, path.join(directory, "document.md"));
  const first = pageText(output, 1);
  const second = pageText(output, 2);
  assert.match(first, /Sentence0 continues/);
  assert.match(second, /Sentence59 continues/);
  const css = result.html.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? "";
  assert.match(css, /hyphens:auto/);
  assert.match(css, /:lang\(ja\)\{line-break:strict/);
});

test("breaks English paragraphs with flush right edges, protruding punctuation, and every word kept", { skip: missingFontFiles().length ? "run 'marktexset fonts install' first" : false }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-linebreak-"));
  const output = path.join(directory, "document.pdf");
  const paragraph = "Linear algebra studies vector spaces together with the maps that preserve their structure, and the kernel $\\ker T$ of a map consists of the vectors that $T$ sends to zero. *Characteristically*, the eigenvalues of a self-adjoint operator are real, which is the starting point of the spectral theorem and of the decomposition of a symmetric matrix.[^n] Uncharacteristically long words such as incomprehensibilities test hyphenation.";
  const result = compile("---\nmathmd:\n  meta:\n    language: en\n---\n\n" + paragraph + "\n\n" + paragraph + "\n\n[^n]: A note that must still wrap normally inside the footnote area even though it is long enough to need more than one line of text.\n");
  assert.equal(result.diagnostics.hasErrors, false);
  await renderPdf(result, output, path.join(directory, "document.md"));
  const xml = execFileSync("pdftotext", ["-bbox-layout", output, "-"], { encoding: "utf8" });
  const lines = parseBboxLayout(xml)[0].lines.filter((line) => line.yMax < 700);
  const paragraphLines = lines.filter((line) => line.xMax - line.xMin > 300);
  assert.ok(paragraphLines.length >= 8);
  const hanging = (line: { text: string }) => /[.,;:‐-]$/.test(line.text.trim());
  const edges = paragraphLines.filter((line) => !hanging(line)).map((line) => line.xMax.toFixed(1));
  const right = Number(edges.sort((a, b) => edges.filter((edge) => edge === b).length - edges.filter((edge) => edge === a).length)[0]);
  // All lines except each paragraph's last end at the same right edge; punctuation and hyphens hang slightly past it.
  assert.ok(paragraphLines.filter((line) => Math.abs(right - line.xMax) <= 0.5 || hanging(line)).length >= paragraphLines.length - 3, JSON.stringify(paragraphLines.map((line) => line.xMax)));
  const protruding = paragraphLines.filter((line) => hanging(line) && line.xMax > right + 0.5);
  assert.ok(protruding.length >= 1, "line-final punctuation and hyphens protrude into the margin: " + JSON.stringify(paragraphLines.map((line) => [line.xMax, line.text.slice(-12)])));
  assert.ok(protruding.every((line) => line.xMax < right + 4), "protrusion stays within part of a character");
  const words = (text: string) => text.replace(/[‐-]\n/g, "").replace(/\s+/g, " ");
  const text = words(execFileSync("pdftotext", [output, "-"], { encoding: "utf8" }));
  for (const word of ["Characteristically", "incomprehensibilities", "decomposition", "hyphenation."]) assert.ok(text.includes(word), word);
  assert.match(text, /A note that must still wrap normally/);
});

test("accepts the browser line-break mode and rejects unknown modes", () => {
  assert.equal(compile("---\nmathmd:\n  layout:\n    line-break: browser\n---\n\nText.\n").diagnostics.hasErrors, false);
  assert.ok(compile("---\nmathmd:\n  layout:\n    line-break: greedy\n---\n\nText.\n").diagnostics.items.some((item) => item.code === "UNSUPPORTED_LINE_BREAK"));
});

test("finds TeX hyphenation points respecting the minimum fragment lengths", () => {
  const points = hyphenationPoints(["decomposition", "the", "eigenvalue", "x2"]);
  assert.deepEqual(points.decomposition.map((offset) => "decomposition".slice(0, offset)), ["de", "decom", "decompo", "decomposi"]);
  assert.deepEqual(points.the, []);
  assert.deepEqual(points.x2, []);
  assert.ok(points.eigenvalue.every((offset) => offset >= 2 && "eigenvalue".length - offset >= 3));
});

test("adds page numbers to the table of contents, an outline, tags, and document metadata", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-toc-"));
  const output = path.join(directory, "document.pdf");
  const result = compile("---\nmathmd:\n  meta:\n    title: Spectra\n    language: en\n    author:\n      - name: Ada Lovelace\n      - name: Emmy Noether\n---\n\n<maketitle />\n\n<maketoc />\n\n# One\n\n## Sub one\n\nText.\n\n<pagebreak />\n\n# Two {#two}\n\nText.\n\n<pagebreak />\n\n# Three\n\nEnd.\n");
  assert.equal(result.diagnostics.items.length, 0, JSON.stringify(result.diagnostics.items));
  await renderPdf(result, output, path.join(directory, "document.md"));
  const toc = pageText(output, 1);
  for (const [entry, page] of [["1 One", 1], ["1.1 Sub one", 1], ["2 Two", 2], ["3 Three", 3]] as const) assert.match(toc, new RegExp(entry.replace(/\./g, "\\.") + "[\\s.]+" + page + "\\n"), entry);
  const info = execFileSync("pdfinfo", [output], { encoding: "utf8" });
  assert.match(info, /Title:\s+Spectra/);
  assert.match(info, /Author:\s+Ada Lovelace, Emmy Noether/);
  assert.match(info, /Tagged:\s+yes/);
  const raw = fs.readFileSync(output).toString("latin1");
  assert.match(raw, /\/Lang \(en\)/);
  const pdf = await PDFDocument.load(fs.readFileSync(output));
  const outline: string[] = [];
  const walk = (node: PDFDict | undefined, depth: number) => {
    for (let item = node?.lookupMaybe(PDFName.of("First"), PDFDict); item; item = item.lookupMaybe(PDFName.of("Next"), PDFDict)) {
      outline.push("  ".repeat(depth) + (item.lookup(PDFName.of("Title")) as PDFHexString | PDFString).decodeText());
      walk(item, depth + 1);
    }
  };
  walk(pdf.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict), 0);
  assert.deepEqual(outline, ["Contents", "1 One", "  1.1 Sub one", "2 Two", "3 Three"]);
});

test("prints page numbers in the configured counter format", () => {
  const result = compile("---\nmathmd:\n  layout:\n    page:\n      number:\n        format: \"- {page.roman} -\"\n---\n\nText.\n");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(pdfHtml(result.html, result.config, process.cwd()), /content:\s*"- " counter\(page, lower-roman\) " -"/);
});

test("puts LuaTeX-ja's xkanjiskip between Japanese and Latin text or inline math, in place of written spaces", () => {
  const result = compile("---\nmathmd:\n  meta:\n    language: ja\n---\n\n# 第1章の話\n\n体 $F$ 上の写像 T は、SOR法で `code` を使う。*強調text*と(1)、「A」。\n");
  const body = pdfHtml(result.html, result.config, ".").split("<body")[1]
    .replace(/<span class="math-render">[\s\S]*?<\/mjx-container><\/span><\/span>/g, "$")
    .replace(/<span class="mathmd-xkanjiskip"> <\/span>/g, "~");
  assert.match(body, /<p>体~\$~上の写像~T~は、SOR~法で~<code>code<\/code>~を使う。<em>強調~text<\/em>~と\(1\)、「A」。<\/p>/);
  assert.match(body, />第~1~章の話</, "a heading is spaced, but not its number against the title");
  assert.match(pdfHtml(result.html, result.config, "."), /:lang\(ja\) \{ text-autospace: no-autospace; \}/);
  const english = compile("English $x$ and 日本語 text.\n");
  assert.doesNotMatch(pdfHtml(english.html, english.config, "."), /<span class="mathmd-xkanjiskip">/, "only Japanese documents get xkanjiskip");
});

test("sets no float at the top of a chapter's opening page: a small one goes to its bottom, a tall one to the next page", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-chapter-floats-"));
  const output = path.join(directory, "document.pdf");
  const paragraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".repeat(4);
  const table = (name: string, rows: number) => "| A | B |\n|---|---|\n" + "| x | y |\n".repeat(rows) + "\n: " + name + "\n\n";
  const source = "---\nmathmd:\n  layout:\n    class: report\n---\n# Alpha\n\n" + paragraph + "\n\n" + table("Small table", 2) + Array(6).fill(paragraph).join("\n\n") + "\n\n# Beta\n\n" + paragraph + "\n\n" + table("Tall table", 30) + Array(8).fill(paragraph).join("\n\n") + "\n";
  const result = compile(source);
  await renderPdf(result, output, path.join(directory, "document.md"));
  const pages = Array.from({ length: 4 }, (_, index) => pageText(output, index + 1).split("\n").map((line) => line.trim()).filter(Boolean));
  assert.equal(pages[0][0], "Chapter 1");
  const small = pages[0].findIndex((line) => line.startsWith("Table 1.1"));
  assert.ok(small > pages[0].findIndex((line) => line.startsWith("Lorem")), "the small table sits below the text of the chapter's first page");
  const beta = pages.findIndex((page) => page[0] === "Chapter 2");
  assert.ok(!pages[beta].some((line) => line.startsWith("Table 2.1")), "the tall table leaves the chapter's first page");
  assert.ok(pages[beta + 1][0].startsWith("Table 2.1"), "and heads the next page");
});
