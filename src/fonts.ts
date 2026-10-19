import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

/** Builds @font-face rules for the installed fonts; `urlFor` maps a font file name to a URL. */
export function fontFaceCss(urlFor: (file: string) => string, directory = fontDirectory()): string {
  const installed = new Set(installedFontFiles(directory).map((font) => font.file));
  return [...FONT_FILES, ...ITALIC_ALIASES].filter((font) => font.family && installed.has(font.file)).map((font) =>
    "@font-face { font-family: \"" + font.family + "\"; src: url(\"" + urlFor(font.file) + "\") format(\"opentype\"); font-weight: " + font.weight + "; font-style: " + font.style + "; font-display: block; }",
  ).join("\n");
}

function sha256(data: Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Downloads missing fonts, verifies each pinned SHA-256, and writes them atomically. */
export async function installFonts(options: { force?: boolean; directory?: string; files?: FontFile[]; fetcher?: Fetcher; log?: (message: string) => void } = {}): Promise<void> {
  const directory = options.directory ?? fontDirectory();
  const fetcher = options.fetcher ?? fetch;
  const log = options.log ?? (() => undefined);
  fs.mkdirSync(directory, { recursive: true });
  for (const font of options.files ?? FONT_FILES) {
    const target = path.join(directory, font.file);
    if (!options.force && fs.existsSync(target) && sha256(fs.readFileSync(target)) === font.sha256) { log("Already installed " + font.file); continue; }
    log("Downloading " + font.url);
    const response = await fetcher(font.url);
    if (!response.ok) throw new Error("Download failed with HTTP " + response.status + ": " + font.url);
    const data = new Uint8Array(await response.arrayBuffer());
    const actual = sha256(data);
    if (actual !== font.sha256) throw new Error("Checksum mismatch for " + font.file + ": expected " + font.sha256 + ", got " + actual);
    const temporary = target + "." + process.pid + ".tmp";
    fs.writeFileSync(temporary, data);
    fs.renameSync(temporary, target);
  }
}
