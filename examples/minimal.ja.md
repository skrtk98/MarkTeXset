---
mathmd:
  meta:
    language: ja
    title: "MarkTeXset 最小文書"
    author:
      - name: "MarkTeXset"
    date: 2026-01-01
  bibliography:
    - "references.bib"
  layout:
    callouts:
      theorem:
        title: "定理 {theorem.arabic}."
        style: plain
---

# 最小の数学文書 {#intro}

<maketitle />
<maketoc />

この例は定理とラベル付き数式を含む。

> [!theorem] ピタゴラスの定理 {#thm:pythagoras}
> 直角三角形では $a^2+b^2=c^2$ が成り立つ。

$$a^2+b^2=c^2 \label{eq:pythagoras}$$

[この式](#eq:pythagoras)を参照する。脚注も使用できる。[^note]

[^note]: 標準 Markdown の脚注である。

[@knuth1984]

<references />
