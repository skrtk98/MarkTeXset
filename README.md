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
npm start -- input.md -o output.html
npm start -- input.md --format json
npm start -- preview input.md --port 3000 --host 127.0.0.1
```

`--format json` は診断情報を stdout に出力する。通常の診断は stderr、変換結果は stdout または `-o` で指定したファイルに出力する。

### ローカルプレビュー

```bash
marktexset preview document.md
```

サーバーは `127.0.0.1:3000` で起動する。ブラウザは自動起動しないため、表示されたURLをブラウザで開く。保存すると入力 Markdown と import・文献・ローカル資産を再ビルドし、WebSocket 経由で接続中のブラウザを更新する。

エラーが発生してもサーバーは終了せず、直前の正常プレビューを保持して診断オーバーレイを表示する。`--port` でポート、`--host` で待受アドレスを変更できる。ループバック以外の host を指定すると、LAN上の端末から文書が閲覧可能になる警告を表示する。

## 最小例

```markdown
---
mathmd:
  meta:
    language: ja
  layout:
    callouts:
      theorem:
        title: "定理 {theorem.arabic}."
        style: plain
---

# 数学文書

ピタゴラスの定理を示す。

> [!theorem] ピタゴラスの定理
> $$a^2+b^2=c^2$$

<maketoc />
```

## 実装状況

フェーズ1の npm・TypeScript 基盤、設定読み込み、Markdown/MathJax、基本見出し、Callout、診断、CLI、最小テストを実装済み。ローカルプレビューはフェーズ1拡張として仕様を確定し、実装計画に追加した。PDF・レイアウト検証、文献・言語拡張、数学拡張は [最終仕様書の実装計画](docs/MathMD_Final_Specification.md#11-実装計画) に従って進める。

TeX は MarkTeXset のコンパイルには使用しない。LuaLaTeX 等は、最終的な活版品質を比較する baseline としてのみ使用する。
