---
mathmd:
  import:
    - phase1.5-import.yaml
  meta:
    language: en-US
    timezone: UTC
    title: "Final Phase: Practical MathMD"
    author:
      - name: "MarkTeXset"
        affiliation: "Publishing Systems Lab"
        url: "https://example.com/marktexset"
    date: 2026-07-20
  bibliography:
    - phase3-references.bib
  citation:
    style: author-year
    heading:
      text: "References"
      level: 2
  style:
    import:
      - final-phase.css
  code:
    theme: github-light
  layout:
    class: article
    size: A4
    margins: 22mm
    paginate: true
    page:
      number:
        visible: true
        position: bottom-center
        format: "{page.arabic}"
      style: plain
    heading:
      numbered: true
      numbering-depth: 3
      toc-depth: 3
      toc: "Contents"
      h1: "{h1.arabic}."
      h2: "{h1.arabic}.{h2.arabic}."
      h3: "{h1.arabic}.{h2.arabic}.{h3.arabic}."
    counter:
      max-depth: 3
    equation:
      numbered: true
      display: "({equation.arabic})"
      reference: "Equation ({equation.arabic})"
    figure:
      numbered: true
      display: "Figure {figure.arabic}."
      reference: "Figure {figure.arabic}"
    callouts:
      theorem:
        title: "**Theorem {theorem.arabic}.** $x^2+y^2$"
        style: final-theorem
        class: imported-table
      definition:
        title: "Definition {definition.arabic}."
        style: definition
      proof:
        title: "Proof"
        style: proof
  command:
    macros:
      abs:
        args: 1
        body: "\\left|#1\\right|"
    operators:
      rank:
        text: "rank"
        limits: false
---

<style>
.mathmd-table { border-collapse: collapse; }
.mathmd-table th, .mathmd-table td { border: 1px solid #777; padding: .35em .6em; }
.mathmd-table td:nth-child(2) { text-align: center; vertical-align: middle; }
.token-keyword { font-weight: bold; }
</style>

<style scoped>
:scope { margin-block: 1em; }
tbody tr:nth-child(n+2):nth-child(-n+3) td:nth-child(1) { border-top: 3px double #246; }
</style>

<maketitle />
<maketoc />

# CommonMark and document controls {#final-overview .lead role="doc-introduction" data-phase="final"}

This document cumulatively exercises phases 1, 1.5, 2, 3, 4, and the final phase. It includes **bold**, *italic*, ~~strike~~, `inline code`, [a URL](https://example.com), [@knuth1984; @lamport1994], a task list, a definition list, a figure, and a footnote[^defined].

- [ ] pending task
- [x] completed task

Math $mathbf{A} + \mathsf{B} + \mathtt{C} + \abs{x}$ and an inline operator $\operatorname{rank}(A)$.

## Equations, references, and diagrams

$$
a & = b && c & = d \label{eq:final-first} \\
e & = f && g & = h \notag \\
i & = j && k & = l \label{eq:final-second}
$$

The equations are [the first equation](#eq:final-first), [](#eq:final-second), `$\ref{eq:final-first}$`, and `$\eqref{eq:final-first}$`.

```tikzcd
A \arrow[r] & B \\
C \arrow[ur] & D
```

## Tables and CSS cascade

The first table checks `colspan`; the second checks `rowspan` using the standard MultiMarkdown `^^` continuation syntax.

| Group | Value | Note |
| --- | --- | --- |
| A || first |
| B | C | second |

The second table checks row spanning.

| Name | Description |
| --- | --- |
| top | retained |
| ^^ | row-spanned |

MathMD
: A Markdown publishing system.

## Figures and numbering

![Final phase asset](assets/phase1.5.svg){#fig:final-asset}

Figure [](#fig:final-asset) is a local numbered asset. #: Numberless heading

### Background

The lower heading follows the zeroed hierarchy. The missing footnote [^missing] is intentionally diagnostic.

<pagebreak />

# Styled Callouts

> [!theorem] Pythagorean theorem {#final-theorem aria-label="Final theorem" data-kind="styled"}
> The YAML title uses CommonMark emphasis and inline math. The Callout also contains a merged table and code.
>
> | A | B |
> | --- | --- |
> | 1 || 2 |
>
> ```python:examples/example.py
> def square(value):
>     return value * value
> ```
>
> > [!remark]
> > Nested Callout content remains separate.

> [!definition] Absolute value {#final-definition}
> The definition style and configured macro $abs{x}$ are available.

> [!proof]
> This proof has no number and receives an automatic square. 

## Code fence matrix

```typescript:src/example file.ts
export const answer: number = 42;
```

```javascript
const value = "preserve spaces";
```

```:notes.txt
plain text with no language
```

```unknownlang:unknown & file.txt
<not highlighted>
```

## Citations and output controls

Author-year citations render as (Knuth, 1984) and (Lamport and Doe, 1994). The missing key [@missing-key] is intentionally diagnostic. The page-style, page-break, and references controls exercise final output.

<pagestyle name="plain" />
<pagebreak />
<references />

[^defined]: A defined footnote used by the cumulative final-phase sample.
