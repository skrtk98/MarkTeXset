// @ts-nocheck
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { AssistiveMmlHandler } from "mathjax-full/js/a11y/assistive-mml.js";

const adaptor = liteAdaptor();
AssistiveMmlHandler(RegisterHTMLHandler(adaptor));
const input = new TeX({ packages: AllPackages });
const output = new SVG({ fontCache: "none" });
const document = mathjax.document("", { InputJax: input, OutputJax: output });

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
