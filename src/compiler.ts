import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import { loadConfig, type Config } from "./config.js";
import { Diagnostics, locationFor } from "./diagnostics.js";
import { renderMath, renderMultilineMath } from "./math.js";

export interface CompileResult {
  html: string;
  config: Config;
  diagnostics: Diagnostics;
}

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function counterText(template: string, name: string, value: number): string {
  return template.replace(/\{([^}]+)\}/g, (_m, expression: string) => {
    const leaf = expression.trim().split(">").at(-1)?.trim() ?? "";
    const pair = leaf.split(".");
    if (pair.length !== 2) return "";
    return pair[0] === name ? String(value) : "";
  });
}

function renderCallout(name: string, body: string, config: Config, counters: Map<string, number>, id: string | undefined, classes: string[], ids: Set<string>, references: Map<string, string>, diagnostics: Diagnostics): string {
  const definitions = config.layout.callouts ?? {};
  const definition = definitions[name] ?? { title: name, style: "plain" };
  const style = ["plain", "definition", "remark", "proof"].includes(definition.style) ? definition.style : "plain";
  const title = String(definition.title ?? name);
  const numbered = /\{[^}]+\}/.test(title);
  let renderedTitle = title;
  if (numbered) {
    const current = (counters.get(name) ?? 0) + 1;
    counters.set(name, current);
    renderedTitle = counterText(title, name, current);
  }
  if (id) {
    if (ids.has(id)) diagnostics.error("DUPLICATE_ID", "ID '" + id + "' is defined more than once.");
    ids.add(id);
    references.set(id, renderedTitle);
  }
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  if (/^\s*>?\s*\[!/.test(body)) diagnostics.error("NESTED_CALLOUT", "Nested Callouts are not supported inside a Callout.");
  if (/(^|\n)\s*(```|~~~|    )/.test(body)) diagnostics.error("CALLOUT_CODE_BLOCK", "Code blocks are not supported inside a Callout.");
  if (/!\[[^\]]*\]\([^)]*\)/.test(body)) diagnostics.error("CALLOUT_IMAGE", "Images are not supported inside a Callout.");
  if (/(^|\n)\s*\|.*\|/.test(body)) diagnostics.error("CALLOUT_TABLE", "Tables are not supported inside a Callout.");
  if (/(^|\n)\s*\[\^[^\]]+\]:/.test(body)) diagnostics.error("CALLOUT_FOOTNOTE_DEFINITION", "Footnote definitions are not supported inside a Callout.");
  const protectedBody = protectMath(body.trim() + "\n", config, diagnostics, ids, references);
  let content = md.render(protectedBody.text);
  for (const [key, value] of protectedBody.values) content = content.split("<p>" + key + "</p>").join(value).split(key).join(value);
  const qed = style === "proof" ? "<span class=\"qed\">□</span>" : "";
  const classAttribute = ["callout", "callout-" + style, ...classes].map(escapeHtml).join(" ");
  return "<div" + (id ? " id=\"" + escapeHtml(id) + "\"" : "") + " class=\"" + classAttribute + "\"><div class=\"callout-title\">" + escapeHtml(renderedTitle) + "</div><div class=\"callout-body\">" + content + qed + "</div></div>";
}

function protectMath(source: string, config: Config, diagnostics: Diagnostics, ids: Set<string>, references: Map<string, string>): { text: string; values: Map<string, string> } {
  const values = new Map<string, string>();
  let index = 0;
  const put = (html: string): string => {
    const token = "MATHMDMATH" + index++ + "TOKEN";
    values.set(token, html);
    return token;
  };
  let equation = 0;
  let text = source.replace(/\$\$([\s\S]*?)\$\$/g, (_m, body: string) => {
    try {
      if (/\\\\\s*$/.test(body)) diagnostics.warning("TRAILING_MATH_BREAK", "A trailing math line break was removed.");
      const rows = renderMultilineMath(body);
      const rendered = rows.map((row) => {
        const label = row.labels[0];
        const notag = /\\notag\b/.test(row.source ?? "");
        const numbered = Boolean(config.layout.equation.numbered) || Boolean(label);
        if (notag && label) diagnostics.error("NOTAG_LABEL", "\\notag and \\label cannot occur on the same equation row.");
        const numberValue = numbered && !notag ? ++equation : 0;
        const number = numberValue ? " <span class=\"equation-number\">(" + numberValue + ")</span>" : "";
        if (label) {
          if (ids.has(label)) diagnostics.error("DUPLICATE_ID", "ID '" + label + "' is defined more than once.");
          ids.add(label);
          references.set(label, numberValue ? "(" + numberValue + ")" : "equation");
        }
        const rowSource = row.source ?? "";
        let mathHtml = row.html;
        if (rowSource.includes("&")) {
          const cells = rowSource.split("&");
          mathHtml = cells.map((cell, index) => {
            if (!cell.trim()) return "<span class=\"math-anchor-gap\"></span>";
            try { return "<span class=\"math-anchor-" + (index % 2 ? "left" : "right") + "\">" + renderMath(cell, true).html + "</span>"; }
            catch { return "<span class=\"math-error\">[math error]</span>"; }
          }).join("");
        }
        return "<div class=\"equation-row\"" + (label ? " id=\"" + escapeHtml(label) + "\"" : "") + ">" + mathHtml + number + "</div>";
      }).join("");
      return put("<div class=\"math-block\">" + rendered + "</div>");
    } catch (error) {
      diagnostics.error("MATH_RENDER", String(error));
      return put("<div class=\"math-block math-error\">[math error]</div>");
    }
  });
  text = text.replace(/\$([^$\n]+)\$/g, (_m, body: string) => {
    try { return put(renderMath(body, false).html); }
    catch (error) { diagnostics.error("MATH_RENDER", String(error)); return put("<span class=\"math-error\">[math error]</span>"); }
  });
  return { text, values };
}

function preprocess(source: string, config: Config, diagnostics: Diagnostics): { text: string; replacements: Map<string, string>; ids: Set<string>; references: Map<string, string> } {
  const replacements = new Map<string, string>();
  let sequence = 0;
  const token = (html: string): string => { const value = "MATHMDTOKEN" + sequence++ + "END"; replacements.set(value, html); return value; };
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  const counters = new Map<string, number>();
  const ids = new Set<string>();
  const references = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const callout = line.match(/^>\s*\[!([^\]]+)\](?:\s+(.*))?$/);
    if (callout) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && (/^>/.test(lines[j]) || lines[j].trim() === "")) {
        body.push(lines[j].replace(/^>\s?/, "")); j++;
      }
      let calloutTitle = callout[2] ?? "";
      const calloutAttributes = calloutTitle.match(/\s+\{([^}]*)\}\s*$/);
      const calloutId = calloutAttributes?.[1].match(/(?:^|\s)#([A-Za-z][A-Za-z0-9:_-]*)/)?.[1];
      const calloutClasses = [...(calloutAttributes?.[1].matchAll(/(?:^|\s)\.([A-Za-z][A-Za-z0-9_-]*)/g) ?? [])].map((match) => match[1]);
      if (calloutAttributes) calloutTitle = calloutTitle.slice(0, calloutAttributes.index).trim();
      output.push(token(renderCallout(callout[1].trim(), [calloutTitle, ...body].join("\n"), config, counters, calloutId, calloutClasses, ids, references, diagnostics)));
      i = j - 1;
      continue;
    }
    const directive = line.match(/^<(pagebreak|maketoc|maketitle|references)\s*\/\s*>$/);
    if (directive) {
      output.push(token("<div class=\"mathmd-directive mathmd-" + directive[1] + "\"></div>"));
      continue;
    }
    const pageStyle = line.match(/^<pagestyle\s+name=["']([^"']+)["']\s*\/\s*>$/);
    if (pageStyle) {
      const style = ["empty", "plain", "headings"].includes(pageStyle[1]) ? pageStyle[1] : "plain";
      output.push(token("<div class=\"mathmd-directive mathmd-pagestyle\" data-name=\"" + escapeHtml(style) + "\"></div>"));
      continue;
    }
    const heading = line.match(/^(#{1,6})(:)\s+(.+?)(?:\s+\{([^}]*)\})?$/);
    if (heading) {
      const attrs = heading[4] ?? "";
      const id = attrs.match(/(?:^|\s)#([A-Za-z][A-Za-z0-9:_-]*)/)?.[1] ?? "";
      const classes = [...attrs.matchAll(/(?:^|\s)\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((match) => match[1]).join(".");
      if (id) { if (ids.has(id)) diagnostics.error("DUPLICATE_ID", "ID '" + id + "' is defined more than once."); ids.add(id); references.set(id, heading[3]); }
      output.push(heading[1] + " MATHMDNONUM MATHMDATTR:" + id + ":" + classes + ":" + heading[3]);
      continue;
    }
    const ordinaryHeading = line.match(/^(#{1,6})\s+(.+?)\s+\{([^}]*)\}\s*$/);
    if (ordinaryHeading) {
      const attrs = ordinaryHeading[3];
      const id = attrs.match(/(?:^|\s)#([A-Za-z][A-Za-z0-9:_-]*)/)?.[1] ?? "";
      const classes = [...attrs.matchAll(/(?:^|\s)\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((match) => match[1]).join(".");
      if (id) { if (ids.has(id)) diagnostics.error("DUPLICATE_ID", "ID '" + id + "' is defined more than once."); ids.add(id); references.set(id, ordinaryHeading[2]); }
      output.push(ordinaryHeading[1] + " MATHMDATTR:" + id + ":" + classes + ":" + ordinaryHeading[2]);
      continue;
    }
    output.push(line);
  }
  const protectedMath = protectMath(output.join("\n"), config, diagnostics, ids, references);
  for (const [key, value] of protectedMath.values) replacements.set(key, value);
  return { text: protectedMath.text, replacements, ids, references };
}

function addHeadingNumbers(html: string, config: Config): string {
  const counters = [0, 0, 0, 0, 0, 0, 0];
  const depth = Number(config.layout.heading.numberingDepth ?? 3);
  const formats = config.layout.heading.formats ?? {};
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_m, levelText: string, content: string) => {
    const level = Number(levelText);
    const marker = "MATHMDNONUM ";
    let id = "";
    let classes = "";
    const unnumbered = content.startsWith("MATHMDNONUM ");
    if (unnumbered) content = content.slice("MATHMDNONUM ".length);
    if (content.startsWith("MATHMDATTR:")) {
      const attribute = content.match(/^MATHMDATTR:([^:]*):([^:]*):(.*)$/s);
      if (attribute) { id = attribute[1]; classes = attribute[2].replace(/\./g, " "); content = attribute[3]; }
    }
    if (content.startsWith(marker)) content = content.slice(marker.length);
    const attrs = (id ? " id=\"" + escapeHtml(id) + "\"" : "") + (classes ? " class=\"" + escapeHtml(classes) + "\"" : "");
    if (unnumbered || !config.layout.heading.numbered || level > depth) return "<h" + level + attrs + ">" + content + "</h" + level + ">";
    counters[level]++;
    for (let i = level + 1; i <= 6; i++) counters[i] = 0;
    const format = String(formats["h" + level] ?? "");
    const number = format.replace(/\{h([1-6])\.arabic\}/g, (_x: string, n: string) => String(counters[Number(n)] || 0));
    return "<h" + level + attrs + ">" + escapeHtml(number) + " " + content + "</h" + level + ">";
  });
}

function readBibliography(config: Config, file: string, diagnostics: Diagnostics): Map<string, any> {
  const entries = new Map<string, any>();
  for (const item of config.bibliography ?? []) {
    const bibFile = typeof item === "string" ? item : item?.path;
    if (!bibFile) continue;
    if (!path.isAbsolute(bibFile) && bibFile.split(/[\\/]/).includes("..")) {
      diagnostics.error("BIB_PARENT_PATH", "Parent directory bibliography paths are not allowed.");
      continue;
    }
    const resolved = path.isAbsolute(bibFile) ? bibFile : path.resolve(path.dirname(file), bibFile);
    if (!fs.existsSync(resolved)) { diagnostics.error("BIB_NOT_FOUND", "Bibliography file '" + bibFile + "' does not exist."); continue; }
    const source = fs.readFileSync(resolved, "utf8");
    for (const match of source.matchAll(/@[^{]+\{([^,]+),([\s\S]*?)\n\}/g)) {
      const key = match[1].trim();
      const title = match[2].match(/title\s*=\s*[\{\"]([^\}\"]+)/i)?.[1] ?? key;
      if (entries.has(key)) diagnostics.warning("DUPLICATE_BIB_KEY", "Bibliography key '" + key + "' is duplicated; the later entry wins.");
      entries.set(key, { key, title });
    }
  }
  return entries;
}

function bibliography(config: Config, body: string, diagnostics: Diagnostics, file: string, entries: Map<string, any>): string {
  const refs = config.bibliography ?? [];
  if (!refs.length) return "";
  const cited = [...body.matchAll(/\[@([^\]]+)\]/g)].flatMap((m) => m[1].split(";").map((x) => x.trim().replace(/^@/, "")));
  const unique = [...new Set(cited)];
  const html = unique.map((key, index) => {
    const entry = entries.get(key);
    if (!entry) return "<li><b class=\"diagnostic-missing\">[" + escapeHtml(key) + "]</b></li>";
    return "<li id=\"ref-" + escapeHtml(key) + "\">[" + (index + 1) + "] " + escapeHtml(String(entry.title ?? key)) + (entry.url ? " <a href=\"" + escapeHtml(entry.url) + "\">" + escapeHtml(entry.url) + "</a>" : "") + "</li>";
  }).join("");
  const heading = config.citation.heading;
  return "<h" + heading.level + ">" + escapeHtml(heading.text) + "</h" + heading.level + "><ol class=\"references\">" + html + "</ol>";
}

function renderTitle(config: Config): string {
  const meta = config.meta ?? {};
  if (!meta.title) return "";
  const authors = Array.isArray(meta.author) ? meta.author : meta.author ? [meta.author] : [];
  const authorHtml = authors.map((author: any) => {
    const value = typeof author === "string" ? { name: author } : author;
    const name = escapeHtml(String(value.name ?? value));
    const link = value.url ? " <a href=\"" + escapeHtml(String(value.url)) + "\">" + escapeHtml(String(value.url)) + "</a>" : "";
    const affiliation = value.affiliation ? " <span class=\"affiliation\">" + escapeHtml(String(value.affiliation)) + "</span>" : "";
    return "<div class=\"author\">" + name + affiliation + link + "</div>";
  }).join("");
  const date = meta.date ? "<div class=\"date\">" + escapeHtml(String(meta.date)) + "</div>" : "";
  return "<header class=\"document-title\"><h1>" + escapeHtml(String(meta.title)) + "</h1>" + authorHtml + date + "</header>";
}

function renderToc(html: string): string {
  const items = [...html.matchAll(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g)].map((match) => {
    const id = match[2].match(/\sid=\"([^\"]+)\"/)?.[1];
    return id ? "<li class=\"toc-level-" + match[1] + "\"><a href=\"#" + escapeHtml(id) + "\">" + match[3] + "</a></li>" : "";
  }).filter(Boolean).join("");
  return "<nav class=\"table-of-contents\"><ol>" + items + "</ol></nav>";
}

function resolveReferences(html: string, references: Map<string, string>, diagnostics: Diagnostics): string {
  return html.replace(/<a href=\"#([^\"]+)\">([\s\S]*?)<\/a>/g, (_match, id: string, text: string) => {
    if (!references.has(id)) {
      diagnostics.warning("UNRESOLVED_REFERENCE", "Reference '#" + id + "' could not be resolved.");
      return "<b class=\"diagnostic-missing\">" + (text || "#" + escapeHtml(id)) + "</b>";
    }
    return text ? "<a href=\"#" + escapeHtml(id) + "\">" + text + "</a>" : "<a href=\"#" + escapeHtml(id) + "\">" + escapeHtml(references.get(id) ?? id) + "</a>";
  });
}

export function compile(source: string, file = "document.md"): CompileResult {
  const diagnostics = new Diagnostics();
  const loaded = loadConfig(source, file, diagnostics);
  const prepared = preprocess(loaded.body, loaded.config, diagnostics);
  const bibEntries = readBibliography(loaded.config, file, diagnostics);
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false }).use(footnote);
  let html = addHeadingNumbers(md.render(prepared.text), loaded.config);
  for (const [key, value] of prepared.replacements) html = html.split("<p>" + key + "</p>").join(value).split(key).join(value);
  const tocCount = (loaded.body.match(/<maketoc\s*\/>/g) ?? []).length;
  const titleCount = (loaded.body.match(/<maketitle\s*\/>/g) ?? []).length;
  const referencesCount = (loaded.body.match(/<references\s*\/>/g) ?? []).length;
  if (tocCount > 1) diagnostics.warning("DUPLICATE_TOC", "Only the first <maketoc /> is used.");
  if (titleCount > 1) diagnostics.warning("DUPLICATE_TITLE", "Only the first <maketitle /> is used.");
  if (referencesCount > 1) diagnostics.warning("DUPLICATE_REFERENCES", "Only the first <references /> is used.");
  if (/<maketitle\s*\/>/.test(loaded.body)) {
    if (!loaded.config.meta?.title) diagnostics.warning("MISSING_TITLE", "<maketitle /> requires meta.title.");
    html = html.replace(/<div class=\"mathmd-directive mathmd-maketitle\"><\/div>/, renderTitle(loaded.config));
  }
  if (tocCount > 0) {
    if (!/<h[1-6][^>]*>/.test(html)) diagnostics.warning("EMPTY_TOC", "<maketoc /> produced an empty table of contents.");
    html = html.replace(/<div class=\"mathmd-directive mathmd-maketoc\"><\/div>/, renderToc(html));
  }
  const numbers = new Map<string, number>();
  let nextNumber = 1;
  html = html.replace(/\[@([^\]]+)\]/g, (_m, keys: string) => {
    const seen = new Set<string>();
    const values = keys.split(";").map((x: string) => x.trim().replace(/^@/, "")).filter((key: string) => {
      if (seen.has(key)) { diagnostics.warning("DUPLICATE_CITATION", "Citation key '" + key + "' is repeated in one citation."); return false; }
      seen.add(key); return true;
    }).map((key: string) => {
      if (!bibEntries.has(key)) { diagnostics.warning("MISSING_CITATION", "Citation key '" + key + "' is not present in the bibliography."); return "<b class=\"diagnostic-missing\">[" + escapeHtml(key) + "]</b>"; }
      if (!numbers.has(key)) numbers.set(key, nextNumber++);
      return String(numbers.get(key));
    });
    return "<span class=\"citation\">[" + values.join(", ") + "]</span>";
  });
  if (loaded.body.match(/\[@[^\]]+\]/) && referencesCount === 0) diagnostics.error("REFERENCES_DIRECTIVE_MISSING", "Citations require a <references /> element.");
  if (referencesCount > 0) {
    if (!(loaded.config.bibliography ?? []).length) diagnostics.warning("MISSING_BIBLIOGRAPHY", "<references /> was requested but no bibliography data was configured.");
    html = html.replace(/<div class=\"mathmd-directive mathmd-references\"><\/div>/, bibliography(loaded.config, loaded.body, diagnostics, file, bibEntries));
  }
  html = resolveReferences(html, prepared.references, diagnostics);
  for (const diagnostic of diagnostics.items) if (!diagnostic.location) diagnostic.location = locationFor(source, file, 0, Math.min(source.length, 1));
  return { html: "<!doctype html><html lang=\"" + loaded.config.meta.language + "\"><head><meta charset=\"utf-8\"><style>body{font-family:serif;max-width:180mm;margin:25mm auto;line-height:1.6}.callout{border-left:4px solid #888;padding:.5em 1em;margin:1em 0}.callout-title{font-weight:bold}.qed{float:right}.diagnostic-missing{color:red;font-weight:bold}.table-of-contents{border:1px solid #ddd;padding:1em}.document-title{text-align:center;margin-bottom:2em}.equation-row{display:flex;align-items:center;gap:.25em}.math-anchor-left{text-align:left}.math-anchor-right{text-align:right}.math-anchor-gap{min-width:1.5em}</style></head><body>" + html + "</body></html>", config: loaded.config, diagnostics };
}

export function compileFile(file: string): CompileResult {
  return compile(fs.readFileSync(file, "utf8"), path.resolve(file));
}
