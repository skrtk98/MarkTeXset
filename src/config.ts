import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { Diagnostics, locationFor } from "./diagnostics.js";

export type Config = Record<string, any>;

const DEFAULT_CONFIG: Config = {
  meta: { language: "en", timezone: "UTC" },
  bibliography: [],
  citation: { style: "numeric", heading: { text: "References", level: 2 } },
  layout: {
    class: "article",
    size: "A4",
    margins: "25mm",
    paginate: true,
    page: {
      number: { visible: true, position: "bottom-center", format: "{page.arabic}" },
      style: "plain",
    },
    title: { dateFormat: "yyyy-mm-dd" },
    heading: {
      numbered: true,
      numberingDepth: 3,
      tocDepth: 3,
      toc: "Contents",
      formats: {
        h1: "{h1.arabic}.",
        h2: "{h1.arabic}.{h2.arabic}.",
        h3: "{h1.arabic}.{h2.arabic}.{h3.arabic}.",
      },
    },
    counter: { maxDepth: 3 },
    footnote: { format: "{footnote.arabic}", placement: "bottom" },
    figure: { numbered: true, display: "Figure {figure.arabic}.", reference: "Figure {figure.arabic}" },
    equation: { numbered: false, display: "({equation.arabic})", reference: "式 ({equation.arabic})" },
    callouts: {},
  },
  command: { macros: {}, operators: {} },
  network: { allow: false, domains: [] },
};

const ROOT_KEYS = new Set(["meta", "import", "bibliography", "citation", "layout", "command", "network"]);
const IMPORT_KEYS = new Set(["meta", "bibliography", "citation", "layout", "command", "network"]);
const NUMBER_FORMATS = new Set(["arabic", "roman", "Roman", "alph", "Alph"]);
const CALLOUT_STYLES = new Set(["plain", "definition", "remark", "proof"]);
const OPERATOR_FONTS = new Set(["mathrm", "mathcal", "mathbb"]);
const BUILTIN_COMMANDS = new Set(["frac", "sqrt", "sum", "prod", "int", "lim", "sin", "cos", "log", "exp", "text", "operatorname"]);

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function merge(base: Record<string, any>, next: Record<string, any>): Record<string, any> {
  const result = clone(base);
  for (const [key, value] of Object.entries(next)) {
    if ((key === "bibliography" || key === "domains") && Array.isArray(result[key]) && Array.isArray(value)) {
      result[key] = [...result[key], ...value];
    } else if (isRecord(result[key]) && isRecord(value)) {
      result[key] = merge(result[key], value);
    } else {
      result[key] = clone(value);
    }
  }
  return result;
}

function addUnknownKeyDiagnostics(value: Record<string, any>, allowed: Set<string>, file: string, source: string, diagnostics: Diagnostics): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) diagnostics.error("UNKNOWN_CONFIG_KEY", "Unknown configuration key '" + key + "'.", locationFor(source, file, 0), { suggestions: closest(key, [...allowed]) });
  }
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function closest(value: string, candidates: string[]): string[] {
  return candidates.map((candidate) => ({ candidate, distance: editDistance(value, candidate) }))
    .filter((item) => item.distance <= 2)
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, 3).map((item) => item.candidate);
}

function unknownNested(value: unknown, allowed: string[], label: string, file: string, source: string, diagnostics: Diagnostics): void {
  if (!isRecord(value)) return;
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) if (!keys.has(key)) diagnostics.error("UNKNOWN_CONFIG_KEY", "Unknown configuration key '" + label + "." + key + "'.", locationFor(source, file, 0), { suggestions: closest(key, allowed) });
}

function validateNestedKeys(value: Record<string, any>, file: string, source: string, diagnostics: Diagnostics): void {
  unknownNested(value.meta, ["language", "timezone", "title", "author", "date"], "meta", file, source, diagnostics);
  if (Array.isArray(value.meta?.author)) for (const [index, author] of value.meta.author.entries()) unknownNested(author, ["name", "affiliation", "url"], "meta.author." + index, file, source, diagnostics);
  unknownNested(value.citation, ["style", "heading"], "citation", file, source, diagnostics);
  unknownNested(value.citation?.heading, ["text", "level"], "citation.heading", file, source, diagnostics);
  unknownNested(value.network, ["allow", "domains"], "network", file, source, diagnostics);
  unknownNested(value.layout, ["class", "size", "margins", "paginate", "page", "title", "heading", "counter", "footnote", "equation", "figure", "callouts"], "layout", file, source, diagnostics);
  unknownNested(value.layout?.page, ["number", "style"], "layout.page", file, source, diagnostics);
  unknownNested(value.layout?.page?.number, ["visible", "position", "format"], "layout.page.number", file, source, diagnostics);
  unknownNested(value.layout?.title, ["date-format", "dateFormat"], "layout.title", file, source, diagnostics);
  unknownNested(value.layout?.heading, ["numbered", "numbering-depth", "numberingDepth", "toc-depth", "tocDepth", "toc", "h1", "h2", "h3", "formats"], "layout.heading", file, source, diagnostics);
  unknownNested(value.layout?.heading?.formats, ["h1", "h2", "h3"], "layout.heading.formats", file, source, diagnostics);
  unknownNested(value.layout?.counter, ["max-depth", "maxDepth"], "layout.counter", file, source, diagnostics);
  unknownNested(value.layout?.footnote, ["format", "placement"], "layout.footnote", file, source, diagnostics);
  unknownNested(value.layout?.equation, ["numbered", "display", "reference"], "layout.equation", file, source, diagnostics);
  unknownNested(value.layout?.figure, ["numbered", "display", "reference"], "layout.figure", file, source, diagnostics);
  if (isRecord(value.layout?.callouts)) for (const [name, definition] of Object.entries(value.layout.callouts)) unknownNested(definition, ["title", "style"], "layout.callouts." + name, file, source, diagnostics);
  unknownNested(value.command, ["macros", "operators"], "command", file, source, diagnostics);
  if (isRecord(value.command?.macros)) for (const [name, definition] of Object.entries(value.command.macros)) unknownNested(definition, ["args", "body", "redef"], "command.macros." + name, file, source, diagnostics);
  if (isRecord(value.command?.operators)) for (const [name, definition] of Object.entries(value.command.operators)) unknownNested(definition, ["text", "font", "limits", "redef"], "command.operators." + name, file, source, diagnostics);
}

function parseYaml(source: string, file: string, diagnostics: Diagnostics): Record<string, any> {
  const document = parseDocument(source, { uniqueKeys: true });
  for (const error of document.errors) diagnostics.error("YAML_PARSE", error.message, locationFor(source, file, 0));
  const value = document.toJS({ mapAsMap: false });
  if (!isRecord(value)) {
    diagnostics.error("YAML_ROOT", "Configuration must be a mapping.", locationFor(source, file, 0));
    return {};
  }
  return value;
}

function validateValueShape(value: Record<string, any>, file: string, source: string, diagnostics: Diagnostics, root: boolean): void {
  addUnknownKeyDiagnostics(value, root ? ROOT_KEYS : IMPORT_KEYS, file, source, diagnostics);
  validateNestedKeys(value, file, source, diagnostics);
  if (value.layout?.class !== undefined && value.layout.class !== "article") {
    diagnostics.error("UNSUPPORTED_CLASS", "Only the article class is supported in phase 1.", locationFor(source, file, 0));
  }
  if (value.layout?.size !== undefined && value.layout.size !== "A4") {
    diagnostics.error("UNSUPPORTED_PAGE_SIZE", "Only A4 is supported in phase 1.", locationFor(source, file, 0));
  }
  if (value.layout?.paginate !== undefined && typeof value.layout.paginate !== "boolean") diagnostics.error("INVALID_CONFIG_TYPE", "layout.paginate must be boolean.", locationFor(source, file, 0));
  if (value.layout?.heading?.toc !== undefined && typeof value.layout.heading.toc !== "string") diagnostics.error("INVALID_CONFIG_TYPE", "layout.heading.toc must be a string.", locationFor(source, file, 0));
  if (value.citation?.heading?.level !== undefined && (!Number.isInteger(value.citation.heading.level) || value.citation.heading.level < 1 || value.citation.heading.level > 6)) diagnostics.error("INVALID_HEADING_LEVEL", "citation.heading.level must be an integer from 1 to 6.", locationFor(source, file, 0));
  const language = value.meta?.language;
  if (language !== undefined) {
    try {
      const tag = String(language);
      new Intl.Locale(tag);
      if (!/^en(?:-|$)/i.test(tag) && !/^ja(?:-|$)/i.test(tag)) {
        diagnostics.warning("UNSUPPORTED_LANGUAGE_FALLBACK", "Language '" + tag + "' is not supported; falling back to en.", locationFor(source, file, 0));
      }
    } catch {
      diagnostics.error("INVALID_LANGUAGE_TAG", "Invalid BCP 47 language tag '" + language + "'.", locationFor(source, file, 0));
    }
  }
  if (value.meta?.timezone !== undefined) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: String(value.meta.timezone) }).format(); }
    catch { diagnostics.error("INVALID_TIMEZONE", "Invalid IANA timezone '" + value.meta.timezone + "'.", locationFor(source, file, 0)); }
  }
  if (value.meta?.author !== undefined && !Array.isArray(value.meta.author) && typeof value.meta.author !== "string" && !isRecord(value.meta.author)) {
    diagnostics.error("INVALID_AUTHOR", "meta.author must be a string, mapping, or list.", locationFor(source, file, 0));
  }
  if (typeof value.layout?.title?.["date-format"] === "string" || typeof value.layout?.title?.dateFormat === "string") {
    const dateFormat = value.layout.title["date-format"] ?? value.layout.title.dateFormat;
    if (!/^(?:yyyy|yy|MMMM|MMM|MM|M|mm|m|dd|d|[-/ .,:'T])+$/.test(String(dateFormat))) diagnostics.error("INVALID_DATE_FORMAT", "Date format contains unsupported tokens.", locationFor(source, file, 0));
  }
  if (value.citation?.style !== undefined && !["numeric", "author-year"].includes(String(value.citation.style))) {
    diagnostics.error("UNSUPPORTED_CITATION_STYLE", "Citation style must be numeric or author-year.", locationFor(source, file, 0));
  }
  if (value.network?.allow !== undefined && !root) {
    diagnostics.error("IMPORT_NETWORK_ALLOW", "network.allow may only be set in the root Frontmatter.", locationFor(source, file, 0));
  }
  if (root && value.network?.allow === true && (!Array.isArray(value.network.domains) || value.network.domains.length === 0)) {
    diagnostics.error("EMPTY_NETWORK_ALLOWLIST", "network.allow requires a non-empty domains list.", locationFor(source, file, 0));
  }
  if (value.network?.domains !== undefined && (!Array.isArray(value.network.domains) || value.network.domains.some((domain: unknown) => typeof domain !== "string"))) diagnostics.error("INVALID_NETWORK_DOMAINS", "network.domains must be a list of strings.", locationFor(source, file, 0));
  validateMargins(value.layout?.margins, file, source, diagnostics);
  validateLayout(value.layout, file, source, diagnostics);
  validateCommands(value.command, file, source, diagnostics);
}

function validateMargins(value: unknown, file: string, source: string, diagnostics: Diagnostics): void {
  if (value === undefined) return;
  const values = isRecord(value) ? Object.values(value) : [value];
  for (const item of values) {
    if (typeof item !== "string" || !/^(?:0|[0-9]+(?:\\.[0-9]+)?(?:mm|cm|in|pt))$/.test(item)) {
      diagnostics.error("INVALID_MARGIN", "Margins must be non-negative mm, cm, in, or pt lengths.", locationFor(source, file, 0));
    }
  }
}

function validateLayout(layout: Record<string, any> | undefined, file: string, source: string, diagnostics: Diagnostics): void {
  if (!isRecord(layout)) return;
  const depthValues = [layout.heading?.numberingDepth ?? layout.heading?.["numbering-depth"], layout.heading?.tocDepth ?? layout.heading?.["toc-depth"], layout.counter?.maxDepth ?? layout.counter?.["max-depth"]];
  for (const depth of depthValues) {
    if (depth !== undefined && (!Number.isInteger(depth) || depth < 0)) {
      diagnostics.error("INVALID_DEPTH", "Counter and heading depths must be non-negative integers.", locationFor(source, file, 0));
    }
  }
  const position = layout.page?.number?.position;
  if (position !== undefined && position !== "bottom-center") {
    diagnostics.error("UNSUPPORTED_PAGE_POSITION", "Only bottom-center is supported in phase 1.", locationFor(source, file, 0));
  }
  for (const [name, definition] of Object.entries(layout.callouts ?? {})) {
    if (!isRecord(definition)) continue;
    if (definition.style !== undefined && !CALLOUT_STYLES.has(String(definition.style))) {
      diagnostics.warning("UNKNOWN_CALLOUT_STYLE", "Unknown callout style '" + definition.style + "', falling back to plain.", locationFor(source, file, 0));
    }
    if (typeof definition.title === "string") validateTitle(definition.title, file, source, diagnostics);
    if (name.length === 0) diagnostics.error("INVALID_CALLOUT_NAME", "Callout names must not be empty.", locationFor(source, file, 0));
  }
}

function validateTitle(title: string, file: string, source: string, diagnostics: Diagnostics): void {
  const unescaped = title.replace(/\{\{/g, "").replace(/\}\}/g, "");
  const pattern = /\{([^}]+)\}/g;
  for (const match of unescaped.matchAll(pattern)) {
    const parts = match[1].split(">").map((part) => part.trim());
    if (parts.length > 3) diagnostics.error("COUNTER_DEPTH_EXCEEDED", "Counter scope exceeds layout.counter.max-depth.", locationFor(source, file, 0));
    const leaf = parts.at(-1) ?? "";
    const pair = leaf.split(".");
    if (pair.length !== 2 || !NUMBER_FORMATS.has(pair[1])) {
      diagnostics.error("INVALID_COUNTER_TEMPLATE", "Invalid counter placeholder '" + match[1] + "'.", locationFor(source, file, 0));
    }
  }
}

function validateCommands(command: Record<string, any> | undefined, file: string, source: string, diagnostics: Diagnostics): void {
  if (!isRecord(command)) return;
  const macros = command.macros ?? {};
  const operators = command.operators ?? {};
  if (!isRecord(macros) || !isRecord(operators)) return;
  for (const [name, definition] of Object.entries(macros)) {
    if (!isRecord(definition)) {
      diagnostics.error("INVALID_MACRO", "Macro '" + name + "' must be a mapping.", locationFor(source, file, 0));
      continue;
    }
    if (!Number.isInteger(definition.args) || definition.args < 0 || definition.args > 4) {
      diagnostics.error("INVALID_MACRO_ARGS", "Macro '" + name + "' args must be an integer from 0 to 4.", locationFor(source, file, 0));
    }
    if (definition.redef === true && !BUILTIN_COMMANDS.has(name)) {
      diagnostics.error("INVALID_REDEF", "redef is only valid for an existing built-in command '" + name + "'.", locationFor(source, file, 0));
    }
  }
  for (const [name, definition] of Object.entries(operators)) {
    if (!isRecord(definition)) {
      diagnostics.error("INVALID_OPERATOR", "Operator '" + name + "' must be a mapping.", locationFor(source, file, 0));
      continue;
    }
    if (definition.font !== undefined && !OPERATOR_FONTS.has(String(definition.font))) {
      diagnostics.error("INVALID_OPERATOR_FONT", "Unsupported operator font '" + definition.font + "'.", locationFor(source, file, 0));
    }
    if (definition.redef === true && !BUILTIN_COMMANDS.has(name)) {
      diagnostics.error("INVALID_REDEF", "redef is only valid for an existing built-in command '" + name + "'.", locationFor(source, file, 0));
    }
  }
  for (const name of Object.keys(macros)) {
    if (Object.prototype.hasOwnProperty.call(operators, name)) diagnostics.error("COMMAND_NAME_COLLISION", "Macro and operator '" + name + "' share one command namespace.", locationFor(source, file, 0));
  }
}

function parseFrontmatter(source: string, file: string, diagnostics: Diagnostics): { settings: Record<string, any>; body: string } {
  if (!/^---\r?\n/.test(source)) return { settings: {}, body: source };
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    diagnostics.error("FRONTMATTER", "Frontmatter must be closed by a second --- delimiter.", locationFor(source, file, 0));
    return { settings: {}, body: source };
  }
  const root = parseYaml(match[1], file, diagnostics);
  if (!isRecord(root.mathmd)) {
    diagnostics.error("ROOT_CONFIG", "Frontmatter must contain a mathmd mapping.", locationFor(source, file, 0));
    return { settings: {}, body: source.slice(match[0].length) };
  }
  validateValueShape(root.mathmd, file, match[1], diagnostics, true);
  return { settings: root.mathmd, body: source.slice(match[0].length) };
}

function readImport(importPath: string, rootFile: string, visited: Set<string>, diagnostics: Diagnostics): Record<string, any> {
  if (!path.isAbsolute(importPath) && importPath.split(/[\\\\/]/).includes("..")) {
    diagnostics.error("IMPORT_PARENT_PATH", "Parent directory imports are not allowed.");
    return {};
  }
  const resolved = path.isAbsolute(importPath) ? importPath : path.resolve(path.dirname(rootFile), importPath);
  const canonical = path.resolve(resolved);
  if (visited.has(canonical)) {
    diagnostics.warning("DUPLICATE_IMPORT", "Import '" + importPath + "' was already processed.");
    return {};
  }
  visited.add(canonical);
  if (!fs.existsSync(canonical)) {
    diagnostics.error("IMPORT_NOT_FOUND", "Import file '" + importPath + "' does not exist.");
    return {};
  }
  const source = fs.readFileSync(canonical, "utf8");
  const value = parseYaml(source, canonical, diagnostics);
  if (Object.prototype.hasOwnProperty.call(value, "mathmd") || Object.prototype.hasOwnProperty.call(value, "import")) {
    diagnostics.error("INVALID_IMPORT_SHAPE", "Import files contain mathmd settings directly and cannot import other files.", locationFor(source, canonical, 0));
  }
  validateValueShape(value, canonical, source, diagnostics, false);
  return value;
}

function mergeImported(base: Record<string, any>, next: Record<string, any>, importedMacroNames: Set<string>, importedOperatorNames: Set<string>, diagnostics: Diagnostics): Record<string, any> {
  for (const name of Object.keys(next.command?.macros ?? {})) {
    if (importedMacroNames.has(name)) diagnostics.error("COMMAND_NAME_COLLISION", "Imported macro '" + name + "' is defined more than once.");
    importedMacroNames.add(name);
  }
  for (const name of Object.keys(next.command?.operators ?? {})) {
    if (importedOperatorNames.has(name)) diagnostics.error("COMMAND_NAME_COLLISION", "Imported operator '" + name + "' is defined more than once.");
    importedOperatorNames.add(name);
  }
  return merge(base, next);
}

export function loadConfig(source: string, file: string, diagnostics: Diagnostics): { config: Config; body: string } {
  const frontmatter = parseFrontmatter(source, file, diagnostics);
  const root = frontmatter.settings;
  const visited = new Set<string>();
  const importedMacroNames = new Set<string>();
  const importedOperatorNames = new Set<string>();
  let settings: Record<string, any> = {};
  for (const importPath of root.import ?? []) {
    if (typeof importPath !== "string") diagnostics.error("INVALID_IMPORT", "Import paths must be strings.");
    else settings = mergeImported(settings, readImport(importPath, file, visited, diagnostics), importedMacroNames, importedOperatorNames, diagnostics);
  }
  const local = { ...root };
  delete local.import;
  settings = merge(settings, local);
  const config = merge(DEFAULT_CONFIG, settings);
  normalizeConfig(config);
  return { config, body: frontmatter.body };
}

function normalizeConfig(config: Config): void {
  const language = String(config.meta?.language ?? "en");
  if (!/^en(?:-|$)/i.test(language) && !/^ja(?:-|$)/i.test(language)) config.meta.language = "en";
  else if (/^ja(?:-|$)/i.test(language)) config.meta.language = language;
  else config.meta.language = language;
  const heading = config.layout.heading;
  heading.numberingDepth = heading["numbering-depth"] ?? heading.numberingDepth ?? 3;
  heading.tocDepth = heading["toc-depth"] ?? heading.tocDepth ?? 3;
  heading.toc = heading.toc ?? "Contents";
  heading.formats = {
    h1: heading.h1 ?? "{h1.arabic}.",
    h2: heading.h2 ?? "{h1.arabic}.{h2.arabic}.",
    h3: heading.h3 ?? "{h1.arabic}.{h2.arabic}.{h3.arabic}.",
  };
  config.layout.title.dateFormat = config.layout.title["date-format"] ?? config.layout.title.dateFormat ?? "yyyy-mm-dd";
  config.layout.counter.maxDepth = config.layout.counter.maxDepth ?? config.layout.counter["max-depth"] ?? 3;
}
