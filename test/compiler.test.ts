import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "../src/compiler.js";
import { Diagnostics } from "../src/diagnostics.js";
import { loadConfig } from "../src/config.js";

test("renders CommonMark, MathJax math, headings, and callouts", () => {
  const result = compile("# Intro\n\n## Detail\n\nInline $x^2$.\n\n> [!theorem]\n> A statement.\n");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /<h1>1\. Intro<\/h1>/);
  assert.match(result.html, /<h2>1\.1\. Detail<\/h2>/);
  assert.match(result.html, /class=\"MathJax\"/);
  assert.match(result.html, /callout-plain/);
});

test("supports root YAML, imports, last-wins values, and equation labels", () => {
  const source = "---\nmathmd:\n  meta:\n    language: ja\n  layout:\n    margins: 0mm\n    equation:\n      numbered: true\n---\n\n$$x \\label{eq:x}$$\n";
  const result = compile(source, "/tmp/document.md");
  assert.equal(result.config.meta.language, "ja");
  assert.equal(result.config.layout.margins, "0mm");
  assert.match(result.html, /id=\"eq:x\"/);
  assert.match(result.html, /equation-number/);
});

test("rejects unsupported phase-one values and invalid counter placeholders", () => {
  const diagnostics = new Diagnostics();
  loadConfig("---\nmathmd:\n  meta:\n    language: fr\n  layout:\n    class: book\n    callouts:\n      theorem:\n        title: \"Theorem {unknown.binary}\"\n---\ntext", "document.md", diagnostics);
  const codes = diagnostics.items.map((item) => item.code);
  assert.ok(codes.includes("UNSUPPORTED_LANGUAGE"));
  assert.ok(codes.includes("UNSUPPORTED_CLASS"));
  assert.ok(codes.includes("INVALID_COUNTER_TEMPLATE"));
});

test("control tags are self-closing HTML elements in the source language", () => {
  const result = compile("<maketoc />\n\n<pagebreak />\n\n<pagestyle name=\"empty\" />\n");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /mathmd-maketoc/);
  assert.match(result.html, /mathmd-pagebreak/);
  assert.match(result.html, /data-name=\"empty\"/);
});
