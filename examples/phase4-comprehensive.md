---
mathmd:
  import:
    - phase1.5-import.yaml
  meta:
    language: en-US
    timezone: UTC
    title: "Phase 4 Mathematics and Extensions"
    author:
      - name: "MarkTeXset"
        affiliation: "Phase 4 Laboratory"
        url: "https://example.com/marktexset"
    date: 2026-03-14
  bibliography:
    - phase3-references.bib
  citation:
    style: author-year
    heading:
      text: "References"
      level: 2
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
    title:
      date-format: "MMMM d, yyyy"
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
    footnote:
      format: "{footnote.arabic}"
      placement: bottom
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
        title: "Theorem {theorem.arabic}."
        style: custom-theorem
        class: highlighted
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

<maketitle />
<maketoc />

# Phase 4 overview {#phase4-overview .lead role="doc-introduction" data-section="phase4"}

This cumulative sample includes the CommonMark foundation and all Phase 1, 1.5, 2, 3, and 4 features. It cites [@knuth1984; @lamport1994], uses **bold**, *italic*, `inline code`, a [URL](https://example.com), a task list, a definition list, a figure, and a footnote[^overview-note].

- [ ] A pending task
- [x] A completed task

Math $mathbf{v} + \mathsf{A} + \mathtt{code}$ and the configured macro $abs{x}$ use MathJax fonts.

## Equations and TeX references

$$
a & = b && c & = d \label{eq:phase4-first} \\
e & = f && g & = h \notag \\
i & = j && k & = l \label{eq:phase4-second}
$$

The first equation is [the first equation](#eq:phase4-first). In math, `$\ref{eq:phase4-first}$` and `$\eqref{eq:phase4-first}$` are clickable references.

```tikzcd
A \arrow[r] & B \\
C \arrow[ur] & D
```

## Numbering and definition lists

#: Numberless subsection

### Background

The lower heading continues its normal hierarchy after a numberless heading. A missing footnote [^missing] remains a visible diagnostic.

MathMD
: A Markdown-oriented mathematical publishing system.

Phase 4
: Safe math extensions and reusable Callout styles.

## Figure and standard references

![Phase 4 asset](assets/phase1.5.svg){#fig:phase4-asset}

Figure [](#fig:phase4-asset) uses the local SVG asset. Standard Markdown internal links such as [the overview](#phase4-overview) remain available.

<pagebreak />

# Rich Callouts

> [!theorem] A custom-styled theorem {#phase4-theorem aria-label="Theorem content" data-kind="custom"}
> The custom CSS class is added without changing the theorem semantics. Inline math $x^2+y^2$ and a table remain inside the Callout.
>
> | Name | Value |
> | --- | ---: |
> | answer | 42 |
>
> ```text:callout.txt
> code inside a Callout
> ```
>
> > [!remark]
> > Nested Callout with `inline code`.

> [!definition] Absolute value {#phase4-definition}
> The built-in definition style and macro $abs{x}$ are available.

> [!proof]
> The proof Callout ends with an automatic square and is not numbered.

## Citations and final layout

The author-year citations should render as (Knuth, 1984) and (Lamport and Doe, 1994). The missing key [@missing-key] remains visibly diagnosable. Authors in the bibliography are displayed on separate lines.

<pagestyle name="plain" />
<pagebreak />
<references />

[^overview-note]: A defined footnote used by the cumulative phase sample.
