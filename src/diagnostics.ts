export type Severity = "error" | "warning";

export interface Position {
  line: number;
  column: number;
}

export interface Location {
  file: string;
  start: Position;
  end: Position;
}

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  location?: Location;
  relatedLocations?: Array<{ file: string; start?: Position; end?: Position }>;
  suggestions?: string[];
}

export class Diagnostics {
  readonly items: Diagnostic[] = [];

  add(item: Diagnostic): void {
    this.items.push(item);
  }

  error(code: string, message: string, location?: Location, extra: Partial<Diagnostic> = {}): void {
    this.add({ severity: "error", code, message, location, ...extra });
  }

  warning(code: string, message: string, location?: Location, extra: Partial<Diagnostic> = {}): void {
    this.add({ severity: "warning", code, message, location, ...extra });
  }

  get hasErrors(): boolean {
    return this.items.some((item) => item.severity === "error");
  }

  sorted(): Diagnostic[] {
    return [...this.items].sort((a, b) => {
      const severity = (value: Severity) => value === "error" ? 0 : 1;
      const bySeverity = severity(a.severity) - severity(b.severity);
      if (bySeverity !== 0) return bySeverity;
      return (a.location?.start.line ?? Number.MAX_SAFE_INTEGER) - (b.location?.start.line ?? Number.MAX_SAFE_INTEGER)
        || (a.location?.start.column ?? 0) - (b.location?.start.column ?? 0);
    });
  }

  toJSON(): { diagnostics: Diagnostic[] } {
    return { diagnostics: this.sorted() };
  }
}

export function positionAt(text: string, offset: number): Position {
  const lines = text.slice(0, Math.max(0, offset)).split("\n");
  return { line: lines.length, column: [...(lines.at(-1) ?? "")].length + 1 };
}

export function locationFor(text: string, file: string, startOffset: number, endOffset = startOffset + 1): Location {
  return {
    file,
    start: positionAt(text, startOffset),
    end: positionAt(text, endOffset),
  };
}

export function formatDiagnosticsText(diagnostics: Diagnostics): string {
  return diagnostics.sorted().map((item) => {
    const location = item.location
      ? item.location.file + ":" + item.location.start.line + ":" + item.location.start.column + " "
      : "";
    const suggestions = item.suggestions?.length
      ? "\n  Did you mean " + item.suggestions.map((value) => "'" + value + "'").join(", ") + "?"
      : "";
    return location + item.severity + " " + item.code + ": " + item.message + suggestions;
  }).join("\n");
}
