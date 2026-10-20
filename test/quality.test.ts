import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileFile } from "../src/compiler.js";
import { missingFontFiles } from "../src/fonts.js";
import { renderPdf } from "../src/pdf.js";
import { analyzeLayout, analyzePdf, parseBboxLayout } from "../src/quality.js";

const line = (y: number, xMax: number, text: string) => `<line xMin="72" yMin="${y}" xMax="${xMax}" yMax="${y + 10}">${text.split(" ").map((word) => `<word xMin="0" yMin="0" xMax="0" yMax="0">${word}</word>`).join("")}</line>`;
const page = (lines: string[]) => `<page width="595" height="842"><flow><block>${lines.join("")}</block></flow></page>`;

test("layout metrics detect overfull lines, hyphen runs, and kinsoku violations but ignore running heads", () => {
  const body = (extra: string[]) => [line(40, 300, "Running head"), ...Array.from({ length: 10 }, (_, index) => line(100 + index * 12, 500, "a full justified line of body text")), ...extra, line(800, 300, "1")];
  const pages = parseBboxLayout(page(body([line(300, 520, "an overfull line of body text here"), line(312, 500, "hyphen at the end of this exam‐"), line(324, 500, "ple and another hyphen-")])) + page(body([line(400, 480, "、行頭に読点がある行"), line(412, 500, "行末に括弧がある行「")])));
  const report = analyzeLayout(pages);
  assert.equal(report.pages, 2);
  assert.equal(report.overfullLines, 1);
  assert.equal(report.hyphenatedLineEnds, 2);
  assert.equal(report.maxConsecutiveHyphens, 2);
  assert.equal(report.kinsokuViolations, 2);
  assert.equal(pages.flatMap((item) => item.lines).length - report.bodyLines, 4, "running heads and page numbers are excluded");
});

test("line-end punctuation set half-width is not reported as overfull", () => {
  const lines = [...Array.from({ length: 10 }, (_, index) => line(100 + index * 12, 500, "日本語の本文がここまで続いている")), line(300, 505, "行末に読点がくる行、")];
  assert.equal(analyzeLayout(parseBboxLayout(page(lines))).overfullLines, 0);
});

test("merges line fragments split by inline math into one visual line", () => {
  const fragments = `<line xMin="72" yMin="100" xMax="200" yMax="112"><word xMin="72" yMin="100" xMax="200" yMax="112">（</word></line><line xMin="230" yMin="101" xMax="500" yMax="112"><word xMin="230" yMin="101" xMax="500" yMax="112">）が列フルランクのとき</word></line>`;
  const [visual] = parseBboxLayout(page([fragments])).flatMap((item) => item.lines);
  assert.equal(visual.text, "（ ）が列フルランクのとき");
  assert.equal(visual.xMin, 72);
  assert.equal(visual.xMax, 500);
  assert.equal(analyzeLayout(parseBboxLayout(page([...Array.from({ length: 10 }, (_, index) => line(130 + index * 12, 500, "本文の行がここまで続いている")), fragments]))).kinsokuViolations, 0);
});

test("measures how far Japanese lines are letter-spaced beyond the usual pitch", () => {
  const japanese = (y: number, xMax: number, text: string) => `<line xMin="72" yMin="${y}" xMax="${xMax}" yMax="${y + 14}"><word xMin="72" yMin="${y}" xMax="${xMax}" yMax="${y + 14}">${text}</word></line>`;
  const normal = Array.from({ length: 10 }, (_, index) => japanese(100 + index * 17, 72 + 20 * 10, "本文の行がここまで続く"));
  assert.equal(analyzeLayout(parseBboxLayout(page(normal))).maxLetterSpacing, 0);
  const spread = analyzeLayout(parseBboxLayout(page([...normal, japanese(300, 72 + 26 * 10, "字間が空いた行になった")]))).maxLetterSpacing;
  assert.ok(Math.abs(spread - 0.3) < 1e-9, String(spread));
});

test("counts space left above footnotes as unused", () => {
  const body = (count: number) => Array.from({ length: count }, (_, index) => line(100 + index * 12, 500, "a full justified line of body text"));
  const note = (y: number) => line(y, 400, "1. A footnote at the bottom of the page.");
  const full = page([...body(50), note(712)]);
  const short = page([...body(40), note(712)]);
  const last = page(body(3));
  assert.equal(analyzeLayout(parseBboxLayout(full + last)).bottomWhitespace.max, 0);
  assert.ok(analyzeLayout(parseBboxLayout(short + last)).bottomWhitespace.max > 0.15);
});

test("protruding Latin punctuation at the line end is not reported as overfull", () => {
  const lines = [...Array.from({ length: 10 }, (_, index) => line(100 + index * 12, 500, "a full justified line of body text")), line(300, 502, "a line that ends with a hyphen-"), line(312, 502, "a line that ends with a comma,"), line(324, 502, "a line that ends with a letter")];
  assert.equal(analyzeLayout(parseBboxLayout(page(lines)), [], { protrusion: true }).overfullLines, 1);
  assert.equal(analyzeLayout(parseBboxLayout(page(lines))).overfullLines, 3, "PDFs without protrusion get no allowance");
});

for (const sample of ["prose.en", "prose.ja", "structure.en", "structure.ja", "chapters.en", "chapters.ja"]) {
  const language = sample.slice(-2);
  test(`quality sample (${sample}) meets the typesetting criteria`, async () => {
    const input = path.resolve("examples/quality/" + sample + ".md");
    const result = compileFile(input);
    assert.deepEqual(result.diagnostics.items.map((item) => item.code), []);
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-quality-")), sample + ".pdf");
    await renderPdf(result, output, input);
    const report = analyzePdf(output, { protrusion: true, chapters: result.config.layout.class !== "article" });
    assert.equal(report.overfullLines, 0);
    assert.equal(report.kinsokuViolations, 0);
    assert.ok(report.maxLetterSpacing < 0.1, "no Japanese line is spread out to fill the measure: +" + (report.maxLetterSpacing * 100).toFixed(1) + "%");
    assert.ok(report.maxConsecutiveHyphens <= 2, "at most two consecutive hyphenated lines");
    assert.ok(report.bottomWhitespace.max < 0.15, "pages are filled except for the last");
    if (!missingFontFiles().length) {
      assert.deepEqual(report.fallbackFonts, [], "no text falls back to system fonts, such as unrendered TeX");
      assert.deepEqual(report.unembeddedFonts, []);
      assert.ok(report.fonts.includes("LMRoman10-Regular"));
      if (language === "ja") assert.ok(report.fonts.includes("HaranoAjiMincho-Regular"));
    }
  });
}
