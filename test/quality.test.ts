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

test("protruding Latin punctuation at the line end is not reported as overfull", () => {
  const lines = [...Array.from({ length: 10 }, (_, index) => line(100 + index * 12, 500, "a full justified line of body text")), line(300, 502, "a line that ends with a hyphen-"), line(312, 502, "a line that ends with a comma,"), line(324, 502, "a line that ends with a letter")];
  assert.equal(analyzeLayout(parseBboxLayout(page(lines))).overfullLines, 1);
});

for (const language of ["en", "ja"]) {
  test(`quality sample (${language}) meets the typesetting criteria`, async () => {
    const input = path.resolve("examples/quality/prose." + language + ".md");
    const result = compileFile(input);
    assert.deepEqual(result.diagnostics.items.map((item) => item.code), []);
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-quality-")), "prose.pdf");
    await renderPdf(result, output, input);
    const report = analyzePdf(output);
    assert.equal(report.overfullLines, 0);
    assert.equal(report.kinsokuViolations, 0);
    assert.ok(report.maxConsecutiveHyphens <= 2, "at most two consecutive hyphenated lines");
    assert.ok(report.bottomWhitespace.max < 0.15, "pages are filled except for the last");
    if (!missingFontFiles().length) {
      assert.deepEqual(report.fallbackFonts, []);
      assert.deepEqual(report.unembeddedFonts, []);
      assert.ok(report.fonts.includes("LMRoman10-Regular"));
      if (language === "ja") assert.ok(report.fonts.includes("HaranoAjiMincho-Regular"));
    }
  });
}
