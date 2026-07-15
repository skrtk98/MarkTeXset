import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import { loadConfig, type Config } from "./config.js";
import { Diagnostics } from "./diagnostics.js";
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

function renderCallout(name: string, body: string, config: Config, counters: Map<string, number>): string {
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
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  const content = md.render(body.trim() + "\n");
  const qed = style === "proof" ? "<span class=\"qed\">□</span>" : "";
  return "<div class=\"callout callout-" + escapeHtml(style) + "\"><div class=\"callout-title\">" + escapeHtml(renderedTitle) + "</div><div class=\"callout-body\">" + content + qed + "</div></div>";
}

function protectMath(source: string, config: Config, diagnostics: Diagnostics): { text: string; values: Map<string, string> } {
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
      const rows = renderMultilineMath(body);
      const rendered = rows.map((row) => {
        const label = row.labels[0];
        const notag = /\\notag\b/.test(body);
        const numbered = Boolean(config.layout.equation.numbered) || Boolean(label);
        if (notag && label) diagnostics.error("NOTAG_LABEL", "\\notag and \\label cannot occur on the same equation row.");
        const number = numbered && !notag ? " <span class=\"equation-number\">(" + (++equation) + ")</span>" : "";
        return "<div class=\"equation-row\"" + (label ? " id=\"" + escapeHtml(label) + "\"" : "") + ">" + row.html + number + "</div>";
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

function preprocess(source: string, config: Config, diagnostics: Diagnostics): { text: string; replacements: Map<string, string> } {
  const replacements = new Map<string, string>();
  let sequence = 0;
  const token = (html: string): string => { const value = "MATHMDTOKEN" + sequence++ + "END"; replacements.set(value, html); return value; };
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  const counters = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const callout = line.match(/^>\s*\[!([^\]]+)\](?:\s+(.*))?$/);
    if (callout) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && (/^>/.test(lines[j]) || lines[j].trim() === "")) {
        body.push(lines[j].replace(/^>\s?/, "")); j++;
      }
      output.push(token(renderCallout(callout[1].trim(), [callout[2] ?? "", ...body].join("\n"), config, counters)));
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
    output.push(line);
  }
  const protectedMath = protectMath(output.join("\n"), config, diagnostics);
  for (const [key, value] of protectedMath.values) replacements.set(key, value);
  return { text: protectedMath.text, replacements };
}

function addHeadingNumbers(html: string, config: Config): string {
  const counters = [0, 0, 0, 0, 0, 0, 0];
  const depth = Number(config.layout.heading.numberingDepth ?? 3);
  const formats = config.layout.heading.formats ?? {};
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_m, levelText: string, content: string) => {
    const level = Number(levelText);
    const marker = "MATHMDNONUM ";
    if (content.startsWith(marker)) return "<h" + level + ">" + content.slice(marker.length) + "</h" + level + ">";
    if (!config.layout.heading.numbered || level > depth) return "<h" + level + ">" + content + "</h" + level + ">";
    counters[level]++;
    for (let i = level + 1; i <= 6; i++) counters[i] = 0;
    const format = String(formats["h" + level] ?? "");
    const number = format.replace(/\{h([1-6])\.arabic\}/g, (_x: string, n: string) => String(counters[Number(n)] || 0));
    return "<h" + level + ">" + escapeHtml(number) + " " + content + "</h" + level + ">";
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
    if (!entry) { diagnostics.warning("MISSING_CITATION", "Citation key '" + key + "' is not present in the bibliography."); return "<li><b class=\"diagnostic-missing\">[" + escapeHtml(key) + "]</b></li>"; }
    return "<li id=\"ref-" + escapeHtml(key) + "\">[" + (index + 1) + "] " + escapeHtml(String(entry.title ?? key)) + (entry.url ? " <a href=\"" + escapeHtml(entry.url) + "\">" + escapeHtml(entry.url) + "</a>" : "") + "</li>";
  }).join("");
  const heading = config.citation.heading;
  return "<h" + heading.level + ">" + escapeHtml(heading.text) + "</h" + heading.level + "><ol class=\"references\">" + html + "</ol>";
}

export function compile(source: string, file = "document.md"): CompileResult {
  const diagnostics = new Diagnostics();
  const loaded = loadConfig(source, file, diagnostics);
  const prepared = preprocess(loaded.body, loaded.config, diagnostics);
  const bibEntries = readBibliography(loaded.config, file, diagnostics);
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false }).use(footnote);
  let html = addHeadingNumbers(md.render(prepared.text.replace(/^(#{1,6}):\s+/gm, "$1 MATHMDNONUM ")), loaded.config);
  for (const [key, value] of prepared.replacements) html = html.split("<p>" + key + "</p>").join(value).split(key).join(value);
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
  return { html: "<!doctype html><html lang=\"" + loaded.config.meta.language + "\"><head><meta charset=\"utf-8\"><style>body{font-family:serif;max-width:180mm;margin:25mm auto;line-height:1.6}.callout{border-left:4px solid #888;padding:.5em 1em;margin:1em 0}.callout-title{font-weight:bold}.qed{float:right}.diagnostic-missing{color:red;font-weight:bold}</style></head><body>" + html + bibliography(loaded.config, loaded.body, diagnostics, file, bibEntries) + "</body></html>", config: loaded.config, diagnostics };
}

export function compileFile(file: string): CompileResult {
  return compile(fs.readFileSync(file, "utf8"), path.resolve(file));
}
