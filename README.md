# MarkTeXset

[日本語](README.ja.md)

MarkTeXset compiles Markdown for mathematical documents into HTML and PDF. It extends CommonMark with MathJax math, theorem-style Callouts, cross-references, Pandoc-style citations, and page control, and reports problems as precise, machine-readable diagnostics.

TeX is never part of the compilation path. A TeX baseline is used only as a reference for typesetting quality.

## Features

- **Math**: inline `$...$` and display `$$...$$` math rendered by MathJax as SVG with accessible MathML, numbered multi-line equations, `\label` / `\ref` / `\eqref`, user-defined macros and operators, and commutative diagrams in `tikzcd` blocks.
- **Theorem environments**: Callouts such as `> [!theorem]` with configurable titles, counters, and styles (`plain`, `definition`, `remark`, `proof`, or a custom class).
- **Document structure**: numbered headings, a table of contents, title blocks, footnotes, figures, and merged-cell tables.
- **References**: one namespace for equation, heading, and Callout IDs, linked with ordinary Markdown fragment links, plus `[@key]` citations from local `.bib` files.
- **PDF output**: pagination with Paged.js in a Playwright-managed Chromium, page styles and page breaks, and checks for overflow, overlap, and blank pages.
- **Styling**: global and scoped styles, local CSS imports, and code highlighting with Shiki.
- **Live preview**: a local server that rebuilds on save, shows diagnostics in an overlay, and includes a math inspector.
- **Safety by default**: raw HTML, JavaScript, iframes, and network access are disabled. External resources need an explicit HTTPS allowlist.

## Requirements

- Node.js (developed and tested with Node.js 24)
- Chromium for Playwright, which PDF output and Preview layout checks need:

  ```bash
  npx playwright install chromium
  ```

## Getting started

```bash
npm install
npm run build
npm start -- init article --language en
npm start -- build article.md
```

`init` creates `article.md` with a minimal Frontmatter. `build` writes `article.html` next to it.

A small complete document looks like this:

```markdown
---
mathmd:
  meta:
    language: en
    title: "Minimal MarkTeXset document"
  bibliography:
    - "references.bib"
  layout:
    callouts:
      theorem:
        title: "Theorem {theorem.arabic}."
        style: plain
---

<maketitle />

> [!theorem] Pythagorean theorem {#thm:pythagoras}
> For a right triangle, $a^2+b^2=c^2$.

$$a^2+b^2=c^2 \label{eq:pythagoras}$$

See [](#eq:pythagoras) and [@knuth1984].

<references />
```

The full versions are [examples/minimal.en.md](examples/minimal.en.md) and [examples/minimal.ja.md](examples/minimal.ja.md).

## Command line

Every invocation names a subcommand: `build`, `preview`, or `init`. The old form without a subcommand is no longer supported.

```bash
marktexset build input.md [-o output.html] [--format html|pdf|json] [--force]
marktexset preview input.md [--port 3000] [--host 127.0.0.1] [--math-inspector | --no-math-inspector]
marktexset init path/to/document [--language en|ja] [--force]
```

During development, run the same commands with `npm start -- <subcommand> ...`.

### build

- By default `build` writes an `.html` file next to the input. With `--format pdf` it writes an `.pdf` file.
- `build` does not overwrite an existing file unless you pass `--force`.
- `--format json` writes only the diagnostics to stdout as JSON and writes no output file. A clean document gives `{"diagnostics": []}`.
- In other formats, diagnostics go to stderr and the result goes to the output file.
- Exit codes: `0` on success, including when there are only warnings. `1` when the document has errors. `2` for command-line usage errors.

### preview

```bash
marktexset preview document.md
```

The server listens on `http://127.0.0.1:3000/`. It does not open a browser for you; open the printed URL yourself.

- When you save the Markdown file or any of its dependencies (imports, bibliographies, images, CSS), Preview rebuilds the document and updates connected browsers over WebSocket.
- Each build runs the same Paged.js layout check as PDF output and shows any overflow, overlap, or blank-page problems in an overlay. Preview never writes a PDF.
- When a build fails, the server keeps running and keeps showing the last good preview together with the diagnostics.
- Preview serves only the generated page and the local assets the document references inside its own directory. Symbolic links that point outside that directory are not served, and WebSocket connections from other origins are rejected.
- Pass `--host` to listen on another address. For any non-loopback address, Preview prints a warning, because any device that can reach that address can read the document.

The **math inspector** (enabled by default in Preview) shows the source position, original TeX, rendered DOM, and computed styles for any formula you select. It works only in Preview and adds nothing to HTML or PDF builds.

## Documentation

- [docs/MathMD_Final_Specification.md](docs/MathMD_Final_Specification.md) is the current specification (in Japanese). Earlier design drafts and review notes are kept in [docs/old/](docs/old/) for reference only.
- Verification reports: [docs/final-phase-test-report.md](docs/final-phase-test-report.md), [docs/phase4-test-report.md](docs/phase4-test-report.md), and [docs/phase3.5-test-report.md](docs/phase3.5-test-report.md). Known Paged.js environment issues are listed in the final-phase report.

## Examples

Each `phaseN-comprehensive.md` sample covers the features of its own phase and every phase before it.

| Sample | Covers | Expected diagnostics |
|---|---|---|
| [phase1.5-comprehensive.md](examples/phase1.5-comprehensive.md) | Core syntax, imports, images, bibliography | — |
| [phase2-comprehensive.md](examples/phase2-comprehensive.md) | PDF output, page breaks, layout diagnostics | — |
| [phase3-comprehensive.md](examples/phase3-comprehensive.md) | Citations, languages, figures, extended Callouts | [JSON](examples/phase3-comprehensive.expected.json) |
| [phase3.5-comprehensive.md](examples/phase3.5-comprehensive.md) | Math inspector | [JSON](examples/phase3.5-comprehensive.expected.json) |
| [phase4-comprehensive.md](examples/phase4-comprehensive.md) | `tikzcd`, TeX references, extra math fonts, safe attributes | [JSON](examples/phase4-comprehensive.expected.json) |
| [final-phase-comprehensive.md](examples/final-phase-comprehensive.md) | Merged tables, CSS styling and imports, Shiki highlighting, theorem title formatting | [JSON](examples/final-phase-comprehensive.expected.json) |

## Development

```bash
npm install
npm run build   # compile TypeScript into dist/
npm test        # run the test suite
npm run check   # build, then test
```

## TeX baseline

[baseline/](baseline/) contains a Docker environment that renders documents with Pandoc and LuaLaTeX for comparing typesetting quality. It is not part of the MarkTeXset build.
