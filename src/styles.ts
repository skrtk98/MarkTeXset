import fs from "node:fs";
import path from "node:path";

export interface ExtractedStyles { body: string; global: string[]; scoped: Array<{ id: string; css: string }>; }

function validateCss(css: string, diagnostics: { error: (code: string, message: string) => void }): void {
  if ((css.match(/{/g) ?? []).length !== (css.match(/}/g) ?? []).length) diagnostics.error("CSS_SYNTAX", "CSS braces are unbalanced.");
  if (/@import\b/i.test(css)) diagnostics.error("CSS_IMPORT_FORBIDDEN", "CSS @import is not allowed; use mathmd.style.import.");
}

function safePath(value: string, base: string, diagnostics: { error: (code: string, message: string) => void }): string | undefined {
  if (value.split(/[\\/]/).includes("..") && !path.isAbsolute(value)) {
    diagnostics.error("CSS_PARENT_PATH", "Parent directory CSS paths are not allowed.");
    return undefined;
  }
  const resolved = path.isAbsolute(value) ? value : path.resolve(base, value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    diagnostics.error("CSS_NOT_FOUND", "CSS file '" + value + "' does not exist.");
    return undefined;
  }
  return resolved;
}

function inlineCssAssets(css: string, cssFile: string, diagnostics: { error: (code: string, message: string) => void }): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, _quote: string, source: string) => {
    if (/^(?:data:|https?:|#)/i.test(source)) {
      if (/^https?:/i.test(source)) diagnostics.error("CSS_EXTERNAL_ASSET", "External CSS assets are not allowed.");
      return match;
    }
    const file = safePath(source, path.dirname(cssFile), diagnostics);
    if (!file) return match;
    const mime = path.extname(file).toLowerCase() === ".svg" ? "image/svg+xml" : path.extname(file).toLowerCase() === ".png" ? "image/png" : "application/octet-stream";
    return "url(\"data:" + mime + ";base64," + fs.readFileSync(file).toString("base64") + "\")";
  });
}

export function extractStyleBlocks(source: string, diagnostics: { error: (code: string, message: string) => void }): ExtractedStyles {
  const global: string[] = [];
  const scoped: Array<{ id: string; css: string }> = [];
  let index = 0;
  const body = source.replace(/<style(\s+scoped)?\s*>([\s\S]*?)<\/style\s*>/gi, (_match, scopedFlag: string, css: string) => {
    validateCss(css, diagnostics);
    if (scopedFlag) {
      const id = "style-scope-" + index++;
      scoped.push({ id, css });
      return "MATHMDSTYLE" + id + "TOKEN";
    }
    global.push(css);
    return "";
  });
  return { body, global, scoped };
}

export function loadImportedStyles(config: any, sourceFile: string, diagnostics: { error: (code: string, message: string) => void }): string[] {
  const imports = config.style?.import;
  if (!Array.isArray(imports)) return [];
  const loaded = new Set<string>();
  const css: string[] = [];
  for (const item of imports) {
    if (typeof item !== "string") { diagnostics.error("CSS_IMPORT_CONFIG", "mathmd.style.import entries must be strings."); continue; }
    const file = safePath(item, path.dirname(sourceFile), diagnostics);
    if (!file || loaded.has(file)) continue;
    loaded.add(file);
    const content = fs.readFileSync(file, "utf8");
    validateCss(content, diagnostics);
    css.push(inlineCssAssets(content, file, diagnostics));
  }
  return css;
}

export function renderStyleCss(styles: ExtractedStyles, imported: string[]): string {
  const scoped = styles.scoped.map((item) => "@scope (." + item.id + ") {\n" + item.css + "\n}").join("\n");
  return [...imported, ...styles.global, scoped].filter(Boolean).join("\n");
}

export function applyScopedMarkers(html: string, styles: ExtractedStyles): string {
  for (const item of styles.scoped) {
    const marker = "<div class=\"" + item.id + "\"></div>";
    const next = html.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*(<(?:header|h[1-6]|table|figure|div|nav|p|ul|ol|blockquote|pre|section)\\b[\\s\\S]*?</(?:header|h[1-6]|table|figure|div|nav|p|ul|ol|blockquote|pre|section)>)"));
    if (next) html = html.replace(next[0], "<div class=\"" + item.id + "\">" + next[1] + "</div>");
  }
  return html;
}
