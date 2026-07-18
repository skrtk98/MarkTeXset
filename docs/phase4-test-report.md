# フェーズ4実装・レイアウト検証レポート

検証日: 2026-07-18 UTC  
対象: `examples/phase4-comprehensive.md`（フェーズ1〜4累積）

## 結論

フェーズ4の正常系、準正常系、異常系テストは通過した。累積サンプルの診断は、意図的に含めた未定義脚注と未登録引用の警告2件だけで、エラーはない。

PDFは4ページのA4として生成でき、数式、`tikz-cd`、Callout、目次、図、脚注、参考文献、ページ番号にクリッピングや重なりは確認されなかった。PreviewはHTTP取得、診断JSON、`tikz-cd`・カスタムCalloutのHTML生成を確認した。

## 実行結果

| 区分 | 対象 | 結果 |
| --- | --- | --- |
| 正常系 | CommonMark、数式、複数行揃え、追加フォント、`tikz-cd`、`\\ref`/`\\eqref`、Callout style、属性、図、引用、Preview更新 | PASS |
| 準正常系 | 未登録引用、未定義脚注、未対応言語フォールバック、未解決内部参照 | PASS（規定警告） |
| 異常系 | unsafe HTML属性、重複ID、未知カウンター形式、未対応4スペースコードブロック、閉じていない制御ブロック | PASS（規定エラー） |
| レイアウト | PDFページ数、数式・表・画像・コード・Calloutのoverflow/overlap、空白ページ、Preview診断 | PASS |

実行コマンド:

```text
npm run check
npm start -- build examples/phase4-comprehensive.md --format json
npm start -- build examples/phase4-comprehensive.md --format pdf -o examples/phase4-comprehensive.pdf --force
npm start -- preview examples/phase4-comprehensive.md --port 35001
curl http://127.0.0.1:35001/__marktexset/status
```

`npm run check` は32テスト全件PASS。PDFの `pdfinfo` は `Pages: 4`、`Page size: 595.92 x 842.88 pts (A4)` を返した。PNG化した4ページを目視確認し、端部の切れ、要素の重なり、式番号の欠落、参考文献のbullet混入はなかった。

## 期待診断

サンプルの期待診断は `examples/phase4-comprehensive.expected.json` に固定した。

- `UNRESOLVED_FOOTNOTE`: `[^missing]`
- `MISSING_CITATION`: `[@missing-key]`

いずれもwarningであり、ビルドを失敗させない。`examples/phase4-comprehensive.md` には異常系入力を混在させず、異常系は単体テストで検証する。

## 環境上の補足

この環境のPaged.js 0.4.3はChromium headless上でページchunk生成が完了しないため、5秒で検査を打ち切り、元HTMLを復元してChromiumのネイティブA4印刷へフォールバックする。overflow/overlap検査は復元後のraw documentにも適用している。したがって本レポートのPDF品質判定は完了しているが、Paged.js固有のchunk境界を保証する検証は未実施であり、Paged.jsまたはChromiumの組合せを更新した際に再確認が必要である。
