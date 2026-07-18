import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import deflist from "markdown-it-deflist";
import { loadConfig, type Config } from "./config.js";
import { Diagnostics, locationFor } from "./diagnostics.js";
import { renderMath, renderMultilineMath } from "./math.js";
import { renderTikzCd } from "./tikz.js";

export interface CompileResult {
  html: string;
  config: Config;
  diagnostics: Diagnostics;
}

interface RenderContext {
  counters: Map<string, number>;
  ids: Set<string>;
  references: Map<string, string>;
  figures: number;
  sourceFile: string;
}

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SAFE_ATTRIBUTE_NAMES = new Set(["role", "title", "lang", "dir", "tabindex", "hidden", "open"]);

interface ParsedAttributes { id: string; classes: string[]; attributes: Record<string, string>; }

function parseAttributes(source: string, diagnostics: Diagnostics): ParsedAttributes {
  const id = source.match(/(?:^|\s)#([A-Za-z][A-Za-z0-9:_-]*)/)?.[1] ?? "";
  const classes = [...source.matchAll(/(?:^|\s)\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((match) => match[1]);
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (!SAFE_ATTRIBUTE_NAMES.has(name) && !/^aria-[a-z][A-Za-z0-9-]*$/.test(name) && !/^data-[a-z][A-Za-z0-9-]*$/.test(name)) {
      diagnostics.error("UNSAFE_HTML_ATTRIBUTE", "HTML attribute '" + name + "' is not allowed.");
      continue;
    }
    attributes[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return { id, classes, attributes };
}

function serializeAttributes(attributes: ParsedAttributes): string {
  return encodeURIComponent(JSON.stringify(attributes));
}

function renderAttributes(id: string, classes: string, attributes: Record<string, string>): string {
  const parts = [] as string[];
  if (id) parts.push("id=\"" + escapeHtml(id) + "\"");
  if (classes) parts.push("class=\"" + escapeHtml(classes) + "\"");
  for (const [name, value] of Object.entries(attributes)) parts.push(name + "=\"" + escapeHtml(value) + "\"");
  return parts.length ? " " + parts.join(" ") : "";
}

function expandMacros(source: string, config: Config): string {
  let expanded = source;
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const [name, definition] of Object.entries(config.command?.macros ?? {}) as Array<[string, any]>) {
      const args = Number(definition.args ?? 0);
      const pattern = new RegExp("\\\\" + name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") + (args ? "((?:\\{[^{}]*\\}|[^\\s\\\\])+?)".repeat(args) : ""), "g");
      expanded = expanded.replace(pattern, (_match, ...values: string[]) => {
        changed = true;
        const parameters = values.slice(0, args).map((value) => value.replace(/^\{|\}$/g, ""));
        return String(definition.body ?? "").replace(/#([1-4])/g, (_placeholder: string, index: string) => parameters[Number(index) - 1] ?? "");
      });
    }
    if (!changed) break;
  }
  return expanded;
}

function counterText(template: string, name: string, value: number): string {
  return template.replace(/\{([^}]+)\}/g, (_m, expression: string) => {
    const leaf = expression.trim().split(">").at(-1)?.trim() ?? "";
    const pair = leaf.split(".");
    if (pair.length !== 2) return "";
    return pair[0] === name ? String(value) : "";
  });
}

function renderCallout(name: string, body: string, config: Config, context: RenderContext, id: string | undefined, classes: string[], attributes: Record<string, string>, diagnostics: Diagnostics): string {
  const definitions = config.layout.callouts ?? {};
  const definition = definitions[name] ?? { title: name, style: "plain" };
  const configuredStyle = String(definition.style ?? "plain");
  const style = ["plain", "definition", "remark", "proof"].includes(configuredStyle) ? configuredStyle : "plain";
  const title = String(definition.title ?? name);
  const numbered = /\{[^}]+\}/.test(title);
  let renderedTitle = title;
  if (numbered) {
    const current = (context.counters.get(name) ?? 0) + 1;
    context.counters.set(name, current);
    renderedTitle = counterText(title, name, current);
  }
  if (id) {
    if (context.ids.has(id)) diagnostics.error("DUPLICATE_ID", "ID '" + id + "' is defined more than once.");
    context.ids.add(id);
    context.references.set(id, renderedTitle);
  }
  const content = renderMarkdownBody(body.trim() + "\n", config, context, diagnostics);
  const qed = style === "proof" ? "<span class=\"qed\">□</span>" : "";
  const customStyle = style === "plain" && configuredStyle !== "plain" ? "callout-style-" + configuredStyle : "";
  const classAttribute = ["callout", "callout-" + style, customStyle, typeof definition.class === "string" ? definition.class : "", ...classes].filter(Boolean).map(escapeHtml).join(" ");
  return "<div" + renderAttributes(id ?? "", classAttribute, attributes) + "><div class=\"callout-title\">" + escapeHtml(renderedTitle) + "</div><div class=\"callout-body\">" + content + qed + "</div></div>";
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
  const resolveTexReferences = (value: string): string => value.replace(/\\(eqref|ref)\{([^}]+)\}/g, (_match, kind: string, id: string) => {
    const reference = references.get(id);
    if (!reference) {
      diagnostics.warning("UNRESOLVED_REFERENCE", "Reference '#" + id + "' could not be resolved.");
      return "\\text{??}";
    }
    const label = kind === "eqref" ? reference : reference.replace(/^\(|\)\s*$/g, "");
    const escaped = label.replace(/[\\%#$&_{}]/g, "\\$&");
    return "\\href{#" + id.replace(/[^A-Za-z0-9:_-]/g, "") + "}{\\text{" + escaped + "}}";
  });
  let text = source.replace(/\$\$([\s\S]*?)\$\$/g, (_m, body: string) => {
    try {
      if (/\\\\\s*$/.test(body)) diagnostics.warning("TRAILING_MATH_BREAK", "A trailing math line break was removed.");
      const rows = renderMultilineMath(body);
      const maxCells = Math.max(1, ...rows.map((row) => (row.source ?? "").includes("&") ? (row.source ?? "").split("&").length : 1));
      const rendered = rows.map((row, rowIndex) => {
        const label = row.labels[0];
        const notag = /\\notag\b/.test(row.source ?? "");
        const numbered = Boolean(config.layout.equation.numbered) || Boolean(label);
        if (notag && label) diagnostics.error("NOTAG_LABEL", "\\notag and \\label cannot occur on the same equation row.");
        const numberValue = numbered && !notag ? ++equation : 0;
        const number = numberValue ? "<span class=\"equation-number\" style=\"grid-column:" + (maxCells + 3) + ";grid-row:" + (rowIndex + 1) + "\">(" + numberValue + ")</span>" : "";
        if (label) {
          if (ids.has(label)) diagnostics.error("DUPLICATE_ID", "ID '" + label + "' is defined more than once.");
          ids.add(label);
          references.set(label, numberValue ? "(" + numberValue + ")" : "equation");
        }
        const rowSource = row.source ?? "";
        let mathHtml = renderMath(resolveTexReferences(expandMacros(rowSource, config)), true).html;
        if (rowSource.includes("&")) {
          const cells = rowSource.split("&");
          mathHtml = cells.map((cell, index) => {
            const style = "grid-column:" + (index + 2) + ";grid-row:" + (rowIndex + 1) + ";";
            if (!cell.trim()) return "<span class=\"equation-content math-anchor-gap\" style=\"" + style + "\"></span>";
      try { return "<span class=\"equation-content math-anchor-" + (index % 2 ? "left" : "right") + "\" style=\"" + style + "\">" + renderMath(resolveTexReferences(expandMacros(cell, config)), true).html + "</span>"; }
            catch { return "<span class=\"math-error\">[math error]</span>"; }
          }).join("");
        }
        if (!rowSource.includes("&")) mathHtml = "<span class=\"equation-content math-anchor-center\" style=\"grid-column:2;grid-row:" + (rowIndex + 1) + ";\">" + mathHtml + "</span>";
        return "<div class=\"equation-row\"" + (label ? " id=\"" + escapeHtml(label) + "\"" : "") + ">" + mathHtml + number + "</div>";
      }).join("");
      return put("<div class=\"math-block\" style=\"grid-template-columns:1fr repeat(" + maxCells + ",max-content) 1fr max-content;\">" + rendered + "</div>");
    } catch (error) {
      diagnostics.error("MATH_RENDER", String(error));
      return put("<div class=\"math-block math-error\">[math error]</div>");
    }
  });
  text = text.replace(/\$([^$\n]+)\$/g, (_m, body: string) => {
    try { return put(renderMath(resolveTexReferences(expandMacros(body, config)), false).html); }
    catch (error) { diagnostics.error("MATH_RENDER", String(error)); return put("<span class=\"math-error\">[math error]</span>"); }
  });
  return { text, values };
}

function figureLabel(template: string, value: number): string {
  return template.replace(/\{figure\.arabic\}/g, String(value));
}

function protectImages(source: string, config: Config, context: RenderContext, diagnostics: Diagnostics, replacements: Map<string, string>): string {
  let index = 0;
  return source.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)\s*(?:\{([^}]*)\})?/g, (match, alt: string, src: string, title: string | undefined, attributes: string | undefined) => {
    if (/^(?:https?:|data:|\/\/)/i.test(src) || path.isAbsolute(src) || src.split(/[\\/]/).includes("..")) {
      diagnostics.error("UNSUPPORTED_IMAGE", "Images must use local paths without parent directory traversal.");
      return match;
    }
    const resolved = path.resolve(path.dirname(context.sourceFile), src);
    if (!fs.existsSync(resolved)) diagnostics.error("IMAGE_NOT_FOUND", "Image file '" + src + "' does not exist.");
    const extension = path.extname(src).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".svg"].includes(extension)) diagnostics.error("UNSUPPORTED_IMAGE_TYPE", "Unsupported image type '" + extension + "'.");
    const id = attributes?.match(/(?:^|\s)#([A-Za-z][A-Za-z0-9:_-]*)/)?.[1];
    if (id) {
      if (context.ids.has(id)) diagnostics.error("DUPLICATE_ID", "ID '" + id + "' is defined more than once.");
      context.ids.add(id);
    }
    const numbered = config.layout.figure?.numbered !== false;
    const number = numbered ? ++context.figures : 0;
    const label = number ? figureLabel(String(config.layout.figure.display ?? "Figure {figure.arabic}."), number) : "";
    if (id) context.references.set(id, label || "Figure");
    const caption = [label, alt].filter(Boolean).join(" ");
    const token = "MATHMDIMAGE" + index++ + "TOKEN";
    replacements.set(token, "<figure" + (id ? " id=\"" + escapeHtml(id) + "\"" : "") + " class=\"figure\"><img src=\"" + escapeHtml(src) + "\" alt=\"" + escapeHtml(alt) + "\"" + (title ? " title=\"" + escapeHtml(title) + "\"" : "") + ">" + (caption ? "<figcaption class=\"figure-caption\">" + escapeHtml(caption) + "</figcaption>" : "") + "</figure>");
    return token;
  });
}

function preprocess(source: string, config: Config, diagnostics: Diagnostics, context: RenderContext): { text: string; replacements: Map<string, string> } {
  const replacements = new Map<string, string>();
  let sequence = 0;
  const token = (html: string): string => { const value = "MATHMDTOKEN" + sequence++ + "END"; replacements.set(value, html); return value; };
  const imageSafeSource = protectImages(source, config, context, diagnostics, replacements);
  const lines = imageSafeSource.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```tikzcd\s*$/i.test(line)) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) { body.push(lines[j]); j++; }
      if (j >= lines.length) diagnostics.error("UNCLOSED_TIKZCD", "tikzcd fence is not closed.");
      output.push(token(renderTikzCd(body.join("\n"))));
      i = j;
      continue;
    }
    const callout = line.match(/^>\s*\[!([^\]]+)\](?:\s+(.*))?$/);
    if (callout) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && (/^>/.test(lines[j]) || lines[j].trim() === "")) {
        if (/^>\s*\[!([^\]]+)\]/.test(lines[j])) break;
        body.push(lines[j].replace(/^>\s?/, "")); j++;
      }
      let calloutTitle = callout[2] ?? "";
      const calloutAttributes = calloutTitle.match(/\s+\{([^}]*)\}\s*$/);
      const parsedCalloutAttributes = parseAttributes(calloutAttributes?.[1] ?? "", diagnostics);
      if (calloutAttributes) calloutTitle = calloutTitle.slice(0, calloutAttributes.index).trim();
      output.push(token(renderCallout(callout[1].trim(), [calloutTitle, ...body].join("\n"), config, context, parsedCalloutAttributes.id, parsedCalloutAttributes.classes, parsedCalloutAttributes.attributes, diagnostics)));
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
      const parsedAttributes = parseAttributes(heading[4] ?? "", diagnostics);
      if (parsedAttributes.id) { if (context.ids.has(parsedAttributes.id)) diagnostics.error("DUPLICATE_ID", "ID '" + parsedAttributes.id + "' is defined more than once."); context.ids.add(parsedAttributes.id); context.references.set(parsedAttributes.id, heading[3]); }
      output.push(heading[1] + " MATHMDNONUM MATHMDATTR:" + serializeAttributes(parsedAttributes) + ":" + heading[3]);
      continue;
    }
    const ordinaryHeading = line.match(/^(#{1,6})\s+(.+?)\s+\{([^}]*)\}\s*$/);
    if (ordinaryHeading) {
      const parsedAttributes = parseAttributes(ordinaryHeading[3], diagnostics);
      if (parsedAttributes.id) { if (context.ids.has(parsedAttributes.id)) diagnostics.error("DUPLICATE_ID", "ID '" + parsedAttributes.id + "' is defined more than once."); context.ids.add(parsedAttributes.id); context.references.set(parsedAttributes.id, ordinaryHeading[2]); }
      output.push(ordinaryHeading[1] + " MATHMDATTR:" + serializeAttributes(parsedAttributes) + ":" + ordinaryHeading[2]);
      continue;
    }
    output.push(line);
  }
  const footnoteDefinitions = new Set([...source.matchAll(/^\[\^([^\]]+)\]:/gm)].map((match) => match[1]));
  let commentSafeSource = output.join("\n").replace(/<!--[\s\S]*?-->/g, (comment) => token(comment));
  commentSafeSource = commentSafeSource.replace(/\[\^([^\]]+)\]/g, (match, label: string) => {
    if (footnoteDefinitions.has(label)) return match;
    diagnostics.warning("UNRESOLVED_FOOTNOTE", "Footnote '" + label + "' is not defined.");
    return token("<b class=\"diagnostic-missing\">[^" + escapeHtml(label) + "]</b>");
  });
  const protectedMath = protectMath(commentSafeSource, config, diagnostics, context.ids, context.references);
  for (const [key, value] of protectedMath.values) replacements.set(key, value);
  return { text: protectedMath.text, replacements };
}

function renderMarkdownBody(source: string, config: Config, context: RenderContext, diagnostics: Diagnostics): string {
  const prepared = preprocess(source, config, diagnostics, context);
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false }).use(footnote).use(taskLists, { enabled: true, label: true, labelAfter: true }).use(deflist);
  md.block.ruler.disable("code");
  let content = md.render(prepared.text);
  content = content.replace(/<table>/g, "<table class=\"mathmd-table\">");
  content = content.replace(/<p>(?=<div\b)/g, "").replace(/<\/div><\/p>/g, "</div>");
  for (let pass = 0; pass <= prepared.replacements.size; pass++) {
    let changed = false;
    for (const [key, value] of prepared.replacements) {
      const next = content.replace(new RegExp("<p>\\s*" + escapeRegex(key) + "\\s*</p>", "g"), value).split(key).join(value);
      if (next !== content) changed = true;
      content = next;
    }
    if (!changed) break;
  }
  return content;
}

function addHeadingNumbers(html: string, config: Config): string {
  const counters = [0, 0, 0, 0, 0, 0, 0];
  const depth = Number(config.layout.heading.numberingDepth ?? 3);
  const formats = config.layout.heading.formats ?? {};
  return html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g, (_m, levelText: string, existingAttrs: string, content: string) => {
    const level = Number(levelText);
    if (existingAttrs.includes("document-title-heading")) return _m;
    const marker = "MATHMDNONUM ";
    let id = "";
    let classes = "";
    let customAttributes: Record<string, string> = {};
    const unnumbered = content.startsWith("MATHMDNONUM ");
    if (unnumbered) content = content.slice("MATHMDNONUM ".length);
    if (content.startsWith("MATHMDATTR:")) {
      const attribute = content.match(/^MATHMDATTR:([^:]+):(.*)$/s);
      if (attribute) {
        try {
          const parsed = JSON.parse(decodeURIComponent(attribute[1])) as ParsedAttributes;
          id = parsed.id ?? "";
          classes = (parsed.classes ?? []).join(" ");
          customAttributes = parsed.attributes ?? {};
          content = attribute[2];
        } catch { content = attribute[2]; }
      }
    }
    if (content.startsWith(marker)) content = content.slice(marker.length);
    const attrs = existingAttrs + renderAttributes(id, classes, customAttributes);
    if (unnumbered) {
      counters[level] = 0;
      for (let i = level + 1; i <= 6; i++) counters[i] = 0;
      return "<h" + level + attrs + ">" + content + "</h" + level + ">";
    }
    if (!config.layout.heading.numbered || level > depth) return "<h" + level + attrs + ">" + content + "</h" + level + ">";
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
      const fields = match[2];
      const field = (name: string): string | undefined => fields.match(new RegExp(name + "\\s*=\\s*[\\{\\\"]([^\\}\\\"]+)", "i"))?.[1]?.trim();
      const title = field("title") ?? key;
      const author = field("author") ?? "";
      const year = field("year") ?? field("date")?.slice(0, 4) ?? "";
      const url = field("url");
      if (entries.has(key)) diagnostics.warning("DUPLICATE_BIB_KEY", "Bibliography key '" + key + "' is duplicated; the later entry wins.");
      entries.set(key, { key, title, author, year, url });
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
    const author = String(entry.author ?? "");
    const year = String(entry.year ?? "");
    const prefix = config.citation.style === "author-year" ? (author ? author + (year ? " (" + year + ")" : "") : year) : "[" + (index + 1) + "]";
    const url = entry.url ? " <a href=\"" + escapeHtml(entry.url) + "\">" + escapeHtml(entry.url) + "</a>" : "";
    const authorLines = author.split(/\s+and\s+|;/i).map((name: string) => name.trim()).filter(Boolean).map((name: string) => "<span class=\"reference-author\">" + escapeHtml(name) + "</span>").join("<br>");
    return "<li id=\"ref-" + escapeHtml(key) + "\"><span class=\"reference-authors\">" + (config.citation.style === "author-year" ? authorLines : "") + "</span>" + (config.citation.style === "author-year" && authorLines ? " " : "") + (config.citation.style === "numeric" ? "<span class=\"reference-label\">" + escapeHtml(prefix) + "</span> " : "") + escapeHtml(String(entry.title ?? key)) + (config.citation.style === "author-year" && year ? " (" + escapeHtml(year) + ")" : "") + url + "</li>";
  }).join("");
  const heading = config.citation.heading;
  const referenceClass = config.citation.style === "numeric" ? "references references-numeric" : "references references-author-year";
  return "<h" + heading.level + ">" + escapeHtml(heading.text) + "</h" + heading.level + "><ul class=\"" + referenceClass + "\">" + html + "</ul>";
}

function citationAuthor(author: string): string {
  const names = author.split(/\s+and\s+|;/i).map((name) => name.trim()).filter(Boolean).map((name) => name.includes(",") ? name.split(",")[0].trim() : name.split(/\s+/).at(-1) ?? name);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return names.join(" and ");
  return names[0] + " et al.";
}

function formatDocumentDate(config: Config): string {
  const meta = config.meta ?? {};
  const raw = meta.date == null ? new Date() : new Date(String(meta.date));
  const date = Number.isNaN(raw.getTime()) ? new Date() : raw;
  const timezone = String(meta.timezone ?? "UTC");
  const locale = /^ja(?:-|$)/i.test(String(meta.language ?? "en")) ? "ja-JP" : "en-US";
  const parts = Object.fromEntries(new Intl.DateTimeFormat(locale, { timeZone: timezone, year: "numeric", month: "long", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value]));
  const numeric = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(numeric.map((part) => [part.type, part.value]));
  const year = values.year ?? "";
  const month = values.month ?? "";
  const day = values.day ?? "";
  const monthLong = parts.month ?? month;
  const monthShort = new Intl.DateTimeFormat(locale, { timeZone: timezone, month: "short" }).format(date);
  const format = String(config.layout.title.dateFormat ?? "yyyy-mm-dd");
  return format.replace(/yyyy|yy|MMMM|MMM|mm|m|dd|d/g, (token) => ({ yyyy: year, yy: year.slice(-2), MMMM: monthLong, MMM: monthShort, mm: month, m: String(Number(month)), dd: day, d: String(Number(day)) }[token] ?? token));
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
    return "<div class=\"author\"><span class=\"author-name\">" + name + "</span>" + affiliation + link + "</div>";
  }).join("");
  const date = "<div class=\"date\">" + escapeHtml(formatDocumentDate(config)) + "</div>";
  return "<header class=\"document-title\"><h1 class=\"document-title-heading\">" + escapeHtml(String(meta.title)) + "</h1>" + authorHtml + date + "</header>";
}

function renderToc(html: string, config: Config): string {
  const tocDepth = config.layout.heading.tocDepth;
  const items = [...html.matchAll(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g)].map((match) => {
    if (match[2].includes("document-title-heading")) return "";
    if (Number(match[1]) > tocDepth) return "";
    const id = match[2].match(/\sid=\"([^\"]+)\"/)?.[1];
    const title = id ? "<a href=\"#" + escapeHtml(id) + "\">" + match[3] + "</a>" : match[3];
    return "<li class=\"toc-level-" + match[1] + "\">" + title + "</li>";
  }).join("");
  return "<nav class=\"table-of-contents\"><h2 class=\"toc-title\">" + escapeHtml(String(config.layout.heading.toc)) + "</h2><ul class=\"toc-list\">" + items + "</ul></nav>";
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
  const context: RenderContext = { counters: new Map(), ids: new Set(), references: new Map(), figures: 0, sourceFile: file };
  const bibEntries = readBibliography(loaded.config, file, diagnostics);
  let html = renderMarkdownBody(loaded.body, loaded.config, context, diagnostics);
  html = html.replace(/<p>(?=<div\b)/g, "").replace(/<\/div><\/p>/g, "</div>");
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
  const numbers = new Map<string, number>();
  let nextNumber = 1;
  html = html.replace(/\[@([^\]]+)\]/g, (_m, keys: string) => {
    const seen = new Set<string>();
    const values = keys.split(";").map((x: string) => x.trim().replace(/^@/, "")).filter((key: string) => {
      if (seen.has(key)) { diagnostics.warning("DUPLICATE_CITATION", "Citation key '" + key + "' is repeated in one citation."); return false; }
      seen.add(key); return true;
    }).map((key: string) => {
      if (!bibEntries.has(key)) { diagnostics.warning("MISSING_CITATION", "Citation key '" + key + "' is not present in the bibliography."); return "<b class=\"diagnostic-missing\">[" + escapeHtml(key) + "]</b>"; }
      if (loaded.config.citation.style === "author-year") {
        const entry = bibEntries.get(key);
        return escapeHtml(citationAuthor(String(entry.author ?? "")) + (entry.year ? ", " + entry.year : ""));
      }
      if (!numbers.has(key)) numbers.set(key, nextNumber++);
      return String(numbers.get(key));
    });
    return loaded.config.citation.style === "author-year" ? "<span class=\"citation citation-author-year\">(" + values.join("; ") + ")</span>" : "<span class=\"citation\">[" + values.join(", ") + "]</span>";
  });
  if (loaded.body.match(/\[@[^\]]+\]/) && referencesCount === 0) diagnostics.error("REFERENCES_DIRECTIVE_MISSING", "Citations require a <references /> element.");
  if (referencesCount > 0) {
    if (!(loaded.config.bibliography ?? []).length) diagnostics.warning("MISSING_BIBLIOGRAPHY", "<references /> was requested but no bibliography data was configured.");
    html = html.replace(/<div class=\"mathmd-directive mathmd-references\"><\/div>/, bibliography(loaded.config, loaded.body, diagnostics, file, bibEntries));
  }
  html = addHeadingNumbers(html, loaded.config);
  if (tocCount > 0) {
    if (!/<h[1-6][^>]*>/.test(html)) diagnostics.warning("EMPTY_TOC", "<maketoc /> produced an empty table of contents.");
    html = html.replace(/<div class=\"mathmd-directive mathmd-maketoc\"><\/div>/, renderToc(html, loaded.config));
  }
  html = resolveReferences(html, context.references, diagnostics);
  for (const diagnostic of diagnostics.items) if (!diagnostic.location) diagnostic.location = locationFor(source, file, 0, Math.min(source.length, 1));
  return { html: "<!doctype html><html lang=\"" + loaded.config.meta.language + "\"><head><meta charset=\"utf-8\"><style>body{font-family:serif;max-width:180mm;margin:25mm auto;line-height:1.6}.callout{border-left:4px solid #888;padding:.5em 1em;margin:1em 0;break-inside:avoid}.callout-title{font-weight:bold}.qed{display:block;text-align:right;margin-top:.25em}.diagnostic-missing{color:red;font-weight:bold}.table-of-contents{border:1px solid #ddd;padding:1em;break-inside:avoid}.toc-title{margin-top:0}.toc-list{list-style:none;padding-left:0}.toc-list li{margin:.15em 0}.toc-level-1{padding-left:0}.toc-level-2{padding-left:1.5em}.toc-level-3{padding-left:3em}.toc-level-4{padding-left:4.5em}.toc-level-5{padding-left:6em}.toc-level-6{padding-left:7.5em}.mathmd-table{border-collapse:collapse;max-width:100%;break-inside:avoid}.mathmd-table th,.mathmd-table td{padding:.25em .5em}.figure{margin:1em auto;text-align:center;break-inside:avoid}.figure img{max-width:100%;height:auto}.figure-caption{margin-top:.25em}.mathmd-pagebreak{break-before:page;page-break-before:always;height:0}.task-list{list-style:none;padding-left:0}.task-list-item{list-style:none}.task-list-item input{margin-right:.4em}.code-block{margin:1em 0;break-inside:avoid}.code-block pre{margin:0;overflow-x:auto;white-space:pre}.code-header{display:flex;justify-content:space-between;gap:1em;padding:.35em .7em;background:#f2f2f2;border:1px solid #ddd;border-bottom:0;font:0.9em monospace}.code-content{display:block;padding:.7em;background:#fafafa;border:1px solid #ddd;overflow-x:auto}.references{list-style:none;padding-left:0;font-size:.9em}.references li{display:table;width:100%;break-inside:avoid;page-break-inside:avoid}.references li::marker{content:''}.references-numeric li{padding-left:2em;text-indent:-2em}.reference-author{display:inline-block}.tikzcd{break-inside:avoid;overflow-x:auto;margin:1em 0}.tikzcd-table{border-collapse:separate;border-spacing:2em 1em;margin:0 auto}.tikzcd-table td{min-width:2em;text-align:center;vertical-align:middle}.tikzcd-arrows{display:inline-block;margin-left:.5em;font-size:1.1em}.document-title{text-align:center;margin-bottom:2em}.author{display:flex;justify-content:center;align-items:baseline;gap:.5em;flex-wrap:wrap}.math-block{display:grid;width:100%;column-gap:.35em;align-items:baseline}.equation-row{display:contents}.equation-content{white-space:nowrap}.equation-number{text-align:right;white-space:nowrap}.math-anchor-center{text-align:center}.math-anchor-left{text-align:left}.math-anchor-right{text-align:right}.math-anchor-gap{min-width:1.5em}.mathml,mjx-assistive-mml{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important}</style></head><body>" + html + "</body></html>", config: loaded.config, diagnostics };
}

export function compileFile(file: string): CompileResult {
  return compile(fs.readFileSync(file, "utf8"), path.resolve(file));
}
