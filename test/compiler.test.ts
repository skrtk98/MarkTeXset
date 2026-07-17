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

test("renders inline and block math inside Callouts", () => {
  const result = compile("> [!theorem] A theorem\n> Inline $x^2$ and:\n>\n> $$a^2+b^2=c^2$$\n");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.ok((result.html.match(/MathJax/g) ?? []).length >= 2);
});

test("keeps the proof QED marker inside the Callout body", () => {
  const result = compile("---\nmathmd:\n  layout:\n    callouts:\n      proof:\n        title: Proof\n        style: proof\n---\n\n> [!proof]\n> The proof ends here.\n");
  assert.match(result.html, /<div class="callout-body">[\s\S]*<span class="qed">□<\/span><\/div>/);
  assert.match(result.html, /\.qed\{display:block;text-align:right/);
  assert.doesNotMatch(result.html, /\.qed\{float:right/);
});

test("keeps adjacent Callouts as separate environments", () => {
  const result = compile("> [!theorem] First\n> One.\n\n> [!definition] Second\n> Two.\n");
  assert.equal((result.html.match(/class=\"callout /g) ?? []).length, 2);
  assert.doesNotMatch(result.html, /<p><div[^>]*class=\"callout/);
  assert.match(result.html, /First[\s\S]*Second/);
});

test("does not number the generated document title or duplicate it in the TOC", () => {
  const result = compile("---\nmathmd:\n  meta:\n    title: Sample\n---\n<maketitle />\n<maketoc />\n# Heading\n");
  assert.match(result.html, /<h1 class=\"document-title-heading\">Sample<\/h1>/);
  assert.doesNotMatch(result.html, /document-title-heading[^>]*>1\. Sample/);
  assert.doesNotMatch(result.html, /<nav class=\"table-of-contents\">[\s\S]*Sample/);
});

test("indents nested TOC entries and respects toc-depth", () => {
  const result = compile("---\nmathmd:\n  layout:\n    heading:\n      toc-depth: 2\n---\n<maketoc />\n# One\n## Two\n### Three\n");
  assert.match(result.html, /<li class=\"toc-level-1\">/);
  assert.match(result.html, /<li class=\"toc-level-2\">/);
  assert.doesNotMatch(result.html, /<nav class=\"table-of-contents\">[\s\S]*toc-level-3/);
  assert.match(result.html, /\.toc-level-2\{padding-left:1\.5em\}/);
  assert.match(result.html, /<h2 class=\"toc-title\">Contents<\/h2>/);
});

test("allows configuring the table of contents heading", () => {
  const result = compile("---\nmathmd:\n  layout:\n    heading:\n      toc: Inhaltsverzeichnis\n---\n<maketoc />\n# Heading\n");
  assert.match(result.html, /<h2 class=\"toc-title\">Inhaltsverzeichnis<\/h2>/);
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

test("falls back unsupported phase-three languages and rejects invalid counter placeholders", () => {
  const diagnostics = new Diagnostics();
  loadConfig("---\nmathmd:\n  meta:\n    language: fr\n  layout:\n    class: book\n    callouts:\n      theorem:\n        title: \"Theorem {unknown.binary}\"\n---\ntext", "document.md", diagnostics);
  const codes = diagnostics.items.map((item) => item.code);
  assert.ok(codes.includes("UNSUPPORTED_LANGUAGE_FALLBACK"));
  assert.ok(codes.includes("UNSUPPORTED_CLASS"));
  assert.ok(codes.includes("INVALID_COUNTER_TEMPLATE"));
});

test("accepts BCP 47 language tags and falls back unsupported tags to English", () => {
  const japanese = loadConfig("---\nmathmd:\n  meta:\n    language: ja-JP\n---\ntext", "document.md", new Diagnostics());
  assert.equal(japanese.config.meta.language, "ja-JP");

  const diagnostics = new Diagnostics();
  const french = loadConfig("---\nmathmd:\n  meta:\n    language: fr-FR\n---\ntext", "document.md", diagnostics);
  assert.equal(french.config.meta.language, "en");
  assert.ok(diagnostics.items.some((item) => item.code === "UNSUPPORTED_LANGUAGE_FALLBACK"));
});

test("validates nested configuration keys and timezones", () => {
  const diagnostics = new Diagnostics();
  loadConfig("---\nmathmd:\n  meta:\n    timezone: Not/AZone\n    typo: true\n  layout:\n    heading:\n      unknown: true\n---\ntext", "document.md", diagnostics);
  const codes = diagnostics.items.map((item) => item.code);
  assert.ok(codes.includes("UNKNOWN_CONFIG_KEY"));
  assert.ok(codes.includes("INVALID_TIMEZONE"));
});

test("numbers multiline equations per row, preserves alignment gaps, and supports code blocks in Callouts", () => {
  const result = compile("---\nmathmd:\n  layout:\n    equation:\n      numbered: true\n---\n$$a&=b&&c&=d \\label{eq:first}\\\\e&=f&&g&=h \\notag$$\n\n> [!remark]\n> ```js\n> code\n> ```\n");
  assert.equal((result.html.match(/class="equation-number"/g) ?? []).length, 1);
  assert.equal((result.html.match(/class="equation-content/g) ?? []).length, 10);
  assert.match(result.html, /equation-content math-anchor-gap/);
  assert.match(result.html, /\.math-block\{display:grid/);
  assert.match(result.html, /\.equation-row\{display:contents/);
  assert.match(result.html, /mjx-assistive-mml\{position:absolute/);
  assert.match(result.html, /<pre><code class="language-js">code/);
  assert.doesNotMatch(result.html, /CALLOUT_CODE_BLOCK/);
});

test("renders phase-three markdown extensions", () => {
  const result = compile("~~removed~~\n\n- [ ] todo\n- [x] done\n\nTerm\n: Description\n");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /<s>removed<\/s>/);
  assert.match(result.html, /task-list-item/);
  assert.match(result.html, /<dl>/);
  assert.match(result.html, /<dt>Term<\/dt>/);
});

test("allows rich Callout contents and nested Callouts", () => {
  const result = compile("> [!remark] Outer\n> > [!proof]\n> > Inner `code`\n> >\n> > | A | B |\n> > |---|---|\n> > | 1 | 2 |\n> >\n> > [^inside]\n> >\n> > [^inside]: Nested note\n");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.ok((result.html.match(/class=\"callout /g) ?? []).length >= 2);
  assert.match(result.html, /<table class=\"mathmd-table\">/);
  assert.match(result.html, /<code>code<\/code>/);
  assert.match(result.html, /Nested note/);
});

test("renders numbered figures and resolves figure references", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-figure-"));
  fs.writeFileSync(path.join(directory, "image.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"></svg>");
  const result = compile("![Sample image](image.svg){#fig:sample}\n\nSee [](#fig:sample).\n", path.join(directory, "document.md"));
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /<figure id=\"fig:sample\" class=\"figure\">/);
  assert.match(result.html, /Figure 1\. Sample image/);
  assert.match(result.html, /href=\"#fig:sample\">Figure 1\.<\/a>/);
});

test("supports author-year citations, URLs, and advanced title dates", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-citation-"));
  const bib = path.join(directory, "references.bib");
  fs.writeFileSync(bib, "@article{doe2020,\n author={Doe, Jane and Roe, John},\n title={A Study},\n year={2020},\n url={https://example.com/study}\n}\n");
  const source = "---\nmathmd:\n  meta:\n    title: Sample\n    date: 2020-01-02\n  citation:\n    style: author-year\n  bibliography:\n    - references.bib\n  layout:\n    title:\n      date-format: MMMM d, yyyy\n---\n<maketitle />\n\n[@doe2020]\n\n<references />\n";
  const result = compile(source, path.join(directory, "document.md"));
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /citation-author-year">\(Doe and Roe, 2020\)<\/span>/);
  assert.match(result.html, /A Study/);
  assert.match(result.html, /href=\"https:\/\/example\.com\/study\"/);
  assert.match(result.html, /January 2, 2020/);
});

test("rejects duplicate IDs and citations without a references directive", () => {
  const result = compile("# One {#same}\n\n# Two {#same}\n\n[@key]");
  assert.ok(result.diagnostics.items.some((item) => item.code === "DUPLICATE_ID"));
  assert.ok(result.diagnostics.items.some((item) => item.code === "REFERENCES_DIRECTIVE_MISSING"));
  for (const item of result.diagnostics.items) assert.ok(item.location);
});

test("renders an unresolved footnote without consuming a footnote number or link", () => {
  const result = compile("A missing footnote.[^missing]\n");
  assert.match(result.html, /diagnostic-missing[^>]*>\[\^missing\]/);
  assert.doesNotMatch(result.html, /footnote-ref/);
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

test("preview broadcasts phase-two layout diagnostics", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-preview-layout-"));
  const input = path.join(directory, "document.md");
  fs.writeFileSync(input, "# Overflow\n\n```text\n" + "x".repeat(180) + "\n```\n");
  const port = 34672;
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("src/cli.ts"), "preview", input, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("preview did not start")), 10000);
      child.stderr.on("data", (chunk) => { if (String(chunk).includes("Preview server running")) { clearTimeout(timeout); resolve(); } });
      child.on("error", reject);
    });
    const diagnostics = await new Promise<any[]>((resolve, reject) => {
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/__marktexset/ws");
      const timeout = setTimeout(() => { socket.close(); reject(new Error("layout diagnostics were not received")); }, 10000);
      socket.on("message", (data) => {
        const message = JSON.parse(String(data));
        if (message.type === "diagnostics") { clearTimeout(timeout); socket.close(); resolve(message.diagnostics); }
      });
      socket.on("error", reject);
    });
    assert.ok(diagnostics.some((item) => item.code === "LAYOUT_OVERFLOW"));
  } finally {
    child.kill("SIGTERM");
  }
});
