import opentype, { type PathCommand } from "opentype.js";

// Chromium embeds CFF-flavored OpenType fonts in PDFs as Type 3 fonts. Converting the outlines to
// TrueType lets it embed real CID TrueType fonts instead. Like fontTools' otf2ttf, only the outline
// tables change; cmap, metrics, GSUB, GPOS, and every other table are copied byte for byte.

export const TTF_CONVERTER_VERSION = 1;

type Point = { x: number; y: number; on: boolean };
type Vec = { x: number; y: number };

const TOLERANCE = 1; // font units
const DROPPED_TABLES = new Set(["CFF ", "CFF2", "VORG", "glyf", "loca", "maxp"]);

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function cubicAt(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
}

function quadAt(p0: Vec, c: Vec, p2: Vec, t: number): Vec {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y };
}

// Splits the cubic into n equal-parameter pieces and approximates each with one quadratic,
// increasing n until every piece stays within the tolerance.
function cubicToQuadratics(p0: Vec, p1: Vec, p2: Vec, p3: Vec): Array<{ control: Vec; end: Vec }> {
  for (let n = 1; n <= 16; n++) {
    const pieces: Array<{ control: Vec; end: Vec }> = [];
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const a = cubicAt(p0, p1, p2, p3, t0);
      const d = cubicAt(p0, p1, p2, p3, t1);
      // Control points of the sub-cubic on [t0, t1] via derivatives.
      const h = (t1 - t0) / 3;
      const deriv = (t: number): Vec => {
        const u = 1 - t;
        return { x: 3 * (u * u * (p1.x - p0.x) + 2 * u * t * (p2.x - p1.x) + t * t * (p3.x - p2.x)), y: 3 * (u * u * (p1.y - p0.y) + 2 * u * t * (p2.y - p1.y) + t * t * (p3.y - p2.y)) };
      };
      const da = deriv(t0);
      const dd = deriv(t1);
      const b = { x: a.x + da.x * h, y: a.y + da.y * h };
      const c = { x: d.x - dd.x * h, y: d.y - dd.y * h };
      const control = { x: (3 * (b.x + c.x) - (a.x + d.x)) / 4, y: (3 * (b.y + c.y) - (a.y + d.y)) / 4 };
      for (const t of [0.25, 0.5, 0.75]) {
        const cubic = cubicAt(a, b, c, d, t);
        const quad = quadAt(a, control, d, t);
        if (Math.hypot(cubic.x - quad.x, cubic.y - quad.y) > TOLERANCE) { ok = false; break; }
      }
      pieces.push({ control, end: d });
    }
    if (ok) return pieces;
  }
  // Fall back to straight segments through sampled points for pathological curves.
  return Array.from({ length: 16 }, (_, i) => { const end = cubicAt(p0, p1, p2, p3, (i + 1) / 16); return { control: mid(cubicAt(p0, p1, p2, p3, i / 16), end), end }; });
}

function contoursOf(commands: PathCommand[]): Point[][] {
  const contours: Point[][] = [];
  let current: Point[] = [];
  let start: Vec = { x: 0, y: 0 };
  let last: Vec = { x: 0, y: 0 };
  const close = () => {
    if (current.length > 1) {
      const first = current[0];
      const end = current[current.length - 1];
      if (end.on && Math.round(end.x) === Math.round(first.x) && Math.round(end.y) === Math.round(first.y)) current.pop();
    }
    if (current.length >= 3 || current.some((point) => !point.on)) contours.push(current);
    current = [];
  };
  for (const command of commands) {
    if (command.type === "M") { if (current.length) close(); start = last = { x: command.x!, y: command.y! }; current.push({ ...last, on: true }); }
    else if (command.type === "L") { last = { x: command.x!, y: command.y! }; current.push({ ...last, on: true }); }
    else if (command.type === "Q") { current.push({ x: command.x1!, y: command.y1!, on: false }); last = { x: command.x!, y: command.y! }; current.push({ ...last, on: true }); }
    else if (command.type === "C") {
      for (const piece of cubicToQuadratics(last, { x: command.x1!, y: command.y1! }, { x: command.x2!, y: command.y2! }, { x: command.x!, y: command.y! })) {
        current.push({ ...piece.control, on: false }, { ...piece.end, on: true });
      }
      last = { x: command.x!, y: command.y! };
    } else if (command.type === "Z") { close(); last = start; }
  }
  if (current.length) close();
  // CFF outer contours run counter-clockwise; TrueType expects clockwise.
  return contours.map((contour) => [contour[0], ...contour.slice(1).reverse()]);
}

function encodeGlyph(contours: Point[][]): { data: Buffer; points: number } {
  const points = contours.flat().map((point) => ({ x: Math.round(point.x), y: Math.round(point.y), on: point.on }));
  if (!points.length) return { data: Buffer.alloc(0), points: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const header = Buffer.alloc(10 + contours.length * 2 + 2);
  header.writeInt16BE(contours.length, 0);
  header.writeInt16BE(Math.min(...xs), 2); header.writeInt16BE(Math.min(...ys), 4);
  header.writeInt16BE(Math.max(...xs), 6); header.writeInt16BE(Math.max(...ys), 8);
  let end = -1;
  contours.forEach((contour, index) => { end += contour.length; header.writeUInt16BE(end, 10 + index * 2); });
  header.writeUInt16BE(0, 10 + contours.length * 2); // no instructions
  const flags: number[] = [];
  const xBytes: number[] = [];
  const yBytes: number[] = [];
  let px = 0;
  let py = 0;
  for (const point of points) {
    let flag = point.on ? 1 : 0;
    for (const [delta, short, same, bytes] of [[point.x - px, 0x02, 0x10, xBytes], [point.y - py, 0x04, 0x20, yBytes]] as Array<[number, number, number, number[]]>) {
      if (delta === 0) flag |= same;
      else if (Math.abs(delta) < 256) { flag |= short; if (delta > 0) flag |= same; bytes.push(Math.abs(delta)); }
      else bytes.push((delta >> 8) & 0xff, delta & 0xff);
    }
    flags.push(flag);
    px = point.x; py = point.y;
  }
  const data = Buffer.concat([header, Buffer.from(flags), Buffer.from(xBytes), Buffer.from(yBytes)]);
  return { data, points: points.length };
}

function checksum(data: Buffer): number {
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

function readTables(otf: Buffer): Map<string, Buffer> {
  const tables = new Map<string, Buffer>();
  const count = otf.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    const tag = otf.toString("latin1", record, record + 4);
    const offset = otf.readUInt32BE(record + 8);
    const length = otf.readUInt32BE(record + 12);
    tables.set(tag, Buffer.from(otf.subarray(offset, offset + length)));
  }
  return tables;
}

/** Converts a CFF-flavored OpenType font to a TrueType-flavored one with the same glyph order. */
export function convertOtfToTtf(otf: Buffer): Buffer {
  if (otf.toString("latin1", 0, 4) !== "OTTO") throw new Error("Not a CFF-flavored OpenType font.");
  const tables = readTables(otf);
  const font = opentype.parse(otf.buffer.slice(otf.byteOffset, otf.byteOffset + otf.byteLength) as ArrayBuffer, { lowMemory: true });
  const glyphs: Buffer[] = [];
  let maxPoints = 0;
  let maxContours = 0;
  for (let index = 0; index < font.numGlyphs; index++) {
    const contours = contoursOf(font.glyphs.get(index).path.commands);
    const encoded = encodeGlyph(contours);
    maxPoints = Math.max(maxPoints, encoded.points);
    maxContours = Math.max(maxContours, contours.length);
    glyphs.push(Buffer.concat([encoded.data, Buffer.alloc((4 - (encoded.data.length % 4)) % 4)]));
  }
  const loca = Buffer.alloc((glyphs.length + 1) * 4);
  let offset = 0;
  glyphs.forEach((glyph, index) => { loca.writeUInt32BE(offset, index * 4); offset += glyph.length; });
  loca.writeUInt32BE(offset, glyphs.length * 4);
  const maxp = Buffer.alloc(32);
  maxp.writeUInt32BE(0x00010000, 0);
  maxp.writeUInt16BE(font.numGlyphs, 4);
  maxp.writeUInt16BE(maxPoints, 6);
  maxp.writeUInt16BE(maxContours, 8);
  maxp.writeUInt16BE(2, 14); // maxZones
  const head = Buffer.from(tables.get("head")!);
  head.writeUInt32BE(0, 8); // checkSumAdjustment, recomputed below
  head.writeInt16BE(1, 50); // indexToLocFormat: long offsets
  const output = new Map<string, Buffer>([...tables].filter(([tag]) => !DROPPED_TABLES.has(tag)));
  output.set("head", head).set("glyf", Buffer.concat(glyphs)).set("loca", loca).set("maxp", maxp);
  const tags = [...output.keys()].sort();
  const searchRange = 2 ** Math.floor(Math.log2(tags.length)) * 16;
  const directory = Buffer.alloc(12 + tags.length * 16);
  directory.writeUInt32BE(0x00010000, 0);
  directory.writeUInt16BE(tags.length, 4);
  directory.writeUInt16BE(searchRange, 6);
  directory.writeUInt16BE(Math.floor(Math.log2(tags.length)), 8);
  directory.writeUInt16BE(tags.length * 16 - searchRange, 10);
  const bodies: Buffer[] = [];
  let position = directory.length;
  tags.forEach((tag, index) => {
    const data = output.get(tag)!;
    const record = 12 + index * 16;
    directory.write(tag, record, "latin1");
    directory.writeUInt32BE(checksum(data), record + 4);
    directory.writeUInt32BE(position, record + 8);
    directory.writeUInt32BE(data.length, record + 12);
    const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
    bodies.push(padded);
    position += padded.length;
  });
  const ttf = Buffer.concat([directory, ...bodies]);
  const headOffset = directory.readUInt32BE(12 + tags.indexOf("head") * 16 + 8);
  ttf.writeUInt32BE((0xb1b0afba - checksum(ttf)) >>> 0, headOffset + 8);
  return ttf;
}
