# MarkTeXset

[English](README.md)

MarkTeXset は、数学文書向けの Markdown を HTML と PDF に変換するコンパイラである。CommonMark を基礎に、MathJax による数式、定理環境としての Callout、相互参照、Pandoc 互換の引用、ページ制御を追加する。問題は位置付きの機械可読な診断として報告する。

TeX はコンパイル経路には使わない。TeX baseline は組版品質の比較対象としてだけ使う。

## 主な機能

- **数式**：インライン `$...$` とブロック `$$...$$` を MathJax で SVG とアクセシブルな MathML に変換する。複数行数式の番号付け、`\label`・`\ref`・`\eqref`、ユーザー定義マクロ・演算子、`tikzcd` ブロックによる可換図式に対応する。
- **定理環境**：`> [!theorem]` などの Callout。タイトル、カウンター、style（`plain`、`definition`、`remark`、`proof`、カスタムクラス）を設定できる。
- **文書構造**：`article`・`report`・`book` の文書クラス（章、付録、book の前付けと後付け）、番号付き見出し、目次、タイトル、脚注、図、セル結合を含む表。`report` と `book` では図・表・式に章ごとの番号を付け、定理などのカウンターも章ごとにできる。
- **参照と引用**：数式・見出し・Callout の ID は一つの名前空間を共有し、通常の Markdown の fragment link で参照する。`[](#thm:main)` のような空リンクは、参照先の番号を「Theorem 3」「Section 2.1」のように設定した書式で表示する。ローカルの `.bib` からの `[@key]` 引用に対応する。
- **PDF 出力**：Playwright 管理下の Chromium と Vivliostyle で、LaTeX の標準クラス（`article`・`book`・`ltjsarticle`・`ltjsbook`）の版面（余白、文字の大きさ、行送り、見出し、表題、脚注、キャプション、柱）に揃えてページ分割する。新しいページ（book では右ページ）から始まる章、book の見開きの柱とローマ数字の前付け、柱、ページ番号、ページ番号付きの目次、しおり、表題と著者のメタデータ付きのタグ付き PDF、ページ下部の脚注、ページスタイル、改ページ、英文段落の TeX 式最適行分割、TrueType でのフォント埋め込みを扱い、はみ出し・重なり・空白ページを検査する。
- **スタイル**：global / scoped style、ローカル CSS の import、Shiki によるコードハイライト。
- **ライブプレビュー**：保存時に再ビルドし、診断をオーバーレイに表示するローカルサーバー。数式インスペクタを備える。
- **安全な既定値**：生 HTML、JavaScript、iframe、ネットワークアクセスは既定で無効。外部の画像と CSS 資産には HTTPS の明示的な許可リストが必要で、内容ハッシュで検証・キャッシュしたうえで出力に埋め込む。

## 必要環境

- Node.js 22 以降（Node.js 22 と 24 で検証している）
- Playwright 用の Chromium。PDF 出力と Preview のレイアウト検査に使う。

  ```bash
  npx playwright install chromium
  ```

- 既定フォント（Latin Modern Roman・Sans・Mono と原ノ味フォント、約 12MB）。更新後に `fonts status` が未取得のフォントを示したら、`fonts install` を再実行する。初回に一度だけユーザーキャッシュへ取得し、固定した SHA-256 で検証する。

  ```bash
  marktexset fonts install   # または npm start -- fonts install
  marktexset fonts status
  ```

  `fonts install` は各フォントの CFF アウトラインを TrueType に変換する。Chromium は CFF のフォントを PDF に Type 3 として埋め込むためである。未取得の場合、PDF と Preview はシステムフォントで組み、`FONT_NOT_INSTALLED` を警告する。HTML 出力はフォントを埋め込まず、閲覧環境に同じフォントがあればそれを使う。

## はじめに

```bash
npm install
npm run build
npm start -- init article --language ja
npm start -- build article.md
```

`init` は最小限の Frontmatter を持つ `article.md` を作成し、`build` は同じディレクトリに `article.html` を出力する。

リポジトリの外で `marktexset` コマンドを使うには、パッケージにまとめてインストールする。`npm pack` はビルドしてから `marktexset-<version>.tgz` を作る。

```bash
npm pack
npm install --global ./marktexset-0.1.0.tgz
marktexset build article.md --format pdf
```

コンパイラはライブラリとしても使える。

```js
import { compileFile, renderPdf } from "marktexset";

const result = compileFile("article.md");
if (!result.diagnostics.hasErrors) await renderPdf(result, "article.pdf", "article.md");
console.log(result.diagnostics.items);
```

小さな完全な文書の例を示す。

```markdown
---
mathmd:
  meta:
    language: en
    title: "Minimal MarkTeXset document"
  bibliography:
    - "references.bib"
  layout:
    callouts:
      theorem:
        title: "Theorem {theorem.arabic}."
        style: plain
---

<maketitle />

> [!theorem] Pythagorean theorem {#thm:pythagoras}
> For a right triangle, $a^2+b^2=c^2$.

$$a^2+b^2=c^2 \label{eq:pythagoras}$$

See [](#eq:pythagoras) and [@knuth1984].

<references />
```

完全版は [examples/minimal.en.md](examples/minimal.en.md) と [examples/minimal.ja.md](examples/minimal.ja.md) にある。

## 文書クラス

`layout.class` で LaTeX と同じく `article`（既定）、`report`、`book` を選ぶ。`report` と `book` では `#` が章になり、図・表・式には章ごとの番号を付ける（「Figure 2.1」「(2.1)」）。日本語の文書は ltjsreport と ltjsbook に揃える（「第2章」「図 2.1」）。`book` は両面組で、章は右ページから始まり、柱は左ページに章、右ページに節を出す。`<frontmatter />`、`<mainmatter />`、`<backmatter />` で、番号なしでローマ数字のページ番号の前付け、本文、番号なしの後付けを切り替える。`<appendix />` は以降の章（article では節）に A、B、… と番号を付ける。

```markdown
---
mathmd:
  layout:
    class: book
    callouts:
      theorem:
        title: "Theorem {h1.arabic}.{h1 > theorem.arabic}."
---

<maketitle />

<frontmatter />

<maketoc />

# Preface

<mainmatter />

# Introduction

<appendix />

# Proofs
```

`{h1 > theorem.arabic}` のようなスコープ付きのカウンターは、LaTeX の `\numberwithin` と同じく章ごとに 1 に戻る。どのクラスでも使える。

## コマンドライン

呼び出しには必ずサブコマンド `build`、`preview`、`init`、`fonts` のいずれかを指定する。サブコマンドなしの旧形式はサポートしない。

```bash
marktexset build input.md [-o output.html] [--format html|pdf|json] [--force] [--reset-cache]
marktexset preview input.md [--port 3000] [--host 127.0.0.1] [--math-inspector | --no-math-inspector] [--reset-cache]
marktexset init path/to/document [--language en|ja] [--force]
marktexset fonts install [--force] | marktexset fonts status
```

開発中は `npm start -- <サブコマンド> ...` で同じコマンドを実行できる。

### build

- 既定では入力と同じディレクトリに `.html` を出力する。`--format pdf` では `.pdf` を出力する。
- 既存ファイルは `--force` を付けない限り上書きしない。
- `--format json` は診断 JSON だけを stdout に出力し、成果物ファイルは書かない。診断がなければ `{"diagnostics": []}` となる。
- それ以外の形式では、診断を stderr に、成果物を出力ファイルに書く。
- 終了コードは、成功（警告のみを含む）が `0`、文書にエラーがある場合が `1`、コマンドラインの使用方法エラーが `2`。

### preview

```bash
marktexset preview document.md
```

サーバーは `http://127.0.0.1:3000/` で待ち受ける。ブラウザは自動では開かないので、表示された URL を開く。

- Markdown または依存ファイル（import、文献、画像、CSS）を保存すると再ビルドし、接続中のブラウザを WebSocket 経由で更新する。
- ビルドのたびに PDF と共通の Vivliostyle レイアウト検査を行い、はみ出し・重なり・空白ページをオーバーレイに表示する。Preview は PDF を生成しない。
- ビルドに失敗してもサーバーは停止せず、直前の正常なプレビューと診断を表示し続ける。
- 配信するのは生成ページと、文書ディレクトリ内にあり文書が参照するローカル資産だけである。ディレクトリ外を指すシンボリックリンクは配信せず、別オリジンからの WebSocket 接続は拒否する。DNS リバインディング対策として、`Host` ヘッダーが IP アドレス、`localhost`、`--host` の値のいずれでもないリクエストも拒否する。
- `--host` で待受アドレスを変更できる。ループバック以外のアドレスでは、そのアドレスに到達できる端末から文書を閲覧できる旨を警告する。

**数式インスペクタ**は Preview で既定で有効であり、選択した数式のソース位置、元の TeX、描画 DOM、computed style を表示する。Preview 専用の機能で、HTML・PDF の build には何も追加しない。

## 外部リソース

外部の画像と CSS 資産は、ルートの Frontmatter で HTTPS のホスト名を完全一致で許可しない限り拒否する。

```yaml
---
mathmd:
  network:
    allow: true
    domains: ["images.example.org"]
---
```

取得したファイルは SHA-256 でキャッシュし、データ URI として出力に埋め込むので、2 回目以降のビルドはオフラインでも動く。取得し直すには `build` または `preview` に `--reset-cache` を付ける。

## 組版品質

PDF 出力では英文の段落を TeX と同じ Knuth–Plass 法で行分割する。段落を本文の幅で測り、段落全体の悪さ（badness）が最小になる改行位置を選んでからページ分割する。ハイフネーションは TeX の米国英語パターンを使い、改善になる場合だけ行う。行末の句読点とハイフンは microtype と同じく右余白へわずかに突き出す。インライン数式は TeX と同じく最上位の関係演算子・二項演算子の後で改行できるため、長い数式のせいで行の残りが間延びすることはない。和文、表のセル、脚注はブラウザの行分割（禁則処理を含む）のままにする。すべてブラウザの行分割にするには次のように指定する。

```yaml
---
mathmd:
  layout:
    line-break: browser   # 既定値: optimal
---
```

[examples/quality/](examples/quality/) のサンプルは標準 Markdown だけで書いてあり、MarkTeXset と Pandoc が同じように読める。散文のサンプル、図・表・行列・リスト・コード・脚注を含むサンプル、`report` クラスで章立てしたサンプルを英日それぞれに用意している。`npm test` は、これらの PDF にはみ出し行と禁則違反がないこと、和文の行が字間を広げて埋められていないこと、ハイフン付きの行末が 3 行以上続かないこと、ページがほぼ埋まっていること、既定フォントだけが埋め込まれていることを検査する。Pandoc + LuaLaTeX の baseline と並べて比べるには次を実行する。

```bash
docker build -t marktexset-baseline baseline
npm run quality -- --baseline   # quality-report/report.md に出力する
```

## ドキュメント

- 現行仕様は [docs/MathMD_Final_Specification.md](docs/MathMD_Final_Specification.md) に集約している。過去の設計案とレビュー記録は [docs/old/](docs/old/) に保管しており、参考用である。
- 検証レポートは [docs/final-phase-test-report.md](docs/final-phase-test-report.md)、[docs/phase4-test-report.md](docs/phase4-test-report.md)、[docs/phase3.5-test-report.md](docs/phase3.5-test-report.md) にある。Paged.js 固有の環境依存事項は最終フェーズのレポートに記載している。

## サンプル

各 `phaseN-comprehensive.md` は、そのフェーズの機能に加えて、それ以前の全フェーズの要素も含む。

| サンプル | 対象 | 期待診断 |
|---|---|---|
| [phase1.5-comprehensive.md](examples/phase1.5-comprehensive.md) | 基本記法、import、画像、文献 | — |
| [phase2-comprehensive.md](examples/phase2-comprehensive.md) | PDF 出力、改ページ、レイアウト診断 | — |
| [phase3-comprehensive.md](examples/phase3-comprehensive.md) | 引用、言語、図、拡張 Callout | [JSON](examples/phase3-comprehensive.expected.json) |
| [phase3.5-comprehensive.md](examples/phase3.5-comprehensive.md) | 数式インスペクタ | [JSON](examples/phase3.5-comprehensive.expected.json) |
| [phase4-comprehensive.md](examples/phase4-comprehensive.md) | `tikzcd`、TeX 参照、追加数式フォント、安全な属性 | [JSON](examples/phase4-comprehensive.expected.json) |
| [final-phase-comprehensive.md](examples/final-phase-comprehensive.md) | 結合表、CSS 装飾と import、Shiki ハイライト、定理タイトル装飾 | [JSON](examples/final-phase-comprehensive.expected.json) |

## 開発

```bash
npm install
npm run build   # dist/ を消してから TypeScript をコンパイルする
npm test        # テストを実行する
npm run check   # build の後に test を実行する
```

## TeX baseline

[baseline/](baseline/) には、Pandoc と LuaLaTeX で文書を組版し、組版品質を比較するための Docker 環境がある。MarkTeXset のビルド経路ではない。

## ライセンス

MarkTeXset は [GNU Affero General Public License v3.0 以降](LICENSE) で提供する。PDF のページ分割に使う [Vivliostyle](https://vivliostyle.org/) も AGPL-3.0 である。ライセンスが及ぶのは MarkTeXset 自体であり、MarkTeXset で作成した文書や PDF には影響しない。

既定フォントは `marktexset fonts install` で別途取得する。Latin Modern は GUST Font License、原ノ味フォントは SIL Open Font License 1.1 で提供されている。
