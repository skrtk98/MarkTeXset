import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
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

test("emits Preview-only math inspector metadata for inline, block, multiline, and Callout math", () => {
  const source = "# Sample\n\nInline $x^2$.\n\n$$a&=b \\\\ c&=d \\label{eq:sample}$$\n\n> [!remark]\n> Callout $y^2$.\n";
  const normal = compile(source, "/tmp/math-inspector.md");
  const preview = compile(source, "/tmp/math-inspector.md", { mathInspector: true });
  assert.doesNotMatch(normal.html, /data-mathmd-math-id/);
  assert.equal((preview.html.match(/data-mathmd-math-id=/g) ?? []).length, 6);
  assert.match(preview.html, /data-mathmd-math-kind="inline"/);
  assert.match(preview.html, /data-mathmd-math-kind="display"/);
  assert.match(preview.html, /data-mathmd-math-kind="multiline"/);
  assert.match(preview.html, /data-mathmd-tex="x\^2"/);
  assert.match(preview.html, /data-mathmd-source-start="\{&quot;line&quot;:3/);
  assert.match(preview.html, /data-mathmd-row-id="row-0"/);
  assert.match(preview.html, /data-mathmd-source-file="\.\.\/\.\.\/\.\.\/\.\.\/tmp\/math-inspector\.md"/);
});

test("validates math inspector configuration and supports disabling it", () => {
  const diagnostics = new Diagnostics();
  const disabled = compile("---\nmathmd:\n  preview:\n    math-inspector:\n      enabled: false\n---\n$x$", "document.md");
  assert.equal(disabled.diagnostics.hasErrors, false);
  assert.doesNotMatch(disabled.html, /data-mathmd-math-id/);
  loadConfig("---\nmathmd:\n  preview:\n    math-inspector:\n      panel: bottom\n      unknown: true\n---\ntext", "document.md", diagnostics);
  assert.ok(diagnostics.items.some((item) => item.code === "UNKNOWN_CONFIG_KEY" && item.severity === "warning"));
  assert.ok(diagnostics.items.some((item) => item.code === "UNSUPPORTED_INSPECTOR_PANEL"));
});

test("emits row alignment, number, and internal reference metadata for the inspector", () => {
  const result = compile("$$a&=b \\\\ c&=d \\label{eq:one}$$\n\nSee [equation](#eq:one).", "document.md", { mathInspector: true });
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /data-mathmd-alignment=/);
  assert.match(result.html, /data-mathmd-row-id=\"row-1\"/);
  assert.match(result.html, /data-mathmd-number=/);
  assert.match(result.html, /data-mathmd-reference-target=\"eq:one\"/);
  assert.match(result.html, /data-mathmd-reference-text=\"equation\"/);
});

test("supports tikzcd fences and TeX equation references", () => {
  const result = compile("$$x = 1 \\label{eq:first}$$\n\nSee $\\ref{eq:first}$ and $\\eqref{eq:first}$.\n\n```tikzcd\nA \\arrow[r] & B \\\\\nC & D \\arrow[u]\n```");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /href=\"#eq:first\"/);
  assert.match(result.html, /class=\"tikzcd-table\"/);
  assert.match(result.html, /tikzcd-arrows/);
  assert.match(result.html, /\.tikzcd-table\{border-collapse/);
});

test("supports additional MathJax font commands", () => {
  const result = compile("$\\mathbf{A}+\\mathsf{B}+\\mathtt{C}$");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /class=\"MathJax\"/);
});

test("diagnoses unknown TeX commands", () => {
  const result = compile("Inline $\\unknowncommand{x}$.");
  assert.ok(result.diagnostics.items.some((item) => item.code === "UNKNOWN_TEX_COMMAND" && item.severity === "warning"));
});

test("supports phase-four custom Callout styles and safe HTML attributes", () => {
  const result = compile("---\nmathmd:\n  layout:\n    callouts:\n      theorem:\n        title: Custom theorem\n        style: custom-theorem\n        class: highlighted\n---\n# Heading {#heading .lead role=\"doc-subtitle\" data-kind=\"phase4\"}\n\n> [!theorem] Example {#custom aria-label=\"Custom theorem\"}\n> Body\n");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /id=\"heading\" class=\"lead\" role=\"doc-subtitle\" data-kind=\"phase4\"/);
  assert.match(result.html, /id=\"custom\" class=\"callout callout-plain callout-style-custom-theorem highlighted\" aria-label=\"Custom theorem\"/);
});

test("rejects unsafe phase-four HTML attributes", () => {
  const result = compile("# Heading {onclick=\"alert(1)\"}\n");
  assert.ok(result.diagnostics.items.some((item) => item.code === "UNSAFE_HTML_ATTRIBUTE"));
});

test("supports final-phase merged tables and global/scoped CSS", () => {
  const result = compile(`<style>.mathmd-table td { border: 1px solid red; }</style>

<style scoped>tbody tr:nth-child(n+1):nth-child(-n+1) td:nth-child(2) { text-align: right; vertical-align: middle; }</style>

| Group | Value | Note |
| --- | --- | --- |
| A || first |
| B | C | second |

| A | B |
| --- | --- |
| x | y |
| ^^ | z |
`);
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /colspan="2"/);
  assert.match(result.html, /rowspan="2"/);
  assert.match(result.html, /border: 1px solid red/);
  assert.match(result.html, /@scope \(\.style-scope-0\)/);
  assert.match(result.html, /class="style-scope-0"/);
});

test("highlights final-phase code fences and safely falls back for unknown languages", () => {
  const result = compile("```ts:src/example file.ts\nconst value = 1;\n```\n\n```unknownlang:odd & name\na < b\n```");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /code-filename">src\/example file\.ts/);
  assert.match(result.html, /code-language">typescript/);
  assert.match(result.html, /token-keyword/);
  assert.match(result.html, /code-language">unknownlang/);
  assert.match(result.html, /&lt; b/);
  assert.ok(result.diagnostics.items.some((item) => item.code === "UNKNOWN_CODE_LANGUAGE"));
});

test("renders formatted Callout titles with counters and inline math", () => {
  const result = compile(`---
mathmd:
  layout:
    callouts:
      theorem:
        title: "Theorem **{theorem.arabic}.** $x$"
        style: plain
---
> [!theorem]
> Body
`);
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /Theorem <strong>1\.<\/strong>/);
  assert.match(result.html, /class="MathJax"/);
});

test("diagnoses invalid final-phase CSS imports and syntax", () => {
  const result = compile(`---
mathmd:
  style:
    import:
      - ../missing.css
---
<style>broken { color: red;\n</style>
text
`);
  const codes = result.diagnostics.items.map((item) => item.code);
  assert.ok(codes.includes("CSS_PARENT_PATH"));
  assert.ok(codes.includes("CSS_SYNTAX"));
});

test("rejects a rowspan continuation without a preceding table cell", () => {
  const result = compile("| A | B |\n| --- | --- |\n| ^^ | value |\n");
  assert.ok(result.diagnostics.items.some((item) => item.code === "INVALID_TABLE_MERGE"));
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

test("rejects unknown counter formats and imported command collisions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-counter-import-"));
  fs.writeFileSync(path.join(directory, "commands-a.yaml"), "command:\n  macros:\n    foo: {args: 0, body: x}\n");
  fs.writeFileSync(path.join(directory, "commands-b.yaml"), "command:\n  macros:\n    foo: {args: 0, body: z}\n");
  const source = "---\nmathmd:\n  import: [commands-a.yaml, commands-b.yaml]\n  command:\n    macros:\n      foo: {args: 0, body: y}\n  layout:\n    page:\n      number:\n        format: '{page.binary}'\n    callouts:\n      theorem:\n        title: 'Theorem {unknown.arabic}'\n---\n";
  const result = compile(source, path.join(directory, "document.md"));
  assert.ok(result.diagnostics.items.some((item) => item.code === "INVALID_COUNTER_TEMPLATE"));
  assert.ok(result.diagnostics.items.some((item) => item.code === "COMMAND_NAME_COLLISION"));
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

test("validates supported page styles and suppresses numbering for empty style", () => {
  const invalid = compile("---\nmathmd:\n  layout:\n    page:\n      style: fancy\n---\ntext\n");
  assert.ok(invalid.diagnostics.items.some((item) => item.code === "UNSUPPORTED_PAGE_STYLE"));
  const empty = compile("---\nmathmd:\n  layout:\n    page:\n      style: empty\n---\ntext\n");
  assert.equal(empty.diagnostics.hasErrors, false);
  assert.match(empty.config.layout.page.style, /empty/);
});

test("numbers multiline equations per row, preserves alignment gaps, and supports code blocks in Callouts", () => {
  const result = compile("---\nmathmd:\n  layout:\n    equation:\n      numbered: true\n---\n$$a&=b&&c&=d \\label{eq:first}\\\\e&=f&&g&=h \\notag$$\n\n> [!remark]\n> ```js\n> code\n> ```\n");
  assert.equal((result.html.match(/class="equation-number"/g) ?? []).length, 1);
  assert.equal((result.html.match(/class="equation-content/g) ?? []).length, 10);
  assert.match(result.html, /equation-content math-anchor-gap/);
  assert.match(result.html, /\.math-block\{display:grid/);
  assert.match(result.html, /\.equation-row\{display:contents/);
  assert.match(result.html, /mjx-assistive-mml\{position:absolute/);
  assert.match(result.html, /<pre><code class="language-js"><span class="line">/);
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

test("does not support four-space indented code blocks", () => {
  const result = compile("    indented code\n    x = 1\n\n```text\nfenced code\n```");
  assert.doesNotMatch(result.html, /<pre><code>indented code/);
  assert.match(result.html, /<p>indented code\nx = 1<\/p>/);
  assert.match(result.html, /<pre><code class=\"language-text\">fenced code/);
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

test("renders numeric bibliography labels without list bullets", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-numeric-bib-"));
  fs.writeFileSync(path.join(directory, "references.bib"), "@book{one,\n title={First Book},\n year={2020}\n}\n@book{two,\n title={Second Book},\n year={2021}\n}\n");
  const source = "---\nmathmd:\n  bibliography:\n    - references.bib\n  citation:\n    style: numeric\n---\n[@one; @two]\n\n<references />\n";
  const result = compile(source, path.join(directory, "document.md"));
  assert.match(result.html, /<ul class="references references-numeric">/);
  assert.match(result.html, /reference-label">\[1\]<\/span>/);
  assert.match(result.html, /reference-label">\[2\]<\/span>/);
  assert.match(result.html, /\.references\{list-style:none/);
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

test("rejects duplicate footnote definitions", () => {
  const result = compile("[^same]: first\n\n[^same]: second\n\nReference[^same].\n");
  assert.ok(result.diagnostics.items.some((item) => item.code === "DUPLICATE_FOOTNOTE" && item.severity === "error"));
});

test("control tags are self-closing HTML elements in the source language", () => {
  const result = compile("<maketoc />\n\n<pagebreak />\n\n<pagestyle name=\"empty\" />\n");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /table-of-contents/);
  assert.match(result.html, /mathmd-pagebreak/);
  assert.match(result.html, /data-name=\"empty\"/);
});

test("warns when pagebreak placement creates an empty page", () => {
  const result = compile("<pagebreak />\n\nText\n\n<pagebreak />\n\n<pagebreak />\n");
  assert.ok(result.diagnostics.items.filter((item) => item.code === "EMPTY_PAGE").length >= 2);
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
      const timeout = setTimeout(() => reject(new Error("preview did not start")), 30000);
      child.stderr.on("data", (chunk) => { if (String(chunk).includes("Preview server running")) { clearTimeout(timeout); resolve(); } });
      child.on("error", reject);
    });
    const page = await fetch("http://127.0.0.1:" + port + "/").then((response) => response.text());
    assert.match(page, /Before/);
    const reload = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/__marktexset/ws");
      const timeout = setTimeout(() => { socket.close(); reject(new Error("reload was not received")); }, 60000);
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
      const timeout = setTimeout(() => reject(new Error("preview did not start")), 30000);
      child.stderr.on("data", (chunk) => { if (String(chunk).includes("Preview server running")) { clearTimeout(timeout); resolve(); } });
      child.on("error", reject);
    });
    const diagnostics = await new Promise<any[]>((resolve, reject) => {
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/__marktexset/ws");
      const timeout = setTimeout(() => { socket.close(); reject(new Error("layout diagnostics were not received")); }, 60000);
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

test("preview math inspector selects a formula and shows TeX, DOM, and computed style", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-preview-inspector-"));
  const input = path.join(directory, "document.md");
  fs.writeFileSync(input, "# Inspector\n\nInline $x^2$.\n\n> [!remark]\n> Callout $y$.\n");
  const port = 34673;
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("src/cli.ts"), "preview", input, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  const browser = await chromium.launch({ headless: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("preview inspector did not start")), 30000);
      child.stderr.on("data", (chunk) => { if (String(chunk).includes("Preview server running")) { clearTimeout(timeout); resolve(); } });
      child.on("error", reject);
    });
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + port + "/", { waitUntil: "domcontentloaded" });
    const inspector = page.locator("#marktexset-math-inspector");
    const toggle = inspector.getByRole("button", { name: "Math inspector: Off" });
    await toggle.click();
    const formula = page.locator("[data-mathmd-math-kind=\"inline\"]").first();
    assert.equal(await formula.getAttribute("tabindex"), "0");
    await formula.evaluate((element) => element.setAttribute("data-mathmd-source-map", "not-json"));
    await formula.focus();
    await page.keyboard.press("Enter");
    await assert.doesNotReject(async () => inspector.getByText("Original TeX").waitFor());
    assert.ok(await inspector.getByText("x^2").count() >= 1);
    assert.equal(await inspector.getByText(/Start:/).count(), 1);
    assert.equal(await inspector.getByText(/Numbered:/).count(), 1);
    assert.equal(await inspector.getByText(/Context:/).count(), 1);
    assert.equal(await inspector.getByText("Rendered DOM").count(), 1);
    assert.equal(await inspector.getByText("Computed style").count(), 1);
    assert.equal(await inspector.getByText("Commands and expansion").count(), 1);
    assert.equal(await inspector.getByText("Matched CSS rules").count(), 1);
    assert.equal(await inspector.getByPlaceholder("Filter computed properties").count(), 1);
    assert.equal(await inspector.getByText(":hover").count(), 1);
    await inspector.getByRole("button", { name: "Computed" }).click();
    await inspector.locator("#computed button").filter({ hasText: ":hover" }).first().click();
    assert.equal(await formula.getAttribute("data-mathmd-pseudo-hover"), "");
    assert.equal(await page.locator("#marktexset-force-hover").count(), 1);
    await inspector.locator("#computed button").filter({ hasText: ":hover" }).first().click();
    assert.equal(await formula.getAttribute("data-mathmd-pseudo-hover"), null);
    assert.equal(await inspector.getByText("Copy JSON").count(), 1);
    assert.ok(await inspector.locator("#tex .value span").count() > 0);
    assert.equal(await inspector.getByText("Source map unavailable; formula-wide fallback is active.").count(), 1);
    assert.equal(await inspector.locator(".math-overlay").count(), 0);
    const overlayVisible = await page.evaluate(() => {
      const host = document.querySelector("#marktexset-math-inspector") as HTMLElement | null;
      return Boolean(host?.shadowRoot?.querySelector(".panel.open"));
    });
    assert.equal(overlayVisible, true);
    const panelPosition = await page.evaluate(() => {
      const host = document.querySelector("#marktexset-math-inspector") as HTMLElement | null;
      const panel = host?.shadowRoot?.querySelector(".panel") as HTMLElement | null;
      return panel ? getComputedStyle(panel).bottom : "";
    });
    assert.notEqual(panelPosition, "");
  } finally {
    await browser.close();
    child.kill("SIGTERM");
  }
});

test("preview math inspector follows an internal reference and maps a DOM node back to TeX", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-preview-inspector-reference-"));
  const input = path.join(directory, "document.md");
  fs.writeFileSync(input, "$$x^2 \\label{eq:x}$$\n\nSee [formula](#eq:x).\n");
  const port = 34674;
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("src/cli.ts"), "preview", input, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  const browser = await chromium.launch({ headless: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("reference inspector did not start")), 30000);
      child.stderr.on("data", (chunk) => { if (String(chunk).includes("Preview server running")) { clearTimeout(timeout); resolve(); } });
      child.on("error", reject);
    });
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + port + "/", { waitUntil: "domcontentloaded" });
    const inspector = page.locator("#marktexset-math-inspector");
    await inspector.getByRole("button", { name: "Math inspector: Off" }).click();
    await page.locator("[data-mathmd-reference-target=\"eq:x\"]").click();
    assert.equal(await inspector.getByText(/Reference:/).count(), 1);
    await page.locator("[data-mml-node]").first().click({ force: true });
    assert.equal(await inspector.getByText("Rendered DOM").count(), 1);
    assert.equal(await page.locator("div.math-overlay").isVisible(), true);
    assert.ok(await inspector.locator("#tex .value span").count() > 0);
  } finally {
    await browser.close();
    child.kill("SIGTERM");
  }
});

test("preview math inspector exposes versioned details and rejects stale or unsafe source requests", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-preview-inspector-api-"));
  const input = path.join(directory, "document.md");
  fs.writeFileSync(input, String.raw`---
mathmd:
  command:
    macros:
      R: {args: 1, body: "\\mathbb{#1}"}
---

$$\\R{x}\\label{eq:x}$$
`);
  const port = 34675;
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("src/cli.ts"), "preview", input, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("inspector API preview did not start")), 30000);
      child.stderr.on("data", (chunk) => { if (String(chunk).includes("Preview server running")) { clearTimeout(timeout); resolve(); } });
      child.on("error", reject);
    });
    const base = "http://127.0.0.1:" + port;
    try {
      const html = await (await fetch(base + "/")).text();
      assert.match(html, /data-mathmd-schema-version="1"/);
      const id = html.match(/data-mathmd-math-id="([^"]+)"/)?.[1];
      assert.ok(id);
      const detail = await fetch(base + "/__marktexset/inspector/" + encodeURIComponent(id!));
      assert.equal(detail.status, 200);
      const record = await detail.json();
      assert.equal(record.schemaVersion, 1);
      assert.match(record.source.file, /document\.md$/);
      assert.ok(record.commands.some((command: any) => command.name === "\\R" && command.status === "user"));
      assert.match(record.expansion, /mathbb/);
      const source = await fetch(base + "/__marktexset/source?mathId=" + encodeURIComponent(id!));
      assert.equal(source.status, 200);
      assert.equal((await source.json()).schemaVersion, 1);
      assert.equal((await fetch(base + "/__marktexset/inspector/stale")).status, 404);
      assert.equal((await fetch(base + "/__marktexset/source?path=" + encodeURIComponent("../../etc/passwd"))).status, 404);
      assert.equal((await fetch(base + "/__marktexset/inspector/" + encodeURIComponent(id!), { method: "POST" })).status, 405);
    } finally { /* the preview process is terminated below */ }
  } finally { child.kill("SIGTERM"); }
});

test("build reports diagnostics on errors in text and JSON modes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-build-errors-"));
  const input = path.join(directory, "document.md");
  fs.writeFileSync(input, "---\nmathmd:\n  unknown: 1\n---\n\nText\n");
  fs.writeFileSync(path.join(directory, "document.html"), "existing");
  const cli = path.resolve("src/cli.ts");
  const run = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, "build", input, ...args], { encoding: "utf8" });
  const json = run(["--format", "json"]);
  assert.equal(json.status, 1);
  assert.ok(JSON.parse(json.stdout).diagnostics.some((item: any) => item.code === "UNKNOWN_CONFIG_KEY"));
  assert.equal(fs.readFileSync(path.join(directory, "document.html"), "utf8"), "existing");
  const text = run(["-o", path.join(directory, "out.html")]);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /error UNKNOWN_CONFIG_KEY/);
  assert.equal(fs.existsSync(path.join(directory, "out.html")), false);
});

test("preview escapes diagnostics, confines assets, validates WebSocket origins, and survives bad input", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-preview-security-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-preview-outside-"));
  fs.writeFileSync(path.join(outside, "secret.png"), "secret");
  fs.writeFileSync(path.join(directory, "inside.png"), "inside");
  fs.writeFileSync(path.join(directory, "..dotted.png"), "dotted");
  fs.symlinkSync(path.join(outside, "secret.png"), path.join(directory, "leak.png"));
  const input = path.join(directory, "document.md");
  const payload = "<img src=x onerror=window.__pwned=1></script><script>window.__pwned=2</script>";
  fs.writeFileSync(input, "---\nmathmd:\n  \"" + payload + "\": 1\n---\n\n![a](inside.png)\n\n![b](leak.png)\n\n![c](..dotted.png)\n");
  const port = 34676;
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("src/cli.ts"), "preview", input, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  let exited = false;
  child.on("exit", () => { exited = true; });
  const browser = await chromium.launch({ headless: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("preview did not start")), 30000);
      child.stderr.on("data", (chunk) => { if (String(chunk).includes("Preview server running")) { clearTimeout(timeout); resolve(); } });
      child.on("error", reject);
    });
    const base = "http://127.0.0.1:" + port;
    const page = await browser.newPage();
    await page.goto(base + "/", { waitUntil: "load" });
    await page.locator("#marktexset-diagnostics").getByText(/UNKNOWN_CONFIG_KEY/).waitFor();
    assert.equal(await page.evaluate(() => (window as any).__pwned), undefined);
    assert.equal(await page.locator("#marktexset-diagnostics").getByText("onerror=window.__pwned=1", { exact: false }).count(), 1);
    assert.equal((await fetch(base + "/inside.png")).status, 200);
    assert.equal((await fetch(base + "/leak.png")).status, 404);
    assert.equal((await fetch(base + "/..dotted.png")).status, 200);
    const rebound = await new Promise<number>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: "/", headers: { host: "evil.example:" + port } }, (response) => { response.resume(); resolve(response.statusCode ?? 0); }).on("error", reject);
    });
    assert.equal(rebound, 403);
    assert.equal((await fetch(base + "/__marktexset/inspector/%")).status, 400);
    assert.equal((await fetch(base + "/%")).status, 400);
    const opens = (origin?: string, host?: string) => new Promise<boolean>((resolve) => {
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/__marktexset/ws", { ...(origin ? { origin } : {}), ...(host ? { headers: { host } } : {}) });
      socket.on("open", () => { socket.close(); resolve(true); });
      socket.on("error", () => resolve(false));
    });
    assert.equal(await opens("http://evil.example"), false);
    assert.equal(await opens("http://evil.example:" + port, "evil.example:" + port), false);
    assert.equal(await opens("http://127.0.0.1:" + port), true);
    const recovered = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/__marktexset/ws");
      const timeout = setTimeout(() => { socket.close(); reject(new Error("preview did not recover")); }, 60000);
      let failed = false;
      socket.on("message", (data) => {
        const message = JSON.parse(String(data));
        if (message.type === "diagnostics" && message.diagnostics.some((item: any) => item.code === "PREVIEW_BUILD_FAILED")) failed = true;
        if (failed && message.type === "reload") { clearTimeout(timeout); socket.close(); resolve(); }
      });
      socket.on("error", reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.rmSync(input);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal((await fetch(base + "/__marktexset/status")).status, 200);
    fs.writeFileSync(input, "# Restored\n");
    await recovered;
    assert.equal(exited, false);
    assert.match(await fetch(base + "/").then((response) => response.text()), /Restored/);
  } finally {
    await browser.close();
    child.kill("SIGTERM");
  }
});
