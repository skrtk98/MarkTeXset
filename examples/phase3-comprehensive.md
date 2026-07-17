---
mathmd:
  import:
    - phase1.5-import.yaml
  meta:
    language: en-US
    timezone: UTC
    title: "Phase 3 文書要素とレイアウト"
    author:
      - name: "MarkTeXset"
        affiliation: "Phase 3 Laboratory"
        url: "https://example.com/marktexset"
    date: 2026-03-14
  bibliography:
    - phase3-references.bib
  citation:
    style: author-year
    heading:
      text: "参考文献"
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
      toc: "Contents / 目次"
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

<maketitle />
<maketoc />

# Phase 3 overview

この文書はフェーズ1〜3の累積要素を確認する。引用は [@knuth1984; @lamport1994] とし、図は [](#fig:phase3-asset) で参照する。**太字**、*斜体*、`インラインコード`、[外部リンク](https://example.com)も含む。脚注も確認する[^overview-note]。

~~この文章は取り消し線で表示される。~~

- [ ] 未完了のタスク
- [x] 完了したタスク

- unordered item
- another unordered item

1. ordered item
2. another ordered item

> A normal block quote remains distinct from a Callout.

    indented code block
    x = 1

```markdown
[internal link](#phase3-theorem) uses standard Markdown fragment syntax.
```

## Equations and internal references

Inline math $\frac{a}{b}$, $\sqrt{x}$, $\mathbb{R}$, $\mathcal{F}$, $\mathrm{d}x$, $\operatorname{rank}(A)$, and the configured macro $\abs{x}$ are supported.

$$
a & = b && c & = d \label{eq:phase3-first} \\
e & = f && g & = h \notag \\
i & = j && k & = l \label{eq:phase3-second}
$$

The first equation is [the first equation](#eq:phase3-first), and the second is [](#eq:phase3-second).

#: Numberless section

## Background

The numberless heading does not increment its counter; this lower heading still follows the normal hierarchy.
An unresolved footnote [^missing] is rendered as a red diagnostic without a link.

## Description list

CommonMarkに近い定義リストを確認する。

MathMD
: 数式文書のためのMarkdown処理系。

Phase 3
: 文献、言語、図、定義リスト、Callout拡張を含むフェーズ。

## Figures and references

![Phase 3 sample asset](assets/phase1.5.svg){#fig:phase3-asset}

図 [](#fig:phase3-asset) はローカルSVGを使い、キャプションと番号を持つ。

<pagebreak />

# Rich Callouts

> [!theorem] A theorem with rich contents {#phase3-theorem}
> 表、画像、コード、脚注、入れ子Calloutを同時に扱う。
>
> | Name | Value |
> | --- | ---: |
> | answer | 42 |
>
> ![Callout asset](assets/phase1.5.svg){#fig:callout-asset}
>
> ```text
> code inside a Callout
> ```
>
> Nested note[^callout-note] is available.
>
> > [!remark]
> > Nested Callout with `inline code`.
> >
> > The nested text remains inside the outer environment.
>
> [^callout-note]: This footnote definition is intentionally inside the Callout.

> [!proof]
> The proof Callout also supports inline math $x^2+y^2$ and ends with an automatic square.

> [!definition] Absolute value {#phase3-definition}
> The configured `definition` style and macro $\abs{x}$ are available.

> [!remark] A remark
> The configured `remark` style is also available.

## Citations and final layout

The author-year citations should render as (Knuth, 1984) and (Lamport and Doe, 1994). The missing key [@missing-key] remains visibly diagnosable. URLs in the bibliography are links, and authors are displayed on separate lines.

<pagestyle name="plain" />

<pagebreak />

<references />

[^overview-note]: A defined footnote used by the cumulative phase sample.
