import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compile } from "../src/compiler.js";
import { FONT_FILES, fontFaceCss, installFonts, missingFontFiles } from "../src/fonts.js";
import { renderPdf } from "../src/pdf.js";

const response = (data: string, status = 200) => async () => ({ ok: status === 200, status, arrayBuffer: async () => new TextEncoder().encode(data).buffer as ArrayBuffer });

test("installs fonts only when the pinned checksum matches", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-fonts-"));
  const good = { file: "good.otf", url: "https://example.invalid/good.otf", sha256: crypto.createHash("sha256").update("good").digest("hex") };
  await installFonts({ directory, files: [good], fetcher: response("good") });
  assert.equal(fs.readFileSync(path.join(directory, "good.otf"), "utf8"), "good");
  const bad = { ...good, file: "bad.otf" };
  await assert.rejects(installFonts({ directory, files: [bad], fetcher: response("tampered") }), /Checksum mismatch for bad\.otf/);
  await assert.rejects(installFonts({ directory, files: [{ ...good, file: "missing.otf" }], fetcher: response("", 404) }), /HTTP 404/);
  assert.deepEqual(fs.readdirSync(directory), ["good.otf"]);
});

test("emits @font-face rules only for installed fonts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-fontface-"));
  assert.equal(fontFaceCss((file) => "/fonts/" + file, directory), "");
  fs.writeFileSync(path.join(directory, "HaranoAjiGothic-Medium.otf"), "");
  const css = fontFaceCss((file) => "/fonts/" + file, directory);
  assert.match(css, /font-family: "MarkTeXset Japanese"; src: url\("\/fonts\/HaranoAjiGothic-Medium\.otf"\) format\("opentype"\); font-weight: 700; font-style: normal/);
  assert.match(css, /font-weight: 700; font-style: italic/, "Japanese italic stays upright by reusing the same face");
  assert.doesNotMatch(css, /lmroman10/);
});

test("warns when the default fonts are not installed", async () => {
  const previous = process.env.MARKTEXSET_FONT_DIR;
  process.env.MARKTEXSET_FONT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-nofonts-"));
  try {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-nofonts-pdf-"));
    const result = compile("# Title\n\nText.\n");
    await renderPdf(result, path.join(directory, "document.pdf"), path.join(directory, "document.md"));
    assert.ok(result.diagnostics.items.some((item) => item.code === "FONT_NOT_INSTALLED" && item.severity === "warning"));
  } finally {
    if (previous === undefined) delete process.env.MARKTEXSET_FONT_DIR; else process.env.MARKTEXSET_FONT_DIR = previous;
  }
});

test("embeds Latin Modern and Harano Aji in PDF output", { skip: missingFontFiles().length ? "run 'marktexset fonts install' first" : false }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-fontpdf-"));
  const output = path.join(directory, "document.pdf");
  await renderPdf(compile("# Title\n\nEnglish text and 日本語の本文。\n"), output, path.join(directory, "document.md"));
  const fonts = execFileSync("pdffonts", [output], { encoding: "utf8" });
  assert.match(fonts, /LMRoman10-Regular/);
  assert.match(fonts, /HaranoAjiMincho-Regular/);
  assert.doesNotMatch(fonts, /Liberation|DejaVu/);
  assert.equal(FONT_FILES.length, 7);
});
