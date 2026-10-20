import MarkdownIt from "markdown-it";
import { formatCounter, type Config } from "./config.js";

export type StructureDirective = "appendix" | "frontmatter" | "mainmatter" | "backmatter";

export type OutlineEvent =
  | { line: number; kind: "heading"; level: number; unnumbered: boolean }
  | { line: number; kind: "directive"; name: StructureDirective };

export const STRUCTURE_DIRECTIVES = new Set<string>(["appendix", "frontmatter", "mainmatter", "backmatter"]);

const parser = new MarkdownIt({ html: false });

/**
 * Lists the top-level headings and structure directives of Markdown text by line.
 * `directive` recognizes a paragraph that stands for a directive, such as a placeholder token.
 */
export function markdownOutline(markdown: string, directive: (paragraph: string) => StructureDirective | undefined = () => undefined): OutlineEvent[] {
  const events: OutlineEvent[] = [];
  const tokens = parser.parse(markdown, {});
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.level !== 0 || !token.map) continue;
    const content = tokens[index + 1]?.type === "inline" ? tokens[index + 1].content.trim() : "";
    if (token.type === "heading_open") {
      events.push({ line: token.map[0], kind: "heading", level: Number(token.tag.slice(1)), unnumbered: content.startsWith("MATHMDNONUM ") });
    } else if (token.type === "paragraph_open") {
      // `#: Title` is not an ATX heading for markdown-it; the preprocessor turns it into an unnumbered one.
      const unnumbered = content.match(/^(#{1,6}):\s/);
      const name = content.match(/^<([a-z]+)\s*\/>$/)?.[1];
      if (unnumbered) events.push({ line: token.map[0], kind: "heading", level: unnumbered[1].length, unnumbered: true });
      else if (name && STRUCTURE_DIRECTIVES.has(name)) events.push({ line: token.map[0], kind: "directive", name: name as StructureDirective });
      else {
        const named = directive(content);
        if (named) events.push({ line: token.map[0], kind: "directive", name: named });
      }
    }
  }
  return events;
}

/** Lists the headings and structure directives of generated HTML, using the character offset as the position. */
export function htmlOutline(html: string): OutlineEvent[] {
  const events: OutlineEvent[] = [];
  for (const match of html.matchAll(/<h([1-6])((?:\s[^>]*)?)>(MATHMDNONUM )?|<div class="mathmd-directive mathmd-([a-z]+)"><\/div>/g)) {
    if (match[1]) {
      if (!match[2].includes("document-title-heading") && !match[2].includes("data-mathmd-nested")) events.push({ line: match.index, kind: "heading", level: Number(match[1]), unnumbered: Boolean(match[3]) });
    } else if (STRUCTURE_DIRECTIVES.has(match[4])) events.push({ line: match.index, kind: "directive", name: match[4] as StructureDirective });
  }
  return events;
}

/**
 * Replays the document structure up to a position so counters can be numbered relative to headings.
 * A counter whose numbering template is scoped, as in `{h1 > figure.arabic}`, restarts whenever a heading
 * at that level or above is numbered, like LaTeX's \numberwithin.
 */
export class Outline {
  readonly headings = [0, 0, 0, 0, 0, 0, 0];
  appendix = false;
  matter: "front" | "main" | "back" = "main";
  private readonly counters = new Map<string, number>();
  private readonly scopes = new Map<string, number>();
  private next = 0;

  constructor(private readonly config: Config, private readonly events: OutlineEvent[] = []) {}

  /** Copies the heading state, without events or counters, for text rendered inside an element. */
  snapshot(): Outline {
    const copy = new Outline(this.config);
    copy.headings.splice(0, 7, ...this.headings);
    copy.appendix = this.appendix;
    copy.matter = this.matter;
    return copy;
  }

  /** Applies every event before `position`. */
  advanceTo(position: number): void {
    while (this.next < this.events.length && this.events[this.next].line < position) this.apply(this.events[this.next++]);
  }

  /** Whether a heading at this level is numbered at the current position. */
  numbers(level: number, unnumbered: boolean): boolean {
    const heading = this.config.layout.heading;
    if (unnumbered || !heading.numbered || level > Number(heading.numberingDepth ?? 3)) return false;
    // \frontmatter and \backmatter chapters are unnumbered.
    return !(level === 1 && this.config.layout.class === "book" && this.matter !== "main");
  }

  apply(event: OutlineEvent): void {
    if (event.kind === "directive") {
      // Only the first <appendix /> counts, as with LaTeX's \appendix.
      if (event.name === "appendix") { if (!this.appendix) this.headings.fill(0); this.appendix = true; }
      else {
        this.matter = event.name === "frontmatter" ? "front" : event.name === "mainmatter" ? "main" : "back";
        // Headings under unnumbered front and back matter chapters count from chapter 0.
        if (this.matter !== "main" && this.config.layout.class === "book") this.headings.fill(0);
      }
      return;
    }
    if (!this.numbers(event.level, event.unnumbered)) return;
    this.headings[event.level]++;
    for (let level = event.level + 1; level <= 6; level++) this.headings[level] = 0;
    for (const [name, scope] of this.scopes) if (scope >= event.level) this.counters.set(name, 0);
  }

  /** Steps a counter numbered by `template` and returns its new value. */
  step(name: string, template: string): number {
    const scope = scopeLevel(template, name);
    if (scope) this.scopes.set(name, scope);
    const value = (this.counters.get(name) ?? 0) + 1;
    this.counters.set(name, value);
    return value;
  }

  value(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  /** Prints a heading counter. Appendix chapters (or sections in an article) are lettered, as with LaTeX's \appendix. */
  heading(level: number, format: string): string {
    return formatCounter(this.headings[level] || 0, level === 1 && this.appendix ? "Alph" : format);
  }

  /** Expands `{name.format}`, `{h1.format}`, and scoped `{h1 > name.format}` placeholders. */
  format(template: string, name: string, value: number): string {
    return template.replace(/\{([^{}]+)\}/g, (match, expression: string) => {
      const [counter, format] = (expression.split(">").at(-1) ?? "").trim().split(".");
      if (counter === name && format) return formatCounter(value, format);
      const level = counter?.match(/^h([1-6])$/)?.[1];
      return level && format ? this.heading(Number(level), format) : "";
    });
  }
}

/** The heading level a template scopes `name` by, as in `{h1 > name.arabic}`. */
function scopeLevel(template: string, name: string): number | undefined {
  for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
    const parts = match[1].split(">").map((part) => part.trim());
    if (parts.length < 2 || parts.at(-1)?.split(".")[0] !== name) continue;
    const level = parts.at(-2)?.match(/^h([1-6])$/)?.[1];
    if (level) return Number(level);
  }
  return undefined;
}
