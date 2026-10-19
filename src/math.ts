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

export function renderMath(source: string, display: boolean): RenderedMath {
  const stripped = stripLabels(source);
  const node = document.convert(stripped.tex, { display });
  return { html: "<span class=\"math-render\"><span class=\"math-svg\">" + adaptor.outerHTML(node) + "</span></span>", labels: stripped.labels, source };
}

export function renderMultilineMath(source: string): RenderedMath[] {
  return source.split(/\\\\/g).map((row) => row.trim()).filter(Boolean).map((row) => renderMath(row, true));
}
