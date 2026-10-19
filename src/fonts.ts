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
];

const ITALIC_ALIASES: FontFile[] = [
  { ...FONT_FILES[5], style: "italic" },
  { ...FONT_FILES[6], style: "italic" },
];

export const SERIF_STACK = "\"MarkTeXset Serif\", \"Latin Modern Roman\", \"LM Roman 10\", \"MarkTeXset Japanese\", \"Harano Aji Mincho\", serif";
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
  return [...FONT_FILES, ...ITALIC_ALIASES].filter((font) => font.family && installed.has(font.file)).map((font) => {
    const file = servedFontFile(font, directory);
    return "@font-face { font-family: \"" + font.family + "\"; src: url(\"" + urlFor(file) + "\") format(\"" + (file.endsWith(".ttf") ? "truetype" : "opentype") + "\"); font-weight: " + font.weight + "; font-style: " + font.style + "; font-display: block; }";
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
