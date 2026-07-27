# フェーズ3.5実装・検証レポート

対象は `examples/phase3.5-comprehensive.md` であり、フェーズ1、1.5、2、3の要素を累積して含む。

## 検証項目

- PreviewのHTTP配信、WebSocket更新、切断・再接続、レイアウト診断
- 数式のインライン、表示、複数行、Callout内、番号、参照、`\label`、`\ref`、`\eqref`
- `data-mathmd-*` 属性、ソース座標、TeX範囲、SVG/MathML DOM対応、構造化JSONコピー
- マクロ・演算子の分類、定義元、展開後TeX
- Styles / Computed、CSS変数、疑似状態、Shadow DOM隔離、API遅延取得
- source map欠落時の数式全体フォールバック、stale ID、APIの非GET拒否、資産境界
- A4 PDF、ページ番号、改ページ、数式・表・コード・Calloutのoverflow/overlap/空白ページ

## 実行コマンド

```text
npm run check
npm start -- build examples/phase3.5-comprehensive.md --format json
npm start -- build examples/phase3.5-comprehensive.md --format pdf -o /tmp/marktexset-phase3.5.pdf --force
npm start -- preview examples/phase3.5-comprehensive.md --port 35035
```

期待診断は `examples/phase3.5-comprehensive.expected.json` に固定する。未知脚注は意図的な warning であり、error は発生させない。

実測結果は A4・4ページ、診断は `UNRESOLVED_FOOTNOTE` warning 1件、`npm run check` は45/45件PASSである。PDF生成時に `LAYOUT_OVERFLOW`、`LAYOUT_OVERLAP`、`EMPTY_PAGE` は発生しなかった。
