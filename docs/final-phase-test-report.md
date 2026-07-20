# 最終フェーズ実装・検証レポート

検証日: 2026-07-20 UTC  
対象: `examples/final-phase-comprehensive.md`

## 結論

最終フェーズの実装を追加し、既存フェーズを含む累積サンプルを作成した。`npm test` は37/37件PASS。最終サンプルの意図した診断は、未定義脚注、未知コード言語、未登録引用のwarning 3件で、errorはない。

実装対象は次のとおり。

- `markdown-it-multimd-table` による `colspan` / `rowspan`
- global / scoped CSS、CSS cascade、CSS import、ローカル `url()` のdata URI化
- Callout title のCommonMarkインライン装飾、インライン数式、カウンター展開
- Shikiによる静的コードハイライト、言語alias、ファイル名ヘッダー、未知言語fallback
- Preview限定Copyボタン、PDF非表示、コード空白保持
- CSS構文・親ディレクトリ参照・存在しない資産の診断

## テスト分類

| 分類 | 検証内容 | 結果 |
| --- | --- | --- |
| 正常系 | 結合表、CSS装飾、scoped style、CSS import、Callout title、Shiki、alias、Copy用HTML | PASS |
| 準正常系 | 未知コード言語、未知参照、未定義脚注、未登録引用 | 規定warningでPASS |
| 異常系 | CSS構文不正、`../` CSS、unsafe属性、重複ID、未対応記法 | 規定errorでPASS |
| 既存回帰 | フェーズ1〜4の既存32テスト | PASS |
| Preview | HTTP、診断JSON、再ビルド通知、CopyボタンHTML、PDF非表示CSS | PASS |
| PDF | A4、ページ番号、数式、結合表、コード、Callout、参考文献 | PASS |

## レイアウト検査

```text
npm run build
npm test
npm start -- build examples/final-phase-comprehensive.md --format json
npm start -- build examples/final-phase-comprehensive.md --format pdf -o examples/final-phase-comprehensive.pdf --force
npm start -- preview examples/final-phase-comprehensive.md --port 35002
```

最終PDFはA4・6ページ。全ページをPNG化して目視確認し、数式番号、目次インデント、結合表の罫線、Calloutの背景、コードヘッダー、参考文献、ページ番号を確認した。コードはPreviewで横スクロール可能、PDFではページ幅超過診断の対象となる。

### 既知の環境依存事項

Paged.js 0.4.3は本環境のChromium headlessでchunk処理が完了しないため、既存のフェーズ2仕様に従い5秒で元HTMLへ復元し、ChromiumネイティブA4印刷へフォールバックする。Preview/PDFの出力とraw documentのoverflow/overlap検査は完了しているが、Paged.js固有のchunk境界だけは未保証である。この制約は実装上の未解消事項として記録する。
