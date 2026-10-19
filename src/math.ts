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

/** Renders TeX to SVG. TeX errors, which MathJax would draw as text, are thrown instead. */
export function renderMath(source: string, display: boolean): RenderedMath {
  const stripped = stripLabels(source);
  const node = document.convert(stripped.tex, { display });
  const html = adaptor.outerHTML(node);
  const error = html.match(/data-mjx-error="([^"]*)"/);
  if (error) throw new Error("TeX error in '" + source.trim() + "': " + decodeAttribute(error[1]));
  return { html: "<span class=\"math-render\"><span class=\"math-svg\">" + html + "</span></span>", labels: stripped.labels, source };
}

/** Splits at `\\` or `&` outside braces and \begin...\end environments, so `aligned`, `cases`, and matrices stay whole. */
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
