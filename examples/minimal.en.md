---
mathmd:
  meta:
    language: en
    title: "Minimal MarkTeXset document"
    author:
      - name: "MarkTeXset"
    date: 2026-01-01
  bibliography:
    - "references.bib"
  layout:
    callouts:
      theorem:
        title: "Theorem {theorem.arabic}."
        style: plain
---

# A minimal mathematical document {#intro}

<maketitle />
<maketoc />

This example contains a theorem and a labelled equation.

> [!theorem] Pythagorean theorem {#thm:pythagoras}
> For a right triangle, $a^2+b^2=c^2$.

$$a^2+b^2=c^2 \label{eq:pythagoras}$$

See [the equation](#eq:pythagoras). This sentence has a footnote.[^note]

[^note]: The example uses a standard Markdown footnote.

[@knuth1984]

<references />
