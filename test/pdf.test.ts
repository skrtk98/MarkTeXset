import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compile } from "../src/compiler.js";
import { renderPdf } from "../src/pdf.js";

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
