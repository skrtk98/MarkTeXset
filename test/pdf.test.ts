import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compile } from "../src/compiler.js";
import { renderPdf } from "../src/pdf.js";
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
  assert.match(first, /1\. Note on page one\./);
  assert.doesNotMatch(first, /Note on page two/);
  assert.match(second, /2\. Note on page two\./);
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
  assert.equal(first.filter((line) => line === "1. Alpha").length, 2, "headings style repeats the section in the running head");
  assert.equal(first.at(-1), "1");
  assert.ok(!second.includes("2"), "empty style hides the page number");
  assert.equal(second.filter((line) => line === "2. Beta").length, 1, "empty style has no running head");
  assert.equal(third.at(-1), "3", "plain style shows the page number");
  assert.equal(third.filter((line) => line === "3. Gamma").length, 1, "plain style has no running head");
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

test("breaks English paragraphs with flush right edges and keeps every word", { skip: missingFontFiles().length ? "run 'marktexset fonts install' first" : false }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-linebreak-"));
  const output = path.join(directory, "document.pdf");
  const paragraph = "Linear algebra studies vector spaces together with the maps that preserve their structure, and the kernel $\\ker T$ of a map consists of the vectors that $T$ sends to zero. *Characteristically*, the eigenvalues of a self-adjoint operator are real, which is the starting point of the spectral theorem and of the decomposition of a symmetric matrix.[^n] Uncharacteristically long words such as incomprehensibilities test hyphenation.";
  const result = compile("---\nmathmd:\n  meta:\n    language: en\n---\n\n" + paragraph + "\n\n" + paragraph + "\n\n[^n]: A note that must still wrap normally inside the footnote area even though it is long enough to need more than one line of text.\n");
  assert.equal(result.diagnostics.hasErrors, false);
  await renderPdf(result, output, path.join(directory, "document.md"));
  const xml = execFileSync("pdftotext", ["-bbox-layout", output, "-"], { encoding: "utf8" });
  const lines = parseBboxLayout(xml)[0].lines.filter((line) => line.yMax < 700);
  const right = Math.max(...lines.map((line) => line.xMax));
  const paragraphLines = lines.filter((line) => line.xMax - line.xMin > 300);
  assert.ok(paragraphLines.length >= 8);
  // All lines except each paragraph's last end at the same right edge.
  assert.ok(paragraphLines.filter((line) => right - line.xMax <= 0.5).length >= paragraphLines.length - 3, JSON.stringify(paragraphLines.map((line) => line.xMax)));
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
