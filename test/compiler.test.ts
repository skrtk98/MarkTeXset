import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket from "ws";
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

test("applies heading and callout attributes and diagnoses unresolved references", () => {
  const result = compile("# Intro {#intro .lead}\n\n> [!remark] Note {#note .warning}\n> Body\n\n[](#missing)\n");
  assert.equal(result.diagnostics.items.filter((item) => item.code === "UNRESOLVED_REFERENCE").length, 1);
  assert.match(result.html, /<h1 id=\"intro\" class=\"lead\">/);
  assert.match(result.html, /id=\"note\" class=\"callout callout-plain warning\"/);
  assert.match(result.html, /diagnostic-missing/);
});

test("rejects unsupported phase-one values and invalid counter placeholders", () => {
  const diagnostics = new Diagnostics();
  loadConfig("---\nmathmd:\n  meta:\n    language: fr\n  layout:\n    class: book\n    callouts:\n      theorem:\n        title: \"Theorem {unknown.binary}\"\n---\ntext", "document.md", diagnostics);
  const codes = diagnostics.items.map((item) => item.code);
  assert.ok(codes.includes("UNSUPPORTED_LANGUAGE"));
  assert.ok(codes.includes("UNSUPPORTED_CLASS"));
  assert.ok(codes.includes("INVALID_COUNTER_TEMPLATE"));
});

test("validates nested configuration keys and timezones", () => {
  const diagnostics = new Diagnostics();
  loadConfig("---\nmathmd:\n  meta:\n    timezone: Not/AZone\n    typo: true\n  layout:\n    heading:\n      unknown: true\n---\ntext", "document.md", diagnostics);
  const codes = diagnostics.items.map((item) => item.code);
  assert.ok(codes.includes("UNKNOWN_CONFIG_KEY"));
  assert.ok(codes.includes("INVALID_TIMEZONE"));
});

test("numbers multiline equations per row and rejects Callout-only forbidden blocks", () => {
  const result = compile("---\nmathmd:\n  layout:\n    equation:\n      numbered: true\n---\n$$a&=b\\\\c&=d \\notag$$\n\n> [!remark]\n> ```js\n> code\n> ```\n");
  assert.equal((result.html.match(/equation-number/g) ?? []).length, 1);
  assert.ok(result.diagnostics.items.some((item) => item.code === "CALLOUT_CODE_BLOCK"));
});

test("rejects duplicate IDs and citations without a references directive", () => {
  const result = compile("# One {#same}\n\n# Two {#same}\n\n[@key]");
  assert.ok(result.diagnostics.items.some((item) => item.code === "DUPLICATE_ID"));
  assert.ok(result.diagnostics.items.some((item) => item.code === "REFERENCES_DIRECTIVE_MISSING"));
  for (const item of result.diagnostics.items) assert.ok(item.location);
});

test("control tags are self-closing HTML elements in the source language", () => {
  const result = compile("<maketoc />\n\n<pagebreak />\n\n<pagestyle name=\"empty\" />\n");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /table-of-contents/);
  assert.match(result.html, /mathmd-pagebreak/);
  assert.match(result.html, /data-name=\"empty\"/);
});

test("build writes a sibling HTML file and does not overwrite without --force", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-build-"));
  const input = path.join(directory, "document.md");
  fs.writeFileSync(input, "# First\n");
  const cli = path.resolve("src/cli.ts");
  execFileSync(process.execPath, ["--import", "tsx", cli, "build", input], { encoding: "utf8" });
  const output = path.join(directory, "document.html");
  assert.match(fs.readFileSync(output, "utf8"), /First/);
  assert.throws(() => execFileSync(process.execPath, ["--import", "tsx", cli, "build", input], { encoding: "utf8", stdio: "pipe" }));
});

test("init creates the minimal English or Japanese frontmatter", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-init-"));
  const cli = path.resolve("src/cli.ts");
  execFileSync(process.execPath, ["--import", "tsx", cli, "init", path.join(directory, "en")], { encoding: "utf8" });
  execFileSync(process.execPath, ["--import", "tsx", cli, "init", path.join(directory, "ja.md"), "--language", "ja"], { encoding: "utf8" });
  assert.match(fs.readFileSync(path.join(directory, "en.md"), "utf8"), /language: en/);
  assert.match(fs.readFileSync(path.join(directory, "ja.md"), "utf8"), /title: \"無題の文書\"/);
});

test("preview serves HTML and broadcasts one reload after a source change", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-preview-"));
  const input = path.join(directory, "document.md");
  fs.writeFileSync(input, "# Before\n");
  const port = 34671;
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("src/cli.ts"), "preview", input, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("preview did not start")), 5000);
      child.stderr.on("data", (chunk) => { if (String(chunk).includes("Preview server running")) { clearTimeout(timeout); resolve(); } });
      child.on("error", reject);
    });
    const page = await fetch("http://127.0.0.1:" + port + "/").then((response) => response.text());
    assert.match(page, /Before/);
    const reload = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/__marktexset/ws");
      const timeout = setTimeout(() => { socket.close(); reject(new Error("reload was not received")); }, 5000);
      socket.on("message", (data) => {
        const message = JSON.parse(String(data));
        if (message.type === "reload") { clearTimeout(timeout); socket.close(); resolve(); }
      });
      socket.on("error", reject);
    });
    fs.writeFileSync(input, "# After\n");
    await reload;
    assert.match(await fetch("http://127.0.0.1:" + port + "/").then((response) => response.text()), /After/);
  } finally {
    child.kill("SIGTERM");
  }
});
