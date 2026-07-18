# MarkTeXset

数学文書向け Markdown コンパイラ。CommonMark を基礎に、MathJax 数式、定理 Callout、引用、ページ制御を扱い、HTML を生成する。

仕様の現行版は [docs/MathMD_Final_Specification.md](docs/MathMD_Final_Specification.md) に集約している。過去の設計案・レビュー記録は [docs/old/](docs/old/) に保管しており、通常の実装判断では参照しない。

## 開発

```bash
npm install
npm run build
npm test
npm run check
```

## CLI

```bash
npm start -- build input.md -o output.html
npm start -- build input.md --format pdf -o output.pdf
npm start -- build input.md --format json
npm start -- preview input.md --port 3000 --host 127.0.0.1
npm start -- init docs/article --language ja
```

`--format json` は診断情報を stdout に出力する。通常の診断は stderr、変換結果は stdout または `-o` で指定したファイルに出力する。

サブコマンドなしの旧形式は使用せず、`build`、`preview`、`init` のいずれかを明示する。

### ローカルプレビュー

```bash
marktexset preview document.md
```

サーバーは `127.0.0.1:3000` で起動する。ブラウザは自動起動しないため、表示されたURLをブラウザで開く。保存すると入力 Markdown と import・文献・ローカル資産を再ビルドし、WebSocket 経由で接続中のブラウザを更新する。

フェーズ2では起動時と保存時に、Playwright 管理下の Chromium と Paged.js を使って PDF と共通のページレイアウト検査も行う。ページ内容のはみ出し・重なり・空白ページを検出した場合は診断オーバーレイに表示し、診断がない場合はオーバーレイを表示しない。Preview は PDF を生成せず、ブラウザ上のプレビューとレイアウト診断だけを行う。

エラーが発生してもサーバーは終了せず、直前の正常プレビューを保持して診断オーバーレイを表示する。`--port` でポート、`--host` で待受アドレスを変更できる。ループバック以外の host を指定すると、LAN上の端末から文書が閲覧可能になる警告を表示する。

## 最小例

動作確認用の完全な最小例は [examples/minimal.en.md](examples/minimal.en.md) と [examples/minimal.ja.md](examples/minimal.ja.md) に同梱している。

フェーズ1.5の記法を網羅した調査用サンプルは [examples/phase1.5-comprehensive.md](examples/phase1.5-comprehensive.md) である。import設定、画像、文献データ、ローカル資産も同じ `examples/` 配下に置いている。

フェーズ2のPDF・レイアウト記法を網羅したサンプルは [examples/phase2-comprehensive.md](examples/phase2-comprehensive.md) である。`build --format pdf` は Playwright 管理下の Chromium でPDFを生成し、Paged.js によるページ分割の事前検査、MathJax の SVG + 支援 MathML、ローカル画像、改ページ、はみ出し・重なり・空白ページ診断を行う。

フェーズ3までの累積機能（フェーズ1、1.5、2、3）を網羅したサンプルは [examples/phase3-comprehensive.md](examples/phase3-comprehensive.md) である。フェーズ4までの累積機能を網羅したサンプルは [examples/phase4-comprehensive.md](examples/phase4-comprehensive.md) で、期待診断は [examples/phase4-comprehensive.expected.json](examples/phase4-comprehensive.expected.json) に置く。各 `phaseN-comprehensive.md` は、そのフェーズ固有の機能だけでなく、それ以前の全フェーズの要素も含める。

TeXとの比較が必要な場合は [baseline/](baseline/) のDocker補助環境を使う。これはMarkTeXsetのビルド経路ではない。

`init` は空本文の初期文書を作成する。

```markdown
---
mathmd:
  meta:
    language: en
    title: "Untitled document"
    author: []
    date: null
---
```

## 実装状況

フェーズ1.5までの基盤に加え、フェーズ2の Playwright/Paged.js PDF出力、MathMLアクセシビリティ、ページ制御、レイアウト診断、フェーズ3の文献・言語・定義リスト・GFM拡張・図・拡張Callout、およびフェーズ4の `tikz-cd`、TeX参照、追加フォント、安全なカスタムCallout style/HTML属性を実装済み。残る表装飾・文書スタイル・コードハイライトは [最終仕様書の実装計画](docs/MathMD_Final_Specification.md#13-実装計画) に従って進める。

TeX は MarkTeXset のコンパイルには使用しない。LuaLaTeX 等は、最終的な活版品質を比較する baseline としてのみ使用する。
