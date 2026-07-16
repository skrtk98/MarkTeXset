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
