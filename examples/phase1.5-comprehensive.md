---
mathmd:
  import:
    - phase1.5-import.yaml
  meta:
    language: en
    timezone: UTC
    title: "Phase 1.5 notation coverage"
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
      h1: "{h1.arabic}."
      h2: "{h1.arabic}.{h2.arabic}."
      h3: "{h1.arabic}.{h2.arabic}.{h3.arabic}."
    counter:
      max-depth: 3
    footnote:
      format: "{footnote.arabic}"
      placement: bottom
    equation:
      numbered: false
      display: "({equation.arabic})"
      reference: "Equation ({equation.arabic})"
    callouts:
      theorem:
        title: "Theorem {theorem.arabic}."
        style: plain
      definition:
        title: "Definition {definition.arabic}."
        style: definition
      remark:
        title: "Remark {remark.arabic}."
        style: remark
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

<!-- This is a user comment, not a control directive. -->

<maketitle />
<maketoc />

# Basic Markdown {#basic .lead}

This paragraph contains **strong**, *emphasis*, `inline code`, a [link](https://example.com), an unordered list, and a footnote.[^basic]

- first item
- second item

1. ordered item
2. another item

> A normal block quote.

---

## Tables and code

| left | center | right |
| :--- | :----: | ----: |
| one | two | three |

```text
fenced code block
$x$ is intentionally code here
```

    indented code block

![A local SVG image](assets/phase1.5.svg)

## Callout environments

> [!theorem] Pythagorean theorem {#thm:pythagoras}
> Inline math inside a Callout: $a^2+b^2=c^2$.
>
> A block formula also works:
>
> $$a^2+b^2=c^2$$

> [!definition] Absolute value {#def:absolute}
> The macro `\abs{x}` represents $\abs{x}$.

> [!remark] A remark
> This is a remark-style environment.

> [!proof]
> The proof contains inline math $x=x$ and receives an automatic square.

## Equations and references

Inline $\frac{a}{b}$, $\sqrt{x}$, $\mathbb{R}$, $\mathcal{F}$, $\mathrm{d}x$, and $\operatorname{rank}(A)$ are supported.

$$
a & = b + c \\
d && = e + f \\
g & = h \label{eq:aligned}
$$

The explicit reference is [the aligned equation](#eq:aligned), while this is an automatic reference: [](#eq:aligned).

```markdown
The fragment link form is used for internal references: [text](#id).
```

## Numberless headings and footnotes

#: Numberless section

## Background

The numberless heading above does not increment its counter. A missing footnote is shown as [^missing].[^basic]

[@knuth1984; @missing-key]

<pagebreak />
<pagestyle name="empty" />
<references />

[^basic]: A defined footnote used by this comprehensive sample.
