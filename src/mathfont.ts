import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import zlib from "node:zlib";
import { convertOtfToTtf } from "./ttf.js";

// MathJax's SVG output draws each glyph of the TeX fonts as a filled path. Viewers rasterize such paths without the
// hinting and smoothing they give text, so formulas look heavier than the surrounding text and than LaTeX's math. In PDF
// output each glyph path is replaced by the same glyph set as text in MathJax's own TeX fonts, embedded as TrueType.

const require = createRequire(import.meta.url);

interface FontModule {
  TeXFont: {
    defaultChars: Record<string, Record<string, [number, number, number, { p?: string; c?: string; f?: string }?]>>;
    defaultVariantLetters: Record<string, string>;
    defaultFonts: Record<string, { "font-family": string; src: string }>;
  };
}

/** A glyph of MathJax's TeX fonts: the font family and the text that selects the glyph in it. */
export interface MathGlyph { family: string; text: string; }

let glyphs: Map<string, MathGlyph> | undefined;
const fonts = new Map<string, Buffer | null>();

function woffDirectory(): string {
  return path.join(path.dirname(require.resolve("mathjax-full/package.json")), "es5", "output", "chtml", "fonts", "woff-v2");
}

/** The WOFF file of each MathJax TeX font family, such as MJXTEX-I → MathJax_Math-Italic.woff. */
function fontFiles(): Map<string, string> {
  const chtml = (require("mathjax-full/js/output/chtml/fonts/tex.js") as FontModule).TeXFont;
  const files = new Map<string, string>();
  for (const face of Object.values(chtml.defaultFonts)) {
    const file = face.src?.match(/\/([^/"]+\.woff)"/)?.[1];
    if (face["font-family"]?.startsWith("MJXTEX") && file) files.set(face["font-family"], file);
  }
  return files;
}

/** Unpacks a WOFF 1.0 file to the OpenType font it wraps. */
export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.toString("latin1", 0, 4) !== "wOFF") throw new Error("Not a WOFF font.");
  const count = woff.readUInt16BE(12);
  const tables: Array<{ tag: string; checksum: number; data: Buffer }> = [];
  for (let i = 0; i < count; i++) {
    const entry = 44 + i * 20;
    const offset = woff.readUInt32BE(entry + 4);
    const compressed = woff.readUInt32BE(entry + 8);
    const length = woff.readUInt32BE(entry + 12);
    const raw = woff.subarray(offset, offset + compressed);
    tables.push({ tag: woff.toString("latin1", entry, entry + 4), checksum: woff.readUInt32BE(entry + 16), data: compressed < length ? zlib.inflateSync(raw) : Buffer.from(raw) });
  }
  const directory = Buffer.alloc(12 + count * 16);
  directory.writeUInt32BE(woff.readUInt32BE(4), 0);
  directory.writeUInt16BE(count, 4);
  const searchRange = 2 ** Math.floor(Math.log2(count)) * 16;
  directory.writeUInt16BE(searchRange, 6);
  directory.writeUInt16BE(Math.floor(Math.log2(count)), 8);
  directory.writeUInt16BE(count * 16 - searchRange, 10);
  const bodies: Buffer[] = [];
  let position = directory.length;
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    directory.write(table.tag, record, "latin1");
    directory.writeUInt32BE(table.checksum, record + 4);
    directory.writeUInt32BE(position, record + 8);
    directory.writeUInt32BE(table.data.length, record + 12);
    const padded = Buffer.concat([table.data, Buffer.alloc((4 - (table.data.length % 4)) % 4)]);
    bodies.push(padded);
    position += padded.length;
  });
  return Buffer.concat([directory, ...bodies]);
}

/** The code points a font maps to glyphs, from its format 4 or 12 cmap subtable. */
export function mappedCodePoints(font: Buffer): Set<number> {
  const count = font.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < count; i++) if (font.toString("latin1", 12 + i * 16, 16 + i * 16) === "cmap") cmap = font.readUInt32BE(12 + i * 16 + 8);
  const points = new Set<number>();
  if (cmap < 0) return points;
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const subtable = cmap + font.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = font.readUInt16BE(subtable);
    if (format === 4) {
      const segments = font.readUInt16BE(subtable + 6) / 2;
      const ends = subtable + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        const end = font.readUInt16BE(ends + s * 2), start = font.readUInt16BE(starts + s * 2);
        const delta = font.readInt16BE(deltas + s * 2), rangeOffset = font.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const glyph = rangeOffset === 0 ? (c + delta) & 0xffff : font.readUInt16BE(ranges + s * 2 + rangeOffset + (c - start) * 2);
          if (glyph !== 0) points.add(c);
        }
      }
    } else if (format === 12) {
      for (let g = 0; g < font.readUInt32BE(subtable + 12); g++) {
        const group = subtable + 16 + g * 12;
        for (let c = font.readUInt32BE(group); c <= font.readUInt32BE(group + 4); c++) points.add(c);
      }
    }
  }
  return points;
}

function sfntOf(family: string): Buffer | undefined {
  const file = fontFiles().get(family);
  return file ? woffToSfnt(fs.readFileSync(path.join(woffDirectory(), file))) : undefined;
}

/** Maps the path data of every glyph in MathJax's SVG TeX font to the same glyph in its CHTML web fonts. */
export function mathGlyphs(): Map<string, MathGlyph> {
  if (glyphs) return glyphs;
  const svg = (require("mathjax-full/js/output/svg/fonts/tex.js") as FontModule).TeXFont;
  const chtml = (require("mathjax-full/js/output/chtml/fonts/tex.js") as FontModule).TeXFont;
  const coverage = new Map<string, Set<number>>();
  const covers = (family: string, text: string) => {
    if (!coverage.has(family)) { const sfnt = sfntOf(family); coverage.set(family, sfnt ? mappedCodePoints(sfnt) : new Set()); }
    return [...text].every((char) => coverage.get(family)!.has(char.codePointAt(0)!));
  };
  glyphs = new Map();
  for (const [variant, chars] of Object.entries(svg.defaultChars)) {
    for (const [code, data] of Object.entries(chars)) {
      // MathJax draws a glyph as the path "M" + p + "Z".
      const outline = data[3]?.p ? "M" + data[3].p + "Z" : undefined;
      if (!outline || glyphs.has(outline)) continue;
      const options = chtml.defaultChars[variant]?.[code]?.[3] ?? {};
      const letter = options.f ?? chtml.defaultVariantLetters[variant];
      const family = letter ? "MJXTEX-" + letter : "MJXTEX";
      // CHTML gives remapped characters as CSS escapes, such as \2192.
      const text = options.c ? options.c.replace(/\\([0-9A-Fa-f]+)/g, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16))) : String.fromCodePoint(Number(code));
      if ([...text].length === 1 && covers(family, text)) glyphs.set(outline, { family, text });
    }
  }
  return glyphs;
}

/** The TrueType conversion of a MathJax TeX font, or undefined for an unknown family. */
export function mathFont(family: string): Buffer | undefined {
  if (!fonts.has(family)) {
    const sfnt = sfntOf(family);
    fonts.set(family, sfnt ? convertOtfToTtf(sfnt) : null);
  }
  return fonts.get(family) ?? undefined;
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Replaces the glyph paths in MathJax SVG markup with text in the TeX fonts; returns the markup and the families used. */
export function mathPathsToText(html: string): { html: string; families: Set<string> } {
  const map = mathGlyphs();
  const families = new Set<string>();
  const replaced = html.replace(/<path data-c="[0-9A-Fa-f]+" d="([^"]*)"( transform="([^"]*)")?\s*(?:\/>|><\/path>)/g, (match, outline: string, _attribute, transform: string | undefined) => {
    const glyph = map.get(outline);
    if (!glyph) return match;
    families.add(glyph.family);
    // Glyph outlines are in font units with y up, inside MathJax's flipped coordinate system. The family is set by a class,
    // since Vivliostyle renames web font families in style sheets but not in SVG attributes.
    return "<text class=\"mathmd-glyph-" + glyph.family + "\" font-size=\"1000\" stroke=\"none\" transform=\"" + (transform ? transform + " " : "") + "scale(1,-1)\">" + escapeText(glyph.text) + "</text>";
  });
  return { html: replaced, families };
}
