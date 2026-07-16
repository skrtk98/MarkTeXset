# TeX baseline

これはMarkTeXsetのコンパイル経路ではなく、活版品質比較専用の補助環境である。

```bash
docker build -t marktexset-baseline baseline
docker run --rm -v "$PWD:/work" marktexset-baseline \
  examples/phase2-comprehensive.md /work/examples/phase2-baseline.pdf en
```

英語は `article`、日本語は `ltjsarticle` を使用する。比較時の入力、日付、タイムゾーン、Pandoc・TeX Liveのイメージを固定すること。
