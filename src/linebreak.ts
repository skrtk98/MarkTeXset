import { createRequire } from "node:module";
import type { Page } from "playwright";

// Knuth–Plass optimal line breaking for English paragraphs in PDF output. Chromium breaks lines
// greedily; this pass measures the laid-out paragraph, chooses breakpoints that minimize the total
// demerits of the whole paragraph as TeX does, and fixes each line as its own justified block.

const require = createRequire(import.meta.url);
const { hyphenateSync } = require("hyphen/en-us/index.js") as typeof import("hyphen/en-us/index.js");

const LEFT_HYPHEN_MIN = 2;
const RIGHT_HYPHEN_MIN = 3;

/** Allowed hyphenation offsets for each word, using TeX's US English patterns. */
export function hyphenationPoints(words: string[]): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const word of words) {
    if (word.length < LEFT_HYPHEN_MIN + RIGHT_HYPHEN_MIN || !/^[A-Za-z]+$/.test(word)) { result[word] = []; continue; }
    const parts = hyphenateSync(word, { hyphenChar: "|", minWordLength: LEFT_HYPHEN_MIN + RIGHT_HYPHEN_MIN }).split("|");
    const points: number[] = [];
    let offset = 0;
    for (const part of parts.slice(0, -1)) {
      offset += part.length;
      if (offset >= LEFT_HYPHEN_MIN && word.length - offset >= RIGHT_HYPHEN_MIN) points.push(offset);
    }
    result[word] = points;
  }
  return result;
}

// Runs in the browser. Kept as plain JavaScript source so the TypeScript toolchain does not inject helpers.
const BROWSER_SCRIPT = String.raw`
(function () {
  var INF = 10000, LINE_PENALTY = 10, HYPHEN_PENALTY = 50, EX_HYPHEN_PENALTY = 50, DOUBLE_HYPHEN_DEMERITS = 10000, FINAL_HYPHEN_DEMERITS = 5000, ADJ_DEMERITS = 10000;
  var ATOMIC = "svg, img, code, kbd, samp, .math-svg, .mathmd-footnote, .mathmd-footnote-repeat, sup, sub, input";
  // TeX's \relpenalty and \binoppenalty for breaks between the parts of inline math.
  var MATH_PENALTY = { "math-glue-rel": 500, "math-glue-bin": 700 };
  var CJK = /[　-ヿ㐀-鿿＀-￯]/;
  // Share of a line-final character's width that hangs into the right margin, after microtype's defaults.
  var PROTRUSION = { ".": 0.7, ",": 0.5, "-": 0.7, "‐": 0.7, "–": 0.3, "—": 0.2, ":": 0.5, ";": 0.5, "!": 0.2, "?": 0.2, "'": 0.7, "’": 0.7, "\"": 0.5, "”": 0.5, ")": 0.05 };
  var canvas = document.createElement("canvas").getContext("2d");

  function targets() {
    return Array.prototype.filter.call(document.querySelectorAll("p"), function (p) {
      if (p.closest(".mathmd-footnote, td, th, figure, .document-title")) return false;
      var style = getComputedStyle(p);
      if (style.textAlign !== "justify" || style.display !== "block") return false;
      var lang = (p.closest("[lang]") || document.documentElement).getAttribute("lang") || "";
      if (!/^en\b/i.test(lang)) return false;
      if (CJK.test(p.textContent) || p.querySelector("br, div, p, ul, ol, table, pre")) return false;
      return p.textContent.trim().length > 0;
    });
  }

  // Text nodes and atomic inline elements (math, code, footnotes) in document order; atomic contents are skipped.
  function textNodes(p) {
    var nodes = [];
    var walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (node) {
        var atomic = node.parentElement.closest(ATOMIC);
        if (atomic && p.contains(atomic)) return NodeFilter.FILTER_REJECT;
        if (node.nodeType === 1) return node.matches(ATOMIC) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  window.__mathmdCollectWords = function () {
    var words = {};
    targets().forEach(function (p) {
      textNodes(p).forEach(function (node) {
        if (node.nodeType !== 3) return;
        (node.data.match(/[A-Za-z]+/g) || []).forEach(function (word) { words[word] = true; });
      });
    });
    return Object.keys(words);
  };

  function rangeWidth(node, start, end) {
    var range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    var rects = range.getClientRects();
    var width = 0;
    for (var i = 0; i < rects.length; i++) width += rects[i].width;
    return width;
  }

  function fontOf(element) {
    var style = getComputedStyle(element);
    return style.fontStyle + " " + style.fontWeight + " " + style.fontSize + " " + style.fontFamily;
  }

  // TeX's space factors under \\nonfrenchspacing: after a sentence-ending mark the space gets a third more width and
  // three times the stretch, unless the mark follows a capital; colons, semicolons, and commas stretch a little more.
  function spaceFactor(word) {
    var trimmed = word.replace(/[)\]'"’”]+$/, "");
    var mark = trimmed.slice(-1);
    if (/[.?!]/.test(mark)) return /[A-Z]/.test(trimmed.slice(-2, -1)) ? 999 : 3000;
    return { ":": 2000, ";": 1500, ",": 1250 }[mark] || 1000;
  }

  function buildItems(p, hyphenation) {
    var items = [];
    var lastWord = "";
    var footnotes = Array.prototype.slice.call(document.querySelectorAll(".mathmd-footnote"));
    textNodes(p).forEach(function (node) {
      if (node.nodeType === 1) {
        var width = node.getBoundingClientRect().width;
        if (node.matches(".mathmd-footnote")) {
          // The note floats away during pagination; only its call number stays in the line.
          var parent = getComputedStyle(node.parentElement);
          canvas.font = parseFloat(parent.fontSize) * 0.7 + "px " + parent.fontFamily;
          width = canvas.measureText(String(footnotes.indexOf(node) + 1)).width;
        }
        items.push({ type: "box", width: width });
        lastWord = "";
        return;
      }
      canvas.font = fontOf(node.parentElement);
      var space = canvas.measureText(" ").width;
      var hyphenWidth = canvas.measureText("-").width;
      var pattern = /(\s+)|([^\s]+)/g, match;
      while ((match = pattern.exec(node.data))) {
        var start = match.index;
        if (match[1]) {
          var last = items[items.length - 1];
          if (!items.length || last.type === "glue") continue;
          var mathGlue = node.parentElement.classList.contains("math-glue") ? MATH_PENALTY[node.parentElement.classList[1]] || 0 : 0;
          var factor = spaceFactor(lastWord) / 1000;
          var extra = factor >= 2 ? space / 3 : 0;
          items.push({ type: "glue", width: space + extra, stretch: space / 2 * factor, shrink: space / 3 / factor, extra: extra, node: node, start: start, end: start + match[1].length, penalty: mathGlue });
          continue;
        }
        var chunk = match[2];
        lastWord = chunk;
        var breaks = [];
        var letters = /[A-Za-z]+/g, word;
        while ((word = letters.exec(chunk))) (hyphenation[word[0]] || []).forEach(function (offset) { breaks.push({ offset: word.index + offset, explicit: false }); });
        var dashes = /[-–—](?=.)/g, dash;
        while ((dash = dashes.exec(chunk))) breaks.push({ offset: dash.index + 1, explicit: true });
        breaks.sort(function (a, b) { return a.offset - b.offset; });
        var previousWidth = 0;
        breaks.forEach(function (point) {
          var width = rangeWidth(node, start, start + point.offset);
          items.push({ type: "box", width: width - previousWidth });
          var protrude = (point.explicit ? PROTRUSION[chunk[point.offset - 1]] || 0 : PROTRUSION["-"]) * canvas.measureText(point.explicit ? chunk[point.offset - 1] : "-").width;
          items.push({ type: "penalty", width: point.explicit ? 0 : hyphenWidth, penalty: point.explicit ? EX_HYPHEN_PENALTY : HYPHEN_PENALTY, flagged: true, hyphen: !point.explicit, node: node, offset: start + point.offset, protrude: protrude });
          previousWidth = width;
        });
        var lastChar = chunk[chunk.length - 1];
        var protrude = PROTRUSION[lastChar] ? PROTRUSION[lastChar] * canvas.measureText(lastChar).width : 0;
        items.push({ type: "box", width: rangeWidth(node, start, start + chunk.length) - previousWidth, protrude: protrude });
      }
    });
    while (items.length && items[items.length - 1].type === "glue") items.pop();
    items.push({ type: "penalty", width: 0, penalty: INF, flagged: false });
    items.push({ type: "glue", width: 0, stretch: 100000, shrink: 0, finishing: true });
    items.push({ type: "penalty", width: 0, penalty: -INF, flagged: true });
    return items;
  }

  function breakLines(items, lineWidth, tolerance, allowHyphens) {
    var sum = { width: 0, stretch: 0, shrink: 0 };
    var active = [{ position: 0, line: 0, fitness: 1, width: 0, stretch: 0, shrink: 0, demerits: 0, previous: null, ratio: 0, flagged: false }];
    function afterBreak(index) {
      var totals = { width: sum.width, stretch: sum.stretch, shrink: sum.shrink };
      for (var j = index; j < items.length; j++) {
        var item = items[j];
        if (item.type === "box") break;
        if (item.type === "glue") { totals.width += item.width; totals.stretch += item.stretch; totals.shrink += item.shrink; }
        else if (item.penalty === -INF && j > index) break;
      }
      return totals;
    }
    // How far the line ending at break i may hang into the right margin.
    function protrusionAt(index) {
      var item = items[index];
      if (item.type === "penalty") return item.penalty === -INF ? 0 : item.protrude || 0;
      return items[index - 1].protrude || 0;
    }
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var feasible = item.type === "penalty" ? item.penalty < INF && (allowHyphens || !item.hyphen) : item.type === "glue" && i > 0 && items[i - 1].type === "box";
      if (feasible) {
        var candidates = [null, null, null, null];
        for (var a = 0; a < active.length; a++) {
          var node = active[a];
          var length = sum.width - node.width + (item.type === "penalty" ? item.width : 0);
          var target = lineWidth(node.line) + protrusionAt(i);
          var ratio = 0;
          if (length < target) { var stretch = sum.stretch - node.stretch; ratio = stretch > 0 ? (target - length) / stretch : INF; }
          else if (length > target) { var shrink = sum.shrink - node.shrink; ratio = shrink > 0 ? (target - length) / shrink : -INF; }
          if (ratio < -1 || (item.type === "penalty" && item.penalty === -INF)) { active.splice(a, 1); a--; }
          if (ratio >= -1 && ratio <= tolerance) {
            var badness = 100 * Math.pow(Math.abs(ratio), 3);
            var penalty = item.penalty || 0;
            var demerits = penalty >= 0 ? Math.pow(LINE_PENALTY + badness, 2) + penalty * penalty : penalty > -INF ? Math.pow(LINE_PENALTY + badness, 2) - penalty * penalty : Math.pow(LINE_PENALTY + badness, 2);
            var flagged = item.type === "penalty" && item.flagged && item.penalty > -INF;
            if (flagged && node.flagged) demerits += DOUBLE_HYPHEN_DEMERITS;
            if (item.type === "penalty" && item.penalty === -INF && node.flagged) demerits += FINAL_HYPHEN_DEMERITS;
            var fitness = ratio < -0.5 ? 0 : ratio <= 0.5 ? 1 : ratio <= 1 ? 2 : 3;
            if (Math.abs(fitness - node.fitness) > 1) demerits += ADJ_DEMERITS;
            demerits += node.demerits;
            if (!candidates[fitness] || demerits < candidates[fitness].demerits) candidates[fitness] = { node: node, demerits: demerits, ratio: ratio, flagged: flagged };
          }
        }
        var totals = null;
        candidates.forEach(function (candidate, fitness) {
          if (!candidate) return;
          totals = totals || afterBreak(i);
          active.push({ position: i, line: candidate.node.line + 1, fitness: fitness, width: totals.width, stretch: totals.stretch, shrink: totals.shrink, demerits: candidate.demerits, previous: candidate.node, ratio: candidate.ratio, flagged: candidate.flagged });
        });
        if (!active.length) return null;
      }
      if (item.type === "box") sum.width += item.width;
      else if (item.type === "glue") { sum.width += item.width; sum.stretch += item.stretch; sum.shrink += item.shrink; }
    }
    var best = null;
    active.forEach(function (node) { if (node.position === items.length - 1 && (!best || node.demerits < best.demerits)) best = node; });
    if (!best) return null;
    var breaks = [];
    for (var cursor = best; cursor && cursor.previous; cursor = cursor.previous) breaks.unshift({ position: cursor.position, ratio: cursor.ratio, protrude: protrusionAt(cursor.position) });
    return breaks;
  }

  function apply(p, items, breaks) {
    var style = getComputedStyle(p);
    var indent = style.textIndent;
    // Insert markers from the end so earlier text offsets stay valid.
    var markers = [];
    var breakAt = {};
    breaks.slice(0, -1).forEach(function (point) { breakAt[point.position] = true; });
    for (var position = items.length - 1; position >= 0; position--) {
      var item = items[position];
      if (!breakAt[position]) {
        // A widened space keeps its extra width in the justified line.
        if (item.type === "glue" && item.extra) {
          var spaceRange = document.createRange();
          spaceRange.setStart(item.node, item.start);
          spaceRange.setEnd(item.node, item.end);
          var wide = document.createElement("span");
          wide.style.wordSpacing = item.extra.toFixed(3) + "px";
          spaceRange.surroundContents(wide);
        }
        continue;
      }
      var marker = document.createElement("span");
      marker.setAttribute("data-mathmd-line-break", "");
      var range = document.createRange();
      if (item.type === "glue") { range.setStart(item.node, item.start); range.setEnd(item.node, item.end); range.deleteContents(); }
      else { range.setStart(item.node, item.offset); range.collapse(true); }
      range.insertNode(marker);
      if (item.type === "penalty" && item.hyphen) marker.parentNode.insertBefore(document.createTextNode("‐"), marker);
      markers.unshift(marker);
    }
    var fragments = [];
    for (var i = markers.length; i >= 0; i--) {
      var range = document.createRange();
      if (i === 0) range.setStart(p, 0); else range.setStartAfter(markers[i - 1]);
      if (i === markers.length) range.setEnd(p, p.childNodes.length); else range.setEndBefore(markers[i]);
      fragments.unshift(range.extractContents());
    }
    p.textContent = "";
    var glueShrink = {};
    fragments.forEach(function (fragment, index) {
      var line = document.createElement("span");
      line.className = "mathmd-line";
      var ratio = breaks[index].ratio;
      var css = "display:block;white-space:nowrap;text-align:justify;text-align-last:" + (index === fragments.length - 1 ? "start" : "justify") + ";text-indent:" + (index === 0 ? indent : "0") + ";";
      // As in TeX, the last line may shrink too when it was chosen slightly over the measure.
      if (ratio < 0) {
        canvas.font = fontOf(p);
        css += "word-spacing:" + (ratio * canvas.measureText(" ").width / 3).toFixed(3) + "px;";
      }
      if (breaks[index].protrude > 0 && index < fragments.length - 1) css += "margin-right:-" + breaks[index].protrude.toFixed(3) + "px;";
      if (fragments.length >= 4 && index === 0) css += "break-after:avoid;";
      if (fragments.length >= 4 && index === fragments.length - 1) css += "break-before:avoid;";
      if (fragments.length < 4) css += "break-inside:avoid;";
      line.setAttribute("style", css);
      line.appendChild(fragment);
      p.appendChild(line);
    });
    if (fragments.length < 4) p.style.breakInside = "avoid";
    var seen = {};
    Array.prototype.forEach.call(p.querySelectorAll("[id]"), function (element) { if (seen[element.id]) element.removeAttribute("id"); seen[element.id] = true; });
    p.setAttribute("data-mathmd-line-break", "optimal");
  }

  window.__mathmdBreakParagraphs = function (hyphenation) {
    var stats = { optimized: 0, skipped: 0 };
    targets().forEach(function (p) {
      var style = getComputedStyle(p);
      var width = p.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      var indent = parseFloat(style.textIndent) || 0;
      var lineWidth = function (line) { return line === 0 ? width - indent : width; };
      // Measure words on one unbroken line so the browser's own wrapping and hyphenation cannot split them.
      p.style.whiteSpace = "nowrap";
      p.style.hyphens = "manual";
      var items = buildItems(p, hyphenation);
      p.style.whiteSpace = "";
      p.style.hyphens = "";
      var breaks = breakLines(items, lineWidth, 1, false) || breakLines(items, lineWidth, 2, true) || breakLines(items, lineWidth, 10, true);
      if (!breaks) { stats.skipped++; return; }
      apply(p, items, breaks);
      stats.optimized++;
    });
    return stats;
  };
})();
`;

export interface LineBreakStats { optimized: number; skipped: number; }

/** Rewrites the loaded document's English paragraphs with Knuth–Plass line breaks. */
export async function breakParagraphs(page: Page): Promise<LineBreakStats> {
  await page.evaluate((source) => (0, eval)(source), BROWSER_SCRIPT);
  const words = await page.evaluate(() => (window as any).__mathmdCollectWords() as string[]);
  return page.evaluate((hyphenation) => (window as any).__mathmdBreakParagraphs(hyphenation), hyphenationPoints(words));
}
