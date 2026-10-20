# TeX baseline

これはMarkTeXsetのコンパイル経路ではなく、活版品質比較専用の補助環境である。

```bash
docker build -t marktexset-baseline baseline
docker run --rm -v "$PWD:/work" marktexset-baseline \
  examples/phase2-comprehensive.md /work/examples/phase2-baseline.pdf en [article|report|book]
```

4 番目の引数は文書クラスで、既定は `article`。英語はそのクラス、日本語は `ltjsarticle`・`ltjsreport`・`ltjsbook` を使用する。見出しには MarkTeXset と同じく番号を付け（`--number-sections`）、`report` と `book` では `#` を章とする（`--top-level-division=chapter`）。比較時の入力、日付、タイムゾーン、Pandoc・TeX Liveのイメージを固定すること。
