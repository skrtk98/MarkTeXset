import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TTF_CONVERTER_VERSION, convertOtfToTtf } from "./ttf.js";

export interface FontFile {
  file: string;
  url: string;
  sha256: string;
  family?: string;
  weight?: number;
  style?: "normal" | "italic";
}

const LM = "https://mirrors.ctan.org/fonts/lm/fonts/opentype/public/lm/";
const HARANO = "https://raw.githubusercontent.com/trueroad/HaranoAjiFonts/20250811/";

// Japanese bold maps to Gothic and Japanese italic stays upright, following LaTeX Japanese typesetting.
export const FONT_FILES: FontFile[] = [
  { file: "lmroman10-regular.otf", url: LM + "lmroman10-regular.otf", sha256: "1aa18cfefa58132c52ce5de70db1fd1154201c19cd2b2cdaffba4906a33e6852", family: "MarkTeXset Serif", weight: 400, style: "normal" },
  { file: "lmroman10-bold.otf", url: LM + "lmroman10-bold.otf", sha256: "102fe06c430a8b681b2bf6876b7cd967ae4d47b4b6b41d915eb7913b726d9fb1", family: "MarkTeXset Serif", weight: 700, style: "normal" },
  { file: "lmroman10-italic.otf", url: LM + "lmroman10-italic.otf", sha256: "c1fce25075567bb8dbf2151658c3b442690041db17a2d49fc9e55905ea5b7169", family: "MarkTeXset Serif", weight: 400, style: "italic" },
  { file: "lmroman10-bolditalic.otf", url: LM + "lmroman10-bolditalic.otf", sha256: "c37a28eed7a6e03f792b98b5e5f637b2fcda378bb4855f99284f1a88fe35f124", family: "MarkTeXset Serif", weight: 700, style: "italic" },
  { file: "lmmono10-regular.otf", url: LM + "lmmono10-regular.otf", sha256: "22deb6d3be3ffcb40b33f0e010afb256c677d97c2a2bdee1f5740cdc97751558", family: "MarkTeXset Mono", weight: 400, style: "normal" },
  { file: "HaranoAjiMincho-Regular.otf", url: HARANO + "HaranoAjiMincho-Regular.otf", sha256: "66ef3270e68690612e8bf982acfad0e8b40212ce64661cce2bb6d3a98ac84717", family: "MarkTeXset Japanese", weight: 400, style: "normal" },
  { file: "HaranoAjiGothic-Medium.otf", url: HARANO + "HaranoAjiGothic-Medium.otf", sha256: "dfde7017fee3063b7148cce0d79b2083be4587f22cf7743f9f097424af39f5b2", family: "MarkTeXset Japanese", weight: 700, style: "normal" },
  { file: "lmsans10-regular.otf", url: LM + "lmsans10-regular.otf", sha256: "d431b786b9b603662718e79cfe9b441f47a8b0b3e854dde89d5acb3ed7cfd682", family: "MarkTeXset Sans", weight: 400, style: "normal" },
  // Optical sizes, chosen by type size as LaTeX's font definitions for Latin Modern do.
  { file: "lmroman12-regular.otf", url: LM + "lmroman12-regular.otf", sha256: "e6be218ae83e61aa8a29990d3cdc401c678c1962188cb9a4a8b6359e4f5e5870", family: "MarkTeXset Serif 12", weight: 400, style: "normal" },
  { file: "lmroman12-bold.otf", url: LM + "lmroman12-bold.otf", sha256: "28c8782ac2b6486958b5dc7610ada7800c53546ff7f36bc65909a876e1cd338e", family: "MarkTeXset Serif 12", weight: 700, style: "normal" },
  { file: "lmroman12-italic.otf", url: LM + "lmroman12-italic.otf", sha256: "ada6b3f451238784e5a5ea75d43efa1eb4329cd75ce65bf047ed2f31b7b5e2f3", family: "MarkTeXset Serif 12", weight: 400, style: "italic" },
  { file: "lmroman17-regular.otf", url: LM + "lmroman17-regular.otf", sha256: "ed048c80fb4b67663b80899b89fe5fba17d7442e1286d61fd08fe5689c6b7c3c", family: "MarkTeXset Serif 17", weight: 400, style: "normal" },
  { file: "lmroman8-regular.otf", url: LM + "lmroman8-regular.otf", sha256: "f73015c3827596586faa380c398501caf9b5bcbb6f40b46af6a51277ca97c9fc", family: "MarkTeXset Serif 8", weight: 400, style: "normal" },
  { file: "lmroman8-bold.otf", url: LM + "lmroman8-bold.otf", sha256: "04d4f633c3da31a169f4c54a7fe8c7e63925b39d030381f8d3eab955f16be7b2", family: "MarkTeXset Serif 8", weight: 700, style: "normal" },
  { file: "lmroman8-italic.otf", url: LM + "lmroman8-italic.otf", sha256: "fb0536b5c3eee5b5622cd827ceb410e6514e36512ebdc51d2cf98a96c06d44e8", family: "MarkTeXset Serif 8", weight: 400, style: "italic" },
  { file: "lmroman7-regular.otf", url: LM + "lmroman7-regular.otf", sha256: "48c4b46ab255eec96588fb992fba1ed6102e53d051da480738a61cc6cdb328c3", family: "MarkTeXset Serif 7", weight: 400, style: "normal" },
  { file: "lmroman6-regular.otf", url: LM + "lmroman6-regular.otf", sha256: "501396c437f76c260b8724265b8495f318a640ee5a4674852ecbb20daf256696", family: "MarkTeXset Serif 6", weight: 400, style: "normal" },
  { file: "lmsans12-regular.otf", url: LM + "lmsans12-regular.otf", sha256: "f87ebdea035a96e8787e2c663cfcc78ce73205d37800eafe7948278e2cc7666a", family: "MarkTeXset Sans 12", weight: 400, style: "normal" },
  { file: "lmsans17-regular.otf", url: LM + "lmsans17-regular.otf", sha256: "f6c395a436e4fa7e88bbf1445e64b9c78ce4effba3668b13cc433077fc71a984", family: "MarkTeXset Sans 17", weight: 400, style: "normal" },
  // The \slshape of LaTeX's running heads. A family of its own, since Chromium takes an oblique face for italic.
  { file: "lmromanslant10-regular.otf", url: LM + "lmromanslant10-regular.otf", sha256: "056ad4d08d2eb58d6b7fd0ac5de3f1fb799f2bb0c16b66c7e6b5bc5b6aef6481", family: "MarkTeXset Serif Slanted", weight: 400, style: "normal" },
];

const fontFile = (file: string): FontFile => FONT_FILES.find((font) => font.file === file)!;
const alias = (file: string, family: string, weight: number, style: FontFile["style"]): FontFile => ({ ...fontFile(file), family, weight, style });

// Japanese italic stays upright, and Japanese headings use Gothic at regular weight, as with jsclasses' \headfont (\gtfamily\sffamily).
// Each optical size takes the nearest design for the styles Latin Modern does not have at that size.
const FONT_ALIASES: FontFile[] = [
  { ...fontFile("HaranoAjiMincho-Regular.otf"), style: "italic" },
  { ...fontFile("HaranoAjiGothic-Medium.otf"), style: "italic" },
  { ...fontFile("HaranoAjiGothic-Medium.otf"), family: "MarkTeXset Japanese Gothic", weight: 400 },
  alias("lmroman10-bolditalic.otf", "MarkTeXset Serif 12", 700, "italic"),
  alias("lmroman12-bold.otf", "MarkTeXset Serif 17", 700, "normal"),
  alias("lmroman12-italic.otf", "MarkTeXset Serif 17", 400, "italic"),
  alias("lmroman10-bolditalic.otf", "MarkTeXset Serif 17", 700, "italic"),
  alias("lmroman10-bolditalic.otf", "MarkTeXset Serif 8", 700, "italic"),
  ...["MarkTeXset Serif 7", "MarkTeXset Serif 6"].flatMap((family) => [
    alias("lmroman8-bold.otf", family, 700, "normal"),
    alias("lmroman8-italic.otf", family, 400, "italic"),
    alias("lmroman10-bolditalic.otf", family, 700, "italic"),
  ]),
];

// LuaTeX-ja's ltjs classes set Japanese at 0.924715 of the type size (13Q at 10pt), so a line of ltjsarticle's measure holds 49 characters.
export const JAPANESE_SCALE = 0.924715;

export const SERIF_STACK = "\"MarkTeXset Serif\", \"Latin Modern Roman\", \"LM Roman 10\", \"MarkTeXset Japanese\", \"Harano Aji Mincho\", serif";
export const HEADING_SANS_STACK = "\"MarkTeXset Sans\", \"Latin Modern Sans\", \"LM Sans 10\", \"MarkTeXset Japanese Gothic\", \"Harano Aji Gothic\", sans-serif";
/** The serif stack for type of the given size in pt, led by the Latin Modern optical size LaTeX would choose. */
export function serifStack(size: number): string {
  const design = size < 6.5 ? 6 : size < 7.5 ? 7 : size < 8.5 ? 8 : size < 11 ? 0 : size < 15 ? 12 : 17;
  return design ? "\"MarkTeXset Serif " + design + "\", " + SERIF_STACK : SERIF_STACK;
}

/** The heading sans stack for type of the given size in pt. */
export function headingSansStack(size: number): string {
  const design = size < 11 ? 0 : size < 15 ? 12 : 17;
  return design ? "\"MarkTeXset Sans " + design + "\", " + HEADING_SANS_STACK : HEADING_SANS_STACK;
}

export const SLANTED_STACK = "\"MarkTeXset Serif Slanted\", \"LM Roman Slanted 10\", " + SERIF_STACK;
export const MONO_STACK = "\"MarkTeXset Mono\", \"Latin Modern Mono\", \"LM Mono 10\", \"MarkTeXset Japanese\", \"Harano Aji Gothic\", monospace";

export function fontDirectory(): string {
  if (process.env.MARKTEXSET_FONT_DIR) return path.resolve(process.env.MARKTEXSET_FONT_DIR);
  const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cache, "marktexset", "fonts");
}

export function installedFontFiles(directory = fontDirectory()): FontFile[] {
  return FONT_FILES.filter((font) => fs.existsSync(path.join(directory, font.file)));
}

export function missingFontFiles(directory = fontDirectory()): FontFile[] {
  return FONT_FILES.filter((font) => !fs.existsSync(path.join(directory, font.file)));
}

/** The TrueType conversion of a CFF font; Chromium embeds it in PDFs as a real font instead of Type 3. */
export function truetypeName(font: FontFile): string {
  return font.file.replace(/\.otf$/, "") + ".v" + TTF_CONVERTER_VERSION + ".ttf";
}

/** The file to serve for a font: its TrueType conversion when present, otherwise the original. */
export function servedFontFile(font: FontFile, directory = fontDirectory()): string {
  return fs.existsSync(path.join(directory, truetypeName(font))) ? truetypeName(font) : font.file;
}

/** Resolves a requested font file name to a path, accepting only manifest fonts and their conversions. */
export function resolveFontRequest(name: string, directory = fontDirectory()): string | undefined {
  const font = FONT_FILES.find((item) => item.file === name || truetypeName(item) === name);
  const file = font && path.join(directory, name);
  return file && fs.existsSync(file) ? file : undefined;
}

/** Builds @font-face rules for the installed fonts; `urlFor` maps a font file name to a URL. */
export function fontFaceCss(urlFor: (file: string) => string, directory = fontDirectory()): string {
  const installed = new Set(installedFontFiles(directory).map((font) => font.file));
  return [...FONT_FILES, ...FONT_ALIASES].filter((font) => font.family && installed.has(font.file)).map((font) => {
    const file = servedFontFile(font, directory);
    return "@font-face { font-family: \"" + font.family + "\"; src: url(\"" + urlFor(file) + "\") format(\"" + (file.endsWith(".ttf") ? "truetype" : "opentype") + "\"); font-weight: " + font.weight + "; font-style: " + font.style + (font.family?.startsWith("MarkTeXset Japanese") ? "; size-adjust: " + JAPANESE_SCALE * 100 + "%" : "") + "; font-display: block; }";
  }).join("\n");
}

function sha256(data: Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

// mirrors.ctan.org redirects each request to a different mirror, and some mirrors fail or lag behind.
const RETRY_DELAYS_MS = [2000, 5000, 10000];

async function download(font: FontFile, fetcher: Fetcher, retryDelays: number[], log: (message: string) => void): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetcher(font.url);
      if (!response.ok) throw new Error("Download failed with HTTP " + response.status + ": " + font.url);
      const data = new Uint8Array(await response.arrayBuffer());
      const actual = sha256(data);
      if (actual !== font.sha256) throw new Error("Checksum mismatch for " + font.file + ": expected " + font.sha256 + ", got " + actual);
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message + (error.cause instanceof Error ? " (" + error.cause.message + ")" : "") : String(error);
      if (attempt >= retryDelays.length) throw new Error(message.includes(font.url) ? message : message + ": " + font.url);
      log("Retrying " + font.file + " after error: " + message);
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
    }
  }
}

/** Downloads missing fonts, verifies each pinned SHA-256, and writes them atomically. */
export async function installFonts(options: { force?: boolean; directory?: string; files?: FontFile[]; fetcher?: Fetcher; log?: (message: string) => void; retryDelays?: number[] } = {}): Promise<void> {
  const directory = options.directory ?? fontDirectory();
  const fetcher = options.fetcher ?? fetch;
  const log = options.log ?? (() => undefined);
  fs.mkdirSync(directory, { recursive: true });
  for (const font of options.files ?? FONT_FILES) {
    const target = path.join(directory, font.file);
    if (!options.force && fs.existsSync(target) && sha256(fs.readFileSync(target)) === font.sha256) { log("Already installed " + font.file); convertFont(font, directory, false, log); continue; }
    log("Downloading " + font.url);
    const data = await download(font, fetcher, options.retryDelays ?? RETRY_DELAYS_MS, log);
    const temporary = target + "." + process.pid + ".tmp";
    fs.writeFileSync(temporary, data);
    fs.renameSync(temporary, target);
    convertFont(font, directory, true, log);
  }
}

function convertFont(font: FontFile, directory: string, force: boolean, log: (message: string) => void): void {
  const source = fs.readFileSync(path.join(directory, font.file));
  const target = path.join(directory, truetypeName(font));
  if (source.toString("latin1", 0, 4) !== "OTTO" || (!force && fs.existsSync(target))) return;
  log("Converting " + font.file + " to TrueType outlines");
  fs.writeFileSync(target + "." + process.pid + ".tmp", convertOtfToTtf(source));
  fs.renameSync(target + "." + process.pid + ".tmp", target);
}

/** Converts installed fonts that have no TrueType version yet, such as caches from before conversion existed. Returns the fonts that failed. */
export function ensureTrueTypeFonts(directory = fontDirectory()): string[] {
  const failed: string[] = [];
  for (const font of installedFontFiles(directory)) {
    try { convertFont(font, directory, false, () => undefined); } catch { failed.push(font.file); }
  }
  return failed;
}
