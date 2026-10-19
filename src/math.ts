// @ts-nocheck
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { AssistiveMmlHandler } from "mathjax-full/js/a11y/assistive-mml.js";
import { SafeHandler } from "mathjax-full/js/ui/safe/SafeHandler.js";

const adaptor = liteAdaptor();
SafeHandler(AssistiveMmlHandler(RegisterHTMLHandler(adaptor)));
// \require would load code at runtime; the Safe extension strips unsafe URLs, styles, and IDs.
const input = new TeX({ packages: AllPackages.filter((name) => name !== "require" && name !== "autoload") });
const output = new SVG({ fontCache: "none" });
const document = mathjax.document("", {
  InputJax: input,
  OutputJax: output,
  safeOptions: {
    allow: { URLs: "safe", classes: "safe", cssIDs: "none", styles: "safe" },
    safeProtocols: { http: true, https: true, file: false, javascript: false, data: false },
  },
});

/** Whether MathJax's configured TeX input defines the control sequence `\name`. */
export function isMathJaxCommand(name: string): boolean {
  const handlers = input.parseOptions.handlers;
  return handlers.get("macro").contains(name) || handlers.get("delimiter").contains("\\" + name);
}

function stripLabels(source: string): { tex: string; labels: string[] } {
  const labels: string[] = [];
  const tex = source.replace(/\\label\{([^}]+)\}/g, (_match, label: string) => {
    labels.push(label);
    return "";
  }).replace(/\\notag\b/g, "");
  return { tex, labels };
}

export interface RenderedMath {
  html: string;
  labels: string[];
  source?: string;
}

function decodeAttribute(value: string): string {
  return value.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function convert(source: string, tex: string, display: boolean): string {
  const html = adaptor.outerHTML(document.convert(tex, { display }));
  const error = html.match(/data-mjx-error="([^"]*)"/);
  if (error) throw new Error("TeX error in '" + source.trim() + "': " + decodeAttribute(error[1]));
  return html;
}

/** Renders TeX to SVG. TeX errors, which MathJax would draw as text, are thrown instead. */
export function renderMath(source: string, display: boolean): RenderedMath {
  const stripped = stripLabels(source);
  return { html: "<span class=\"math-render\"><span class=\"math-svg\">" + convert(source, stripped.tex, display) + "</span></span>", labels: stripped.labels, source };
}

const RELATIONS = new Set(["=", "<", ">", "\\le", "\\leq", "\\ge", "\\geq", "\\ne", "\\neq", "\\leqslant", "\\geqslant", "\\ll", "\\gg", "\\to", "\\rightarrow", "\\leftarrow", "\\longrightarrow", "\\Rightarrow", "\\Leftarrow", "\\Leftrightarrow", "\\iff", "\\implies", "\\mapsto", "\\in", "\\notin", "\\ni", "\\subset", "\\subseteq", "\\supset", "\\supseteq", "\\approx", "\\equiv", "\\sim", "\\simeq", "\\cong", "\\propto", "\\coloneqq"]);
const BINARY = new Set(["+", "-", "\\pm", "\\mp", "\\times", "\\cdot", "\\cup", "\\cap", "\\oplus", "\\otimes", "\\circ", "\\setminus", "\\wedge", "\\vee"]);
const OPENERS = new Set(["(", "[", "\\{", "\\lbrace", "\\langle", "\\lfloor", "\\lceil", "\\lvert", "\\lVert", "\\left", "\\begin"]);
const CLOSERS = new Set([")", "]", "\\}", "\\rbrace", "\\rangle", "\\rfloor", "\\rceil", "\\rvert", "\\rVert", "\\right", "\\end"]);
// Bars open and close with the same symbol.
const BARS = new Set(["|", "\\|", "\\vert", "\\Vert"]);
// Commands whose effect reaches past their own group; splitting would change the formula.
const UNSPLITTABLE = /\\(?:over|atop|choose|above|brace|brack|displaystyle|textstyle|scriptstyle|scriptscriptstyle|color|rm|bf|it|sf|tt|cal|mit|frak|Bbb|bold|not)(?![A-Za-z])|\\\\|&/;

export interface InlineMathPart { tex: string; after?: "rel" | "bin"; }

/**
 * Splits inline math after top-level relations and binary operators, where TeX may break a line
 * (\relpenalty, \binoppenalty). Each part but the last ends with its operator; the space after it is left to the caller.
 */
export function inlineMathParts(tex: string): InlineMathPart[] {
  if (UNSPLITTABLE.test(tex)) return [{ tex }];
  const tokens = tex.match(/\\[A-Za-z]+|\\.|\s+|[\s\S]/g) ?? [];
  const significant = tokens.map((token, index) => ({ token, index })).filter((item) => !/^\s+$/.test(item.token));
  const parts: InlineMathPart[] = [];
  let depth = 0;
  let start = 0;
  const openBars = new Set<string>();
  significant.forEach(({ token, index }, position) => {
    const previous = significant[position - 1]?.token;
    const next = significant[position + 1]?.token;
    if (token === "{" || OPENERS.has(token)) { depth++; return; }
    if (token === "}" || CLOSERS.has(token)) { depth = Math.max(0, depth - 1); return; }
    if (BARS.has(token)) {
      const name = token === "\\vert" ? "|" : token === "\\Vert" ? "\\|" : token;
      if (openBars.delete(name)) depth = Math.max(0, depth - 1);
      else { openBars.add(name); depth++; }
      return;
    }
    const kind = RELATIONS.has(token) ? "rel" : BINARY.has(token) ? "bin" : undefined;
    if (!kind || depth > 0 || previous === undefined || next === undefined) return;
    // A unary sign, an operator carrying scripts, or a run of operators is not a break point.
    if (RELATIONS.has(previous) || BINARY.has(previous) || previous === "^" || previous === "_" || previous === ",") return;
    if (next === "^" || next === "_" || RELATIONS.has(next) || (kind === "bin" && BINARY.has(next))) return;
    const left = tokens.slice(start, index).join("");
    parts.push({ tex: left + "\\mkern" + (kind === "rel" ? 5 : 4) + "mu\\mathord{" + token + "}", after: kind });
    start = index + 1;
  });
  parts.push({ tex: tokens.slice(start).join("") });
  return parts;
}

/**
 * Renders inline math as one SVG per breakable part, joined by spaces sized like TeX's thick and medium math spaces.
 * The whole formula is rendered too, to report TeX errors and to keep one MathML copy for assistive technology.
 */
export function renderInlineMath(source: string): RenderedMath {
  const stripped = stripLabels(source);
  const whole = convert(source, stripped.tex, false);
  const parts = inlineMathParts(stripped.tex);
  const wrap = (inner: string) => ({ html: "<span class=\"math-render\">" + inner + "</span>", labels: stripped.labels, source });
  if (parts.length < 2) return wrap("<span class=\"math-svg\">" + whole + "</span>");
  const assistive = /<mjx-assistive-mml[\s\S]*<\/mjx-assistive-mml>/;
  try {
    const pieces = parts.map((part, index) => {
      const svg = convert(source, part.tex, false).replace(assistive, index === 0 ? whole.match(assistive)?.[0] ?? "" : "");
      return "<span class=\"math-svg\">" + svg + "</span>" + (part.after ? "<span class=\"math-glue math-glue-" + part.after + "\"> </span>" : "");
    });
    return wrap(pieces.join(""));
  } catch {
    return wrap("<span class=\"math-svg\">" + whole + "</span>");
  }
}

/** Splits at `\\` or `&` outside braces and \begin...\end environments, so `cases` and matrices stay whole. */
export function splitTopLevel(source: string, separator: "\\\\" | "&"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      if (source[i + 1] === "\\") {
        if (separator === "\\\\" && depth === 0) { parts.push(source.slice(start, i)); start = i + 2; }
        i++;
        continue;
      }
      const name = source.slice(i + 1).match(/^[A-Za-z]+/)?.[0];
      if (name === "begin") depth++;
      else if (name === "end") depth--;
      i += name ? name.length : 1;
    } else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === "&" && separator === "&" && depth === 0) { parts.push(source.slice(start, i)); start = i + 1; }
  }
  parts.push(source.slice(start));
  return parts;
}

/** Splits display math into rows at top-level `\\`, collecting each row's labels; rows are rendered by the caller. */
export function renderMultilineMath(source: string): RenderedMath[] {
  return splitTopLevel(source, "\\\\").map((row) => row.trim()).filter(Boolean).map((row) => ({ html: "", labels: stripLabels(row).labels, source: row }));
}
