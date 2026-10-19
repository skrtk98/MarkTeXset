declare module "markdown-it-footnote" {
  const plugin: (md: any) => void;
  export default plugin;
}

declare module "markdown-it-task-lists" {
  const plugin: (md: any, options?: Record<string, unknown>) => void;
  export default plugin;
}

declare module "markdown-it-deflist" {
  const plugin: (md: any) => void;
  export default plugin;
}

declare module "opentype.js" {
  export interface PathCommand { type: "M" | "L" | "C" | "Q" | "Z"; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number; }
  export interface Glyph { path: { commands: PathCommand[] }; }
  export interface Font { numGlyphs: number; glyphs: { get(index: number): Glyph }; }
  const opentype: { parse(buffer: ArrayBuffer, options?: { lowMemory?: boolean }): Font };
  export default opentype;
}

declare module "hyphen/en-us/index.js" {
  export function hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number }): string;
}
