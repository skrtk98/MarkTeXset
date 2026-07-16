---
mathmd:
  import:
    - phase1.5-import.yaml
  meta:
    language: en
    timezone: UTC
    title: "Phase 2 PDF and layout coverage"
    author:
      - name: "MarkTeXset"
        affiliation: "Example Laboratory"
        url: "https://example.com"
    date: 2026-01-01
  bibliography:
    - references.bib
  citation:
    style: numeric
    heading:
      text: "References"
      level: 2
  layout:
    class: article
    size: A4
    margins:
      top: 20mm
      right: 25mm
      bottom: 20mm
      left: 25mm
    paginate: true
    page:
      number:
        visible: true
        position: bottom-center
        format: "{page.arabic}"
      style: plain
    title:
      date-format: yyyy-mm-dd
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
    callouts:
      theorem:
        title: "Theorem {theorem.arabic}."
        style: plain
      proof:
        title: "Proof"
        style: proof
---

<maketitle />
<maketoc />

# PDF pagination

This document exercises the Phase 2 Chromium PDF path, Paged.js preflight, local assets, page numbers, and the existing CommonMark and MathJax notation. Citation [@knuth1984] and a defined footnote[^phase2-note] are included.

## Page controls

The explicit page break below must begin a new page.

<pagebreak />

<pagestyle name="plain" />

## Tables, images, and code

| Name | Value | Status |
| --- | ---: | --- |
| SVG | local | loaded |
| PDF | A4 | rendered |

![Local SVG asset](assets/phase1.5.svg)

```typescript
export function phaseTwoExample(value: number): number {
  return value * value;
}
```

## Math and Callouts

Inline math $\frac{a}{b} + \sqrt{x}$ is emitted as SVG with assistive MathML. A numbered multiline block follows:

$$
a &= b + c \label{eq:phase-two-first}\\
d &= e + f \notag\\
g &&= h \label{eq:phase-two-second}
$$

The first equation is [the first equation](#eq:phase-two-first), and the second is [](#eq:phase-two-second).

> [!theorem] A paginated theorem {#phase2-theorem}
> A Callout remains together when it fits on a page, and inline math $x^2$ remains accessible.

> [!proof]
> The proof environment receives an automatic square at the end.

## Overflow diagnostic fixture

The following deliberately long line is a layout diagnostic fixture. PDF generation should warn if the code content exceeds the page content width.

```text
This is an intentionally long preformatted line used to verify the phase-two overflow diagnostic: 0123456789 abcdefghijklmnopqrstuvwxyz 0123456789 abcdefghijklmnopqrstuvwxyz 0123456789 abcdefghijklmnopqrstuvwxyz 0123456789 abcdefghijklmnopqrstuvwxyz.
```

<pagestyle name="empty" />
<pagebreak />

# Final page

This final page confirms that a page break at the end is handled without silently dropping content.

[^phase2-note]: The Phase 2 sample uses a fixed date and UTC timezone for reproducible output.

<references />
