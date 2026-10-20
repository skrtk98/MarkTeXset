# MarkTeXset 最終仕様書・実装計画

**状態:** 確定版  
**対象:** フェーズ1から最終フェーズまで  
**更新日:** 2026-07-26

この文書を MarkTeXset の唯一の現行仕様書とする。`docs/old/` 配下は過去の設計・レビュー記録であり、仕様判断の根拠として参照しない。

## 1. 目的と基本方針

MarkTeXset は、数学文書向け Markdown を HTML と PDF に変換する npm パッケージである。入力は CommonMark を基本とし、MathJax による数式、Callout による定理環境、Pandoc 互換引用、ページ制御を追加する。

TeX は MarkTeXset のコンパイルには使用しない。活版品質の比較対象としてのみ、言語別の TeX baseline を使用する。

品質保証の最低基準は、Pandoc の Markdown→TeX で得られる TeX 相当の組版品質とする。日本語では日本語組版品質も受け入れ対象とする。

## 2. 入出力と CLI

```text
marktexset preview <input.md> [options]
marktexset build <input.md> [options]
marktexset init <path> [options]
```

- 入力 Markdown は UTF-8。
- `preview` はローカル開発サーバー、`build` は成果物生成、`init` は初期 Markdown 作成を行う。
- `build` のフェーズ1出力は HTML のみ。フェーズ2では `--format pdf` を追加し、既定の出力拡張子を `.pdf` とする。
- `build` の通常の診断は stderr、成果物は `-o/--output` で指定したファイルへ出力する。
- `--format json` は診断 JSON を stdout に出力する。診断がない場合も `{"diagnostics":[]}` とする。
- 終了コードは成功・警告のみ `0`、入力仕様エラー `1`、CLI 使用方法エラー `2`。
- エラーがある場合、可能な限り全エラーを収集し、HTML/PDF は生成しない。

### 2.1 build

```text
marktexset build <input.md> [-o output.html] [--format html|json] [--force]
```

- 入力拡張子は小文字の `.md` のみ許可する。
- `--format` はフェーズ1では `html` のみ。未指定時も `html`。
- `-o/--output` 未指定時は入力と同じディレクトリに、拡張子だけを `.html` に変更して出力する。
- 出力先の親ディレクトリは自動作成しない。存在しない場合は CLI エラーとする。
- 既存ファイルは既定で上書きしない。`--force` 指定時だけ上書きする。
- エラー時は出力ファイルを生成・更新せず、既存ファイルも変更しない。
- 旧形式の `marktexset input.md` は廃止し、サブコマンドなしの呼び出しは終了コード2とする。

### 2.2 init

```text
marktexset init <path> [--language en|ja] [--force]
```

- `<path>` は生成する Markdown ファイルのパス。拡張子省略時は `.md` を補う。
- 拡張子を明示した場合は `.md` 以外をエラーとする。
- 親ディレクトリは自動作成しない。存在しない場合はエラーとする。
- 対象ファイルが存在する場合、既定では変更せずエラー。`--force` 指定時だけ初期テンプレートで上書きする。
- `--language` はフェーズ1では `en` と `ja` のみ。未指定時は `en`、不正値はファイルを作成せず終了コード2とする。
- 初期ファイルは次の最小ヘッダーだけを持ち、本文は空にする。

```yaml
---
mathmd:
  meta:
    language: en
    title: "Untitled document"
    author: []
    date: null
---
```

`--language ja` の title は `無題の文書` とする。初期テンプレートは既定値をすべて展開せず、未指定項目は仕様の既定値に委ねる。

リポジトリには動作確認用として `examples/minimal.en.md` と `examples/minimal.ja.md` を同梱する。これらは YAML ヘッダー、見出し、Callout、数式、脚注、目次、参考文献を含む最小例であり、`init` が生成する空本文テンプレートとは異なる。

### 2.1 ローカルプレビュー

Qiita CLI / Qiita Preview と Slidev の開発サーバーの使用感に合わせ、次のコマンドを提供する。

```text
marktexset preview <input.md> [options]

-p, --port <number>   既定値 3000
    --host <address>  既定値 127.0.0.1
```

- ブラウザは自動起動しない。利用者が `http://127.0.0.1:3000/` を開く。
- `--port` は整数 `1–65535`。指定ポートが使用中なら空きポートへ移動せず、エラー終了する。
- `--host` は有効な IPv4、IPv6、ホスト名を受け付ける。不正なオプション値は終了コード2。
- 既定 host は `127.0.0.1`。ループバック以外を指定した場合、アクセス可能な端末から文書が閲覧できる旨を stderr に警告する。
- 起動時に `Preview server running at http://<host>:<port>/`、入力ファイル、監視対象を表示する。Ctrl-C（SIGINT）と SIGTERM で監視・HTTP・WebSocket を正常終了する。
- ログは画面をクリアせず、起動、ビルド、診断、接続、終了を時系列で stderr に追記する。
- プレビューは HTML レンダラーを使う。PDF は生成せず、別の PDF コマンドで扱う。

#### URL と配信範囲

- `/` は入力 Markdown の現在のプレビューを返す。
- `/__marktexset/*` は内部 API と WebSocket の予約領域とする。
- HTML とライブリロードクライアントは `Cache-Control: no-store`。画像・CSS・フォント等の静的資産は通常のキャッシュを許可する。
- 配信対象は生成 HTML と依存グラフに登録されたローカル資産だけとする。プロジェクト内の任意ファイル、`..`、ルート外へ出るシンボリックリンク、未登録ファイルは配信しない。
- 開発用の同一オリジン接続を前提とし、フェーズ1では認証トークンを要求しない。LAN 公開時の閲覧範囲は `--host` 指定者の責任とする。

#### 監視・再ビルド

- 入力 Markdown、import YAML、`.bib`、設定上参照するローカル画像・CSS・フォントなど、依存グラフに登録されたファイルを監視する。
- 変更イベントは 100ms 程度 debounce して一度に処理する。
- ビルド中に追加変更があった場合、現在のビルドを完了させ、最後に検知した状態で一度だけ再ビルドする。
- 正常ビルドは新しい HTML と revision を公開し、警告があっても公開する。
- エラー時もサーバーは継続する。直前の正常プレビューを保持し、初回からエラーの場合はエラー専用画面を返す。

#### ブラウザ更新

- WebSocket を使用し、複数ブラウザ接続を許可する。同一プレビュー URL の全クライアントへイベントをブロードキャストする。
- WebSocket は HTML を送信せず、状態イベントだけを JSON で送る。
- `reload` 受信時、ブラウザは `GET /` で最新 HTML を取得し、文書全体を再描画する。スクロール位置は可能な限り維持する。
- プレビュー時だけライブリロードクライアントを HTML に注入し、通常の HTML/PDF 出力には注入しない。
- `diagnostics` 受信時は error/warning を全件表示するオーバーレイを更新する。severity、code、message、ファイル、行列、コードフレームを表示し、エラーと警告を色分けして閉じるボタンを備える。
- 成功時はプレビューを更新し、警告時も表示を止めない。エラー時は直前の正常表示を保持し、オーバーレイだけを表示する。
- WebSocket 切断時は自動再接続し、「Preview server disconnected」を表示する。再接続後は現在状態を取得し、必要なら再描画する。
- 最低限次のイベント型を定義する。

```json
{"type":"status","state":"building|ready|error","revision":12}
{"type":"reload","revision":12}
{"type":"diagnostics","revision":12,"diagnostics":[]}
```

### 2.2 Preview 数式インスペクタ

Preview では、ブラウザの開発者ツール Elements に近い読み取り専用の数式インスペクタを提供する。ツールバーのトグルで有効化し、ON の間は数式へのホバーで候補をハイライト、クリックで選択を確定する。既定では機能を有効にするが、パネルは閉じて起動する。CLI の `--math-inspector` / `--no-math-inspector` は YAML より優先し、`--no-math-inspector` または `enabled: false` の場合はインスペクタ属性、ソースマップ、専用 API を生成しない。

```yaml
mathmd:
  preview:
    math-inspector:
      enabled: true
      open: false
      panel: right
      source: true
      tex: true
      dom: true
      styles: true
      computed: true
      diagnostics: true
      pseudo-states: true
```

`mathmd.preview.math-inspector` は上記項目を持つ map とする。不正値はエラー、未知キーは警告して無視する。`open: true` はパネルだけを開き、数式は自動選択しない。画面幅が狭い場合は右パネルを下部ドロワーへ切り替え、選択対象へ自動スクロールする。複数タブは選択・パネル状態を共有せず、状態は同一 Preview セッション内だけ保持する。

対象はインライン数式、独立数式、複数行数式、Callout・表・脚注内の数式とする。数式ブロックと各行はそれぞれ選択でき、数式番号・番号表示領域・参照リンクも独立した選択対象とする。参照リンクを選択した場合は対象数式を選択し、参照元、参照先、表示文字列を表示する。

選択時は通常のレイアウトを変更せず、枠線・半透明背景・スクロール追従オーバーレイで描画結果をハイライトする。DOM ツリーと Preview の選択は双方向に同期し、文書階層から Callout 等の親要素、数式ブロック、行、SVG/MathML 要素までのパンくずを表示する。選択は原則一つとし、親子要素はパンくずで移動する。Tab、Enter、Space、Escape によるキーボード操作にも対応する。

パネルは `Source`、`TeX`、`DOM`、`Styles`、`Computed`、`Diagnostics` で構成する。初期状態では `Source`、`TeX`、`Diagnostics` を展開し、他は折りたたむ。パネルには次を表示する。

- 入力された元 TeX、ファイル名、1 始まりの行・列、ブロック種別、`\label`、番号状態、適用設定。
- 元 TeX のシンタックスハイライト。コマンド・引数・文字・空白を区別し、コマンドのホバーで対応する描画要素をハイライトする。
- 生成された SVG と MathML の DOM ツリー。非表示の MathML も選択でき、両形式の対応要素を切り替えても選択を維持する。
- class、適用 CSS、computed style。`Styles` と `Computed` を分け、プロパティ検索、分類、継承元、無効な宣言、セレクタ、宣言元を表示する。CSS の出典は相対パス・行・列・`@import` 元とし、組み込み CSS、ユーザー CSS、ブラウザ既定スタイルを区別する。
- CSS 疑似クラスの現在状態、強制した一時状態、CSS 変数の使用箇所・解決値・継承元・フォールバック。
- SVG/MathML 要素と元 TeX の対応範囲。`\frac` のように一つのコマンドが複数要素を生成する場合は全要素を、複数範囲に由来する要素は全範囲を対応付ける。対応不能時は近い親子要素へフォールバックし「近似対応」と表示する。
- ユーザー定義マクロ・演算子の元コマンド、展開後 TeX、定義元。組み込み、ユーザー定義、`redef: true` による再定義済みを区別する。未知コマンドは診断し、認識範囲を通常対応、未知部分を近似対応とする。

DOM 要素には次の安定した公開属性を付与する。ID は明示的な `\label` を別名として併用し、未指定時はファイル相対パス・種別・ソース情報から決定的に生成する。編集前後は内容ハッシュ等で可能な限り同じ ID と選択状態を維持する。

```text
data-mathmd-math-id
data-mathmd-math-kind
data-mathmd-source-start
data-mathmd-source-end
data-mathmd-row-id
```

フェーズ3.5-1では上記に加え、元TeX、`\label`、番号状態、適用設定を保持する `data-mathmd-tex`、`data-mathmd-label`、`data-mathmd-numbered`、`data-mathmd-settings` と、キーボード選択用の `tabindex="0"` を付与する。これらの属性は Preview 専用で、build HTML と PDF には出力しない。

`kind` は少なくとも `inline`、`display`、`multiline`、`callout`、`table`、`footnote`、`number`、`reference` を区別する。ソース範囲は `[start, end)` の半開区間、行・列は Unicode code point の 1 始まりとする。TeX のコピーは選択範囲を原文のまま、DOM・CSS 情報は表示中のフィルタを反映した構造化 JSON としてコピーする。

インスペクタの詳細情報は HTML に最小限の属性だけを付与し、同一 Preview サーバーのバージョン付き専用 API から遅延取得する。API は `/__marktexset/*` 配下に置き、`GET /__marktexset/inspector/:mathId` と `GET /__marktexset/source?...` を提供する。レスポンスには `schemaVersion` を含める。API は同一オリジンかつワークスペース内に限定し、ソースは対象数式の前後の必要範囲だけを返して絶対パス・環境変数を露出しない。

API・WebSocket障害時も本文を表示し、パネルに接続状態・失敗理由・再試行操作を表示する。更新で選択 ID が消えた場合は選択を解除し、その旨を表示する。ソースマップを生成できない数式は表示を継続し、数式全体を選択単位として「詳細対応なし」と表示する。Preview 本体はブラウザ非対応時も表示し、ツールバーに理由を示す。インスペクタ用メタデータは Preview の HTML にだけ出力し、build HTML と PDF には出力しない。

## 3. 設定と import

ルート Markdown の先頭には、任意で一つだけ YAML Frontmatter を置ける。

```yaml
---
mathmd:
  meta:
    language: ja
---
```

Frontmatter がない場合は既定値を使う。import は入力 Markdown のディレクトリを基準とし、絶対パスも許可する。ただし `..` による親ディレクトリ参照は禁止する。存在しない import はエラー、同一ファイルの重複 import は一度だけ読み、後続を警告する。

import ファイルは Frontmatter も `mathmd` ラッパーも持たない YAML マップで、設定内容だけを記述する。再帰 import、未知キー、YAML の重複キーはエラーとする。

通常の設定値は後勝ち、`bibliography` と `network.domains` は指定順に追加マージする。import 間のマクロ・演算子名衝突はエラーとし、ルート設定からの上書きだけを許可する。ユーザー定義マクロ・演算子同士の衝突は常にエラー。

## 4. フェーズ1の既定値

```yaml
mathmd:
  meta:
    language: en
    timezone: UTC
    title: "Untitled document"
    author: []
    date: null
  citation:
    style: numeric
    heading:
      text: References
      level: 2
  layout:
    class: article
    size: A4
    margins: 25mm
    paginate: true
    page:
      number:
        visible: true
        position: bottom-center
        format: "{page.arabic}"
      style: plain
    line-break: optimal
    title:
      date-format: yyyy-mm-dd
    heading:
      numbered: true
      numbering-depth: 3
      toc-depth: 3
      toc: Contents
      h1: "{h1.arabic}."
      h2: "{h1.arabic}.{h2.arabic}."
      h3: "{h1.arabic}.{h2.arabic}.{h3.arabic}."
  preview:
    math-inspector:
      enabled: true
      open: false
      panel: right
      source: true
      tex: true
      dom: true
      styles: true
      computed: true
      diagnostics: true
      pseudo-states: true
    counter:
      max-depth: 3
    footnote:
      format: "{footnote.arabic}"
      placement: bottom
    equation:
      numbered: false
      display: "({equation.arabic})"
      reference: "({equation.arabic})"
    figure:
      numbered: true
      display: "Figure {figure.arabic}."
      reference: "Figure {figure.arabic}"
    table:
      numbered: true
      display: "Table {table.arabic}."
      reference: "Table {table.arabic}"
```

`meta.language: ja` の文書では、明示されていない生成文字列の既定値を ltjsarticle に揃える。目次見出しは「目次」、文献見出しは「参考文献」、図は `図 {figure.arabic}`、表は `表 {table.arabic}`、式の参照は `式 ({equation.arabic})` とする。設定で明示した値はこの既定値より優先する。

`language` は `en|ja`、`class` は `article|report|book`、`size` は `A4` のみ許可する。日付の既定値は指定タイムゾーンのシステム時刻、既定タイムゾーンは UTC。余白は mm、cm、in、pt の非負値で、上下左右を個別指定する map も許可する。ゼロは許可する。

### 文書クラス

`layout.class` は LaTeX の文書クラスに対応し、既定は `article`。`report` と `book` は章立ての文書で、`#` を章（`\chapter`）、`##` を節、`###` を小節とする。日本語の文書では ltjsreport / ltjsbook に揃える。両クラスでは明示されていない次の値の既定を変える。

| 設定 | `article` | `report` / `book`（英語） | `report` / `book`（日本語） |
|---|---|---|---|
| `layout.heading.h1` | `{h1.arabic}.` | `Chapter {h1.arabic}` | `第{h1.arabic}章` |
| `layout.heading.h2` / `h3` | `{h1.arabic}.{h2.arabic}.` など | 同左 | 同左 |
| `layout.heading.appendix` | `layout.heading.h1` と同じ | `Appendix {h1.arabic}` | `付録{h1.arabic}` |
| `layout.figure.display` | `Figure {figure.arabic}.` | `Figure {h1.arabic}.{h1 > figure.arabic}.` | `図 {h1.arabic}.{h1 > figure.arabic}` |
| `layout.table.display` | `Table {table.arabic}.` | `Table {h1.arabic}.{h1 > table.arabic}.` | `表 {h1.arabic}.{h1 > table.arabic}` |
| `layout.equation.display` | `({equation.arabic})` | `({h1.arabic}.{h1 > equation.arabic})` | 同左 |
| `citation.heading` | `References` / level 2 | `Bibliography` / level 1 | `参考文献` / level 1 |
| `layout.page.style` | `plain` | `report` は `plain`、`book` は `headings` | 同左 |

図・表・式の `reference` も `display` と同じく章番号付きになる（日本語の式は `式 ({h1.arabic}.{h1 > equation.arabic})`）。章見出しは章番号の行と題目の行に分けて表示する。目次の章の項目は、英語では LaTeX と同じく番号だけ（`1 Introduction`、付録は `A Proofs`）、日本語では `第1章 序論` とする。PDF では次のように組む。

- 章は新しいページから始める。`book` は両面組で、章は右ページ（奇数ページ）から始め、必要なら直前に空白の左ページを入れる。空白ページには柱もページ番号も出さず、空白ページの診断の対象にもしない。
- `<maketitle />` の表題は独立したページに組み（`book` では裏も空白にする）、表題ページにはページ番号を出さない。次のページからページ番号を 1 に戻す。目次も新しいページ（`book` では右ページ）から始める。
- `book` の `headings` は見開きの柱とする。左ページは左上にページ番号、右上に章を、右ページは左上に節、右上にページ番号を出し、下のページ番号は出さない。章の最初のページと目次の最初のページは LaTeX の `\chapter` と同じく `plain` とする。`layout.margins` に `left` と `right` を指定した場合、`left` をのど側、`right` を小口側とし、左ページでは左右を入れ替える。
- 見出しの大きさは章 2.488em（`\Huge`）、章番号 2.074em（`\huge`）、節 1.44em、小節 1.2em とする。

`book` では次の制御要素で前付け・本文・後付けを切り替える。前付けと後付けの章には番号を付けない（下位の見出しは章番号を 0 として番号を付ける）。前付けのページ番号は小文字のローマ数字とし、`<mainmatter />` のページから算用数字の 1 に戻す。目次のページ番号も同じ形式で表示する。`report` と `article` でこれらを使うとエラー `BOOK_ONLY_DIRECTIVE` とする。

```html
<frontmatter />
<mainmatter />
<backmatter />
```

`<appendix />` はすべてのクラスで使え、LaTeX の `\appendix` と同じく、以降の最上位の見出し（`article` では節、`report` / `book` では章）の番号を 1 に戻してアルファベット（`A`、`B`、…）にする。最上位の見出しの番号には `layout.heading.appendix` の書式を使い、下位の見出しや図・表・式の `{h1.*}` も `A` のように表示する。2 つ目以降の `<appendix />` は警告 `DUPLICATE_APPENDIX` とし、無視する。これらの構造の制御要素は文書の最上位でだけ働き、Callout の中に書いた場合は警告 `NESTED_STRUCTURE_DIRECTIVE` とし、文字列のまま表示する。

## 5. Markdown と専用要素

CommonMark 基本構文のうち、段落、見出し、強調、リンク、リスト、引用、フェンス付きコードブロックなどをフェーズ1でサポートする。4スペース以上の字下げによるコードブロックは、意図しないレイアウトを避けるため恒久的に非対応とし、通常の段落として解釈する。脚注、MathJax 数式、Callout、GFM 互換テーブル、Frontmatter、Heading Attributes、水平線もフェーズ1でサポートする。生 HTML は禁止するが、HTML コメントは自由記述として扱い、制御には使わない。

Heading Attributes は `{#id .class}` を許可する。見出しに自動 ID は付けない。`#:` のような番号なし見出しは LaTeX の `\section*` と同じくカウンターを進めずリセットもしない。上位の見出しがない下位見出しは、不足階層を 0 として表示する。

コードブロックはフェンス付きのみを許可し、4スペース以上の字下げによるコードブロックは恒久的に非対応とする。画像は Markdown ファイル基準のローカル PNG/JPEG/SVG のみを許可する。`../`、絶対パス、URL、生 HTML、取り消し線、タスクリスト、定義リスト、include、embed、figure、画像サイズ拡張はフェーズ1では非対応。

トップレベルの制御要素は次の自己完結タグに限定する。

```html
<pagebreak />
<pagestyle name="empty" />
<maketoc />
<maketitle />
<references />
<appendix />
<frontmatter />
<mainmatter />
<backmatter />
```

`appendix`、`frontmatter`、`mainmatter`、`backmatter` は「文書クラス」の節で定める。

`pagestyle` は `empty`、`plain`、`headings` のみ。未知値は警告して `plain` にフォールバックする。LaTeX の `\pagestyle` と同様に、マーカーを含むページから次のマーカーまでのページに適用する。マーカーの直後に `pagebreak` が続く場合は、改ページ後のページから適用する。`empty` は柱とページ番号を出さず、`plain` はページ番号だけ、`headings` は柱（直近の h1 / h2 見出し）とページ番号を出す。`pagebreak` は先頭・末尾・連続でも実行し、空白ページを警告する。`maketitle`、`maketoc`、`references` は複数指定時に最初だけ有効とし、後続を警告する。

## 6. 見出し、目次、Callout

見出し番号は既定で `1.`、`1.1.`、`1.1.1.`。`numbering-depth` を超える見出しは表示するが番号を付けない。`toc-depth` を超える見出しは目次に含めない。`<maketoc />` の位置に、`layout.heading.toc` を見出し文字列として表示した目次を生成する。`layout.heading.toc` の既定値は `Contents` とし、subsection 以降は見出しレベルに応じてインデントする。目次対象がない場合は警告して空の目次を生成する。

Callout は次の記法と設定を使う。

```markdown
> [!theorem] ピタゴラスの定理
> $a^2+b^2=c^2$
```

```yaml
layout:
  callouts:
    theorem:
      title: "Theorem {theorem.arabic}."
      style: plain
    proof:
      title: Proof
      style: proof
```

`numbered` は持たず、title にカウンタープレースホルダーがある場合だけ番号を付ける。未登録環境は環境名を title、`plain` を style とする。フェーズ1の組み込み style は `plain`、`definition`、`remark`、`proof`。未知 style は警告して plain にフォールバックする。proof は番号なし、title は YAML の title、内容末尾に `□` を自動付与する。

カウンター形式は `arabic`、`roman`、`Roman`、`alph`、`Alph`。`{h1 > theorem.arabic}` のようなスコープを許可し、要素数が `layout.counter.max-depth` を超えたらエラー。スコープ付きのカウンターは LaTeX の `\numberwithin` と同じく、スコープの見出し（またはそれより上位の見出し）に番号が付くたびに 1 に戻る。スコープは Callout の title と、式・図・表の `display` に書いたものが有効になる。Callout の title と式・図・表の書式には `{h1.arabic}` のような見出し番号も書け、その要素の位置での見出し番号を表示する。未知カウンター・未知形式はエラー。形式は見出し番号、Callout のタイトル、式・図・表の表示と参照、ページ番号のすべてで同じように表示する（`roman` は小文字ローマ数字、`alph` は a, b, …, z, aa, …）。

Callout の `title` は YAML の文字列を CommonMark のインライン構文として解釈する。太字、斜体、取り消し線、リンク、コード、エスケープ、インライン数式 `$...$` を許可し、生 HTML とブロック構文は許可しない。カウンタープレースホルダーは Markdown 解釈前に展開する。生成 HTML の `.callout`、`.callout-title`、`.callout-body`、`.callout-<environment>` は安定した公開クラスとする。

## 7. ID、相互参照、引用

数式 `\label{eq:quadratic}`、Heading Attribute の ID、Callout の ID は同一名前空間を共有し、重複 ID はエラーとする。内部参照は標準 Markdown の fragment link に統一する。

```markdown
数式を[式](#eq:quadratic)で参照する。
番号を自動表示する場合は[](#eq:quadratic)。
```

明示テキストはそのまま表示し、空テキストは参照先の種類に応じて生成する。式・図・表は `layout.equation.reference`、`layout.figure.reference`、`layout.table.reference` の書式で生成する。見出しは `layout.heading.reference` にそのレベルの書式があり、番号の付く見出しであればその書式で、それ以外は見出しの文字列で生成する。Callout は `layout.callouts.<環境>.reference` があればその書式で、なければ展開した title で生成する。

```yaml
layout:
  heading:
    reference:
      h1: "Section {h1.arabic}"
      h2: "Section {h1.arabic}.{h2.arabic}"
  callouts:
    theorem:
      title: "**Theorem {theorem.arabic}.**"
      reference: "Theorem {theorem.arabic}"
```

`layout.heading.reference` は `h1`〜`h3` の書式を持つ map で、プレースホルダーは見出し番号の書式と同じものを使う。既定値はなく、未指定のレベルは見出しの文字列を表示する。Callout の `reference` は title と同じカウンタープレースホルダーを使い、Markdown として解釈せずそのまま文字列として表示する。title にカウンターのない（番号の付かない）環境の `reference` にカウンターがあればエラー `UNNUMBERED_CALLOUT_REFERENCE` とし、title を表示する。数式内の `\eqref` と `\ref` は LaTeX と同じく番号だけ（`(1)` と `1`）を表示する。未解決参照は警告し、参照文字列全体を赤太字で表示する。

引用は Pandoc 互換の `[@key]` と複数引用 `[@a; @b]`。フェーズ1は numeric のみで、本文の初出順に番号を割り当てる。同一引用グループの重複キーは警告して除去する。`.bib` は Markdown 基準のローカルパスのみ、重複キーは警告して後勝ち。`<references />` の位置に `citation.heading.text` / `citation.heading.level` による見出しと参考文献を生成する。見出しには LaTeX の `thebibliography` と同じく番号を付けない。numeric の参考文献一覧は標準箇条書きマーカーを使わず、`[1] Title`、`[2] Title` のラベルとハンギングインデントで表示する。既定は `References` / level 2。

## 8. 数式

MathJax の SVG と MathML を出力する。インラインは `$...$`、ブロックは `$$...$$`。ブロックの行分割は `\\` のみで、実改行では分割しない。`&` と `&&` はアンカー位置を進め、アンカーごとに左右揃えを交互に切り替える。行ごとのアンカー不足は空セルで補う。

`equation.numbered: true` は全行を番号付けし、`\notag` 行は番号もインクリメントも行わない。`false` は `\label` のある行だけ番号付けする。`\notag` と `\label` の同一行はエラー。行列内の `&` / `\\` は行列用として解釈する。

許可する行列系は `cases`、`matrix`、`pmatrix`、`bmatrix`、`Bmatrix`、`vmatrix`、`Vmatrix`、`smallmatrix`。`aligned`、`alignedat`、`align`、`align*`、`gather`、`gather*` は採用せず、使うと `UNSUPPORTED_MATH_ENVIRONMENT` エラーとする。行と `&` の分割は環境と波括弧の外側でのみ行い、許可した行列系の中の `&` / `\\` は分割しない。MathJax が TeX の誤り（閉じ括弧の不足など）を検出した数式は、`MATH_RENDER` エラーとして報告する。

フェーズ1の TeX subset は `\text`、`\operatorname`、`\frac`、`\sqrt`、主要大型演算子、`\mathbb`、`\mathcal`、`\mathrm` 等。`\text{...}` は Unicode、平文、`% # $ & _ { }` のエスケープだけ許可する。

マクロ・演算子・組み込みコマンドは同じ TeX コマンド名前空間で扱う。マクロは args 0〜4、オプション引数なし。組み込みを置き換える場合のみ `redef: true` を許可し、既定値は false。limits の既定値は false。

## 9. 表と装飾

### 9.1 表構造

フェーズ1では GFM 互換テーブルを扱い、最終フェーズでは `markdown-it-multimd-table` の標準記法を採用して `rowspan` / `colspan` によるセル結合を許可する。MathMD 独自のセル結合記法は追加しない。結合範囲、列数、行数が不正な場合はコンパイルエラーとする。

表は空行で終わる。Pandoc と同じく、表の直前または直後の段落を `: 見出し` または `Table: 見出し` と書くと表の見出し（`caption`）になり、見出しのある表だけに `layout.table.display` の書式で番号を付ける。見出しの末尾の `{#tbl:id}` は表の ID となり、参照できる。

生成表には `.mathmd-table` を付与し、`table`、`thead`、`tbody`、`tr`、`th`、`td` とともに安定した公開HTML APIとする。セルに `data-row` / `data-col` は付与しない。セル単位の指定は標準CSSの `nth-child()` など、結合後の実DOM上のセル順を対象にする。結合セルの論理座標を自動補正しない。

### 9.2 global / scoped style

最終フェーズでは、構造と装飾を分離するため、トップレベルに次のstyleブロックを許可する。

```html
<style>
.mathmd-table {
  border-collapse: collapse;
}
</style>

<style scoped>
tbody tr:nth-child(n+3):nth-child(-n+5) td:nth-child(2) {
  border-top: 3px double;
  text-align: right;
  vertical-align: middle;
}
</style>

| A | B |
|---|---|
| 1 | 2 |
```

- `<style>` は文書全体に適用する。
- `<style scoped>` は直後の1ブロック要素をスコープルートとし、`@scope` 相当で適用する。`:scope` はルート自身を表す。
- Callout 内部にはstyleブロックを置かない。Calloutを装飾する場合は、Callout直前のトップレベル `style scoped` から `.callout-title` などの子孫を指定する。
- `<maketitle />`、`<maketoc />`、`<references />`などの制御タグ直前の scoped style は、展開後の生成要素を対象にできる。
- 連続する複数の scoped style は、すべて直後の同じ要素へ適用する。
- global / scoped ともCSS標準のcascade、詳細度、cascade layer、記述順に従う。scopedを常に優先する独自規則や `!important` による強制上書きは追加しない。scope proximity はCSS標準に従う。
- CSSの標準セレクタ・プロパティを許可する。セルの水平・垂直配置、水平・垂直罫線、一重・二重・太線、色、幅、範囲指定はCSSで表現する。隣接セルの共有罫線が競合した場合もCSS標準の罫線衝突解決に従う。
- styleブロックは文書コンテンツだけに適用し、PreviewのDiagnosticsなど内部UIには適用しない。Preview内部UIはShadow DOMで隔離する。
- PreviewとPDFは同じ装飾結果を検査対象とする。表にstyle指定がない場合、罫線・背景色などの装飾を自動付与しない。

styleブロックはトップレベルの制御構文として扱い、生HTMLの任意要素は引き続き許可しない。CSS構文エラー、不正なCSS資産参照、存在しないCSS資産はエラーとし、複数エラーを収集して診断JSONへ列挙する。未知のCSSプロパティはブラウザのCSS標準解釈に委ねる。

### 9.3 CSSファイル

YAMLでCSSファイルを次のように指定できる。

```yaml
mathmd:
  style:
    import:
      - styles/base.css
      - styles/theorem.css
```

`mathmd.style.import` は指定順に読み込み、同じファイルは一度だけ読む。CSSファイル内の `@import` は禁止し、再帰的CSS importは許可しない。指定CSSはMarkdownファイル基準の相対パスまたは絶対パスを許可し、`../` による親ディレクトリ参照は禁止する。外部URLは許可しない。CSS内のローカル `url()` はCSSファイル自身のディレクトリ基準で解決し、同じパス規則を適用する。CSSをHTMLへインライン展開し、ローカル `url()` は出力HTML基準へ書き換える。

### 9.4 受け入れ対象

最終フェーズの正常系・異常系・レイアウト系テストには、表のセル単位の水平・垂直配置、`nth-child()`による行・列範囲指定、一重・二重・太線・色付き罫線、セル結合、不正結合エラー、global / scoped のcascade、YAML指定CSS、ローカルCSS資産、CSS構文エラー、定理タイトルのMarkdown装飾、タイトル内カウンタープレースホルダーとインライン数式、PreviewとPDFの一致を含める。

## 10. コードブロック

### 10.1 記法とハイライト

最終フェーズでは、コードフェンスの情報文字列に `言語:ファイル名` を許可する。最初の `:` で一度だけ分割し、言語名は前後空白を除去してShikiへ渡し、ファイル名は前後空白だけを除去して表示する。ファイル名内部の空白・記号は保持し、表示時はHTMLエスケープする。ファイル名は表示専用であり、実際のファイルは読み込まない。

````markdown
```typescript:src/example.ts
export const value = 1;
```
````

次の形式も許可する。

- 言語のみ（例: \`\`\`typescript）：Shikiの正規化言語名をヘッダー右側に表示する。
- ファイル名のみ（例: \`\`\`:src/example.ts）：プレーンテキストとして表示し、ヘッダー左側にファイル名を表示する。
- 言語・ファイル名の両方がない場合：ヘッダーを表示しない。

言語の自動推測は行わない。Shikiのエイリアスは解決し、ヘッダーには正規化された言語名を表示する。未知言語は警告を出し、入力された言語名をヘッダーに残したままプレーンテキストへフォールバックする。

ハイライトはShikiをコンパイル時に実行し、静的HTMLとして出力する。ブラウザ側のハイライト用JavaScriptは使用しない。トークンは意味ごとのCSSクラスを持ち、少なくとも `.token-comment`、`.token-keyword`、`.token-string`、`.token-number`、`.token-function`、`.token-type`、`.token-operator`、`.token-variable`、`.token-punctuation` を公開する。

既定テーマは `github-light`。YAMLで次のように設定できる。

```yaml
mathmd:
  code:
    theme: github-light
```

未知テーマは警告して `github-light` にフォールバックする。テーマCSSは利用者CSSより先に適用し、利用者のglobal / scoped styleで上書きできる。

### 10.2 レイアウトと操作

コードブロックには次の安定した公開クラスを付与する。

- `.code-block`
- `.code-header`
- `.code-filename`
- `.code-language`
- `.code-copy`
- `.code-content`

ファイル名または言語が指定された場合は、コード上部にヘッダーを表示する。ファイル名を左、Shikiの正規化言語名を右に置き、指定されない側は空欄とする。既定装飾はQiita風の組み込みCSSとし、背景、余白、角丸、ヘッダー、等幅フォントはglobal / scoped styleで上書きできる。行番号は表示しない。

Previewではコード本文を横スクロール可能にし、行を自動折り返ししない。PDFではページ幅を超えるコード行について `LAYOUT_OVERFLOW` 警告を出す。コードの改行・空白は保持する。

Preview限定でヘッダー右側にコピーボタンを表示する。コピー対象はファイル名・言語名・HTML装飾を含まないコード本文のプレーンテキストで、改行・空白を保持する。Clipboard APIが利用できない場合はコード本文を選択状態にして手動コピーできるようにする。成功時はボタン表示を一時的に `Copied` とし、PDFにはボタンを出力しない。

### 10.3 受け入れ対象

最終フェーズの正常系・異常系・レイアウト系テストには、`言語:ファイル名`の解析、言語のみ・ファイル名のみのヘッダー、Shikiハイライト、言語エイリアスの正規化、未知言語の警告とプレーンテキストフォールバック、`github-light`既定テーマ、未知テーマの警告とフォールバック、トークンクラス、行番号なし、Preview限定コピー、空白・改行保持、Preview横スクロール、PDFのはみ出し警告、Preview/PDFのハイライトとヘッダー一致、長いファイル名・特殊文字の安全な表示を含める。

## 11. 脚注

脚注は arabic 番号で、参照したページの下部に配置する。同じ脚注への2回目以降の参照は番号だけを表示する。同一定義の重複はエラー。フェーズ1では Callout 内の脚注定義を禁止する。未定義脚注参照は警告し、`[^missing]` 全体を赤太字で表示し、リンクと番号は生成しない。

## 12. 診断、フォント、ネットワーク

診断メッセージは英語固定。JSON の必須フィールドは `severity`、`code`、`message`、`location.file`、`location.start`、`location.end`。位置は Unicode code point の1始まり、`end` は排他的。診断順はエラー、警告の順にし、各グループ内は文書位置順とする。候補表示は編集距離2以下・最大3件。

既定フォントは Latin Modern、Harano Aji、Latin Modern Math 相当。欧文は Latin Modern Roman 10 / Mono 10、和文は原ノ味明朝 Regular、和文の太字は TeX の和文組版に倣って原ノ味角ゴシック Medium とし、和文の斜体は正体のままとする。数式は MathJax の TeX フォント（Computer Modern 系の SVG グリフ）で描画し、これを Latin Modern Math 相当とみなす。フォントは本体に同梱せず、`marktexset fonts install` が CTAN と原ノ味フォントの固定タグから取得し、固定した SHA-256 を検証してユーザーキャッシュ（`MARKTEXSET_FONT_DIR`、`$XDG_CACHE_HOME/marktexset/fonts`、`~/.cache/marktexset/fonts` の順）に置く。Chromium は CFF アウトラインのフォントを PDF に Type 3 として埋め込むため、`fonts install` は取得後に各フォントのアウトラインを TrueType の二次曲線（誤差 1 font unit 以内）に変換し、cmap、メトリクス、GSUB、GPOS などの他のテーブルはそのまま残した `.ttf` を同じディレクトリに置く。PDF には CID TrueType として埋め込まれる。PDF と Preview は取得済みフォントを `@font-face` で読み込み、未取得の場合は `FONT_NOT_INSTALLED` を警告してシステムフォントで組む。HTML 出力はフォントを埋め込まず、同名のローカルフォントを参照する。フォント取得は文書の外部ネットワーク制限の対象外の、利用者が明示的に実行する導入手順である。

本文の組版規則は TeX の `article` / `ltjsarticle` に揃える。全出力で段落・リスト・Callout 本文を両端揃えにし、`meta.language` に応じたハイフネーション（`hyphens: auto`）と、和文の禁則（`line-break: strict`）・和欧文間のアキ（`text-autospace`）・約物の詰め（`text-spacing-trim`）を適用する。PDF では本文 10pt、行送りを欧文 1.4・和文 1.7 とし、段落間の空きを設けず字下げで段落を区切る。欧文は見出し直後の段落を字下げせず（1.5em）、和文は見出し直後も含めて全角 1 字下げる。段落はページをまたいで分割してよく、孤立行は `orphans` / `widows` で 2 行以上を保つ。

PDF の英文段落（`lang` が `en` で始まり、和文を含まない段落）は、`layout.line-break: optimal`（既定）のとき Knuth–Plass 法で行分割する。ページ分割の前に本文幅の 1 段組で文書を組み、語の幅を実測して、行の伸縮率から求めた badness、行ペナルティ 10、ハイフンペナルティ 50、連続ハイフン 10000、最終行直前のハイフン 5000、隣接する行の密度差 10000 の各デメリットの総和が最小になる改行位置を選ぶ（TeX の `\tolerance` に相当する許容伸縮率は 1、見つからなければ 2、10 の順に緩め、ハイフネーションは 2 回目以降だけ許す）。ハイフネーション候補は TeX の米国英語パターンから、語頭 2 字・語末 3 字以上を残す位置に限る。選んだ各行は個別のブロックとして両端揃えにし、4 行以上の段落は最初と最後の行の前後で改ページしない。行末の句読点とハイフンは microtype の既定値に倣って右余白へ突き出す（`.` `-` `'` は字幅の 0.7、`,` `:` `;` `"` は 0.5、`–` は 0.3、`—` `!` `?` は 0.2）。突き出す量だけ行の目標幅を広げて改行位置を選ぶ。インラインコードと脚注参照は分割しない。和文、表のセル、図、脚注本文は対象外で、ブラウザの行分割に従う。`layout.line-break: browser` はこの処理を行わない。その他の値は `UNSUPPORTED_LINE_BREAK` エラーとする。Preview と HTML 出力はブラウザの行分割に従う。

インライン数式は、TeX と同じく最上位の関係演算子（`=`、`<`、`\le`、`\to`、`\in` など）と二項演算子（`+`、`-`、`\times`、`\cdot` など）の直後で改行してよい。波括弧・括弧・`\left...\right`・絶対値記号・環境の内側、単項の符号、上付き・下付きを伴う演算子、連続する演算子の間では分割しない。`\over`、スタイル切替、`\color`、`\not` などを含む数式は分割しない。分割した各部分は別の SVG にし、演算子の後の空きは TeX の thick space（5mu）と medium space（4mu）の幅の空白として置く。改行位置ではこの空白が消える。Knuth–Plass 法ではこの空白に `\relpenalty` 500 と `\binoppenalty` 700 を課す。和文段落と HTML 出力ではブラウザがこの空白で改行する。支援技術向けの MathML は数式全体を 1 つだけ出力する。

PDF の目次は各項目に点線のリーダーとページ番号を付ける（`target-counter()`）。`report` と `book` ではページ番号を途中で 1 に戻すが、Vivliostyle の `target-counter()` は戻した後のすべての見出しに戻した値を返すため、ページ分割の後にページを数えて目次の番号を書き込む。`article` と同様に第 1 レベルの項目は太字でリーダーを付けない。目次に載る見出しのうち ID のないものには `mathmd-section-N` の ID を自動で付け、すべての項目を見出しへのリンクにする（HTML 出力も同じ）。PDF には見出しから作るしおり（アウトライン）とタグ構造を入れ、`meta.language` を文書の言語、`meta.title` と `meta.author` の名前を Title と Author に設定する。`<maketitle />` の表題は見出しではないため、PDF ではしおり・柱・タグ構造の見出しに含めない。

PDF の図は LaTeX の既定配置 `[tbp]` に倣い、ページ上端へ配置し、入らなければ次ページの上端へ送る（CSS page float の `float: top`）。表は Pandoc の LaTeX 出力と同じく booktabs 型の罫線（上下の太罫と見出し行の下罫）で組み、見出しは表の上に置く。罫線は詳細度 0 で指定するため、利用者の表スタイルが優先する。コードブロックと Callout はページをまたいで分割してよく、前後に 3 行以上を残す。外部ネットワークは既定で禁止し、許可時も root の `network.allow: true` と明示ドメイン、HTTPS を要求する。JavaScript、iframe、embed、include は常に禁止する。外部リソースは URL と内容ハッシュをキャッシュし、リセットオプションを備える。

外部リソースとして扱うのは、Markdown の画像 `![](https://...)` と、`mathmd.style.import` で読み込む CSS 内の `url(https://...)` である。規則は次のとおり。

- `network.allow` が true でなければ `NETWORK_DISABLED`、HTTPS 以外は `NETWORK_INSECURE_URL`、ホスト名が `network.domains` のいずれとも完全一致しなければ `NETWORK_DOMAIN_NOT_ALLOWED` のエラーとする。サブドメインは個別に列挙する。
- リダイレクトは最大 5 回まで追い、各転送先にも同じ規則を適用する。応答は 20MB までとし、内容の先頭バイトから PNG、JPEG、SVG（CSS ではさらに WOFF、WOFF2、OTF、TTF）を判定する。拡張子や Content-Type は信用しない。
- 取得した内容は SHA-256 をファイル名としてキャッシュ（`MARKTEXSET_CACHE_DIR`、`$XDG_CACHE_HOME/marktexset/resources`、`~/.cache/marktexset/resources` の順）に保存し、URL との対応を索引に記録する。キャッシュ済みの URL は再取得せず、出力にはデータ URI として埋め込む。生成物の閲覧時にネットワークは使わない。
- `build` と `preview` の `--reset-cache` はキャッシュを削除してから取得し直す。
- 取得に失敗した場合は `REMOTE_RESOURCE_FAILED` エラーとし、理由を message に含める。

## 13. 実装計画

### フェーズ1 — 基本 HTML コンパイラ（実装済み）

- npm プロジェクト、TypeScript、CLI、設定既定値、YAML Frontmatter、import の基盤
- `preview` / `build` / `init` サブコマンドのCLI体系と初期テンプレート
- `examples/minimal.en.md` / `examples/minimal.ja.md` の同梱
- 英日・A4・余白・ページ設定の検証
- CommonMark 基本構文、脚注プラグイン、MathJax 数式 SVG
- 基本見出し番号、Callout、proof の `□`
- `pagebreak`、`pagestyle`、`maketoc`、`maketitle`、`references` の制御タグ認識
- `\label` と簡易式番号、Pandoc 形式引用、`.bib` 読み込み基盤
- text/JSON 診断と終了コード
- 正常系・異常系の最小テスト

現時点の実装確認は `npm run check` で行う。フェーズ1は仕様の土台を実装した段階であり、ページレイアウト検証や未実装の細部は下記フェーズで完成させる。

### フェーズ1.5 — 仕様準拠の強化

#### ローカルプレビュー（フェーズ1拡張）

- `marktexset preview`、HTTP 配信、`127.0.0.1:3000` 既定値、`--host` / `--port`
- WebSocket による複数クライアントへの `status` / `reload` / `diagnostics` 配信
- Preview でも Playwright + Vivliostyle による PDF 共通のレイアウト検査を行い、はみ出し・重なり・空白ページの診断を配信する。診断が空の場合はオーバーレイを表示しない。
- 入力 Markdown と依存ファイルの監視、100ms debounce、ビルドの coalescing
- 正常表示の保持、初回エラー画面、ブラウザ診断オーバーレイ、自動再接続
- 依存資産だけの安全な配信、no-store、LAN 公開警告
- 起動・更新・切断・終了の正常系、競合ポート・不正 host・切断復旧・エラー保持のテスト

- Heading Attributes の ID/class と、Callout ID を DOM に反映
- ID 名前空間の重複検査と内部参照の自動表示・未解決診断
- 目次、タイトル、参考文献の位置指定と重複タグ規則
- 数式の行単位番号、`\notag`、`&` / `&&` アライメントの完全実装
- Callout 内許可要素、脚注、画像、表、コードブロックの禁止・許可検査
- YAML の全階層に対する未知キー・型・重複キー診断
- 行・列・import 先を含む構造化位置情報と候補メッセージ
- 1機能1文書の正常系・異常系テストを仕様項目ごとに追加

### フェーズ2 — PDF とレイアウト品質

- Playwright 管理下 Chromium による `build --format pdf`（既定出力は `.pdf`）
- Vivliostyle によるページネーション、ページ番号、ページスタイル、柱、ページ下部脚注、改ページ。Vivliostyle は CSS Paged Media / GCPM を実装し、英語・日本語の両方の組版を同じ経路で扱う
- ローカル資産の相対パス解決と画像の埋め込み、MathJax の SVG + 支援 MathML アクセシビリティ
- コード・表・数式のはみ出し警告、重なり検査、空白ページ警告
- レイアウト系テスト（ページ数、文字位置、overflow、overlap）
- baseline 用 Docker の Pandoc + LuaLaTeX、`article` / `ltjsarticle`、`report` / `ltjsreport`、`book` / `ltjsbook` 比較環境（MarkTeXset のコンパイルには使用しない）

### フェーズ3 — 文献・言語・高度な文書要素（実装済み）

- author-year 等の citation style
- BCP 47 言語タグ、未対応言語の en フォールバック
- `description` 環境相当の定義リスト
- Callout 内の表・画像・コード・脚注定義・入れ子
- 画像キャプション、図番号、図参照
- 取り消し線、タスクリスト、高度な日付フォーマット

### フェーズ3.5 — Preview 数式インスペクタ

数式の TeX コマンドとレンダリング結果を Preview 上で相互に検査する。実装は次の3段階で進め、build HTML と PDF の成果物にはインスペクタ情報を出力しない。

#### フェーズ3.5-1 — 基本検査

- ツールバーのON/OFF、`--math-inspector` / `--no-math-inspector`、YAML既定値とCLI優先順位
- 数式・数式ブロック・行・番号・参照のホバー選択、クリック確定、枠線・半透明背景・スクロール追従ハイライト
- 元TeX、ファイル名・行・列・ブロック種別・`\label`・番号状態・適用設定
- SVG/MathML DOM、class、基本CSS、既存 Diagnostics のインスペクタ表示
- キーボード操作、狭い画面の下部ドロワー、API・WebSocket障害時の本文維持

#### フェーズ3.5-2 — 対応付けと操作

- TeX範囲とSVG/MathML要素の双方向ソースマップ
- 複数行のブロック／行情報、`&` / `&&` アライメント、番号・参照の詳細情報
- Sourceパネル、DOMパンくず、SVG/MathML相互選択、TeX・構造化JSONのコピー
- Callout、表、脚注を含む全数式、`\ref` / `\eqref`、未知コマンドの近似対応
- 同一内容の編集時のID・選択状態維持と、消滅時の選択解除

#### フェーズ3.5-3 — 詳細検査基盤

- コマンド説明・定義元・マクロ展開後TeX、組み込み／ユーザー定義／再定義済みの区別
- Styles / Computed の検索、分類、継承、無効宣言、CSS出典、scoped style境界
- 疑似クラスの一時強制、CSS変数の解決情報、仮想スクロールと遅延取得
- `data-mathmd-*` 公開属性、ソース座標系、`schemaVersion`付き専用API、同一オリジン・ワークスペース限定
- ソースマップ欠落時の数式全体フォールバック、再接続・更新競合・非対応ブラウザの診断

各段階では、数式ID・ソース範囲・SVG/MathML対応、Callout内数式、未知コマンド、API権限、更新時の選択解除を含む自動テストを追加する。

### フェーズ4 — 数学・拡張機構（実装済み）

#### 数式拡張

- `$$...$$` の複数行数式はフェーズ1の記法を継続する。`&` と `&&` は交互の揃え位置と追加の空白位置を表し、`aligned`、`alignedat`、`align`、`gather` 等の環境名を入力としては要求しない。
- `tikz-cd` は次の fenced block を正式な入力とする。セル区切りは `&`、行区切りは改行または末尾の `\\`、矢印は `\arrow[r]`、`\arrow[l]`、`\arrow[u]`、`\arrow[d]` および斜め方向を許可する。出力は安全なHTMLテーブルであり、任意のTeXを実行しない。

  ````markdown
  ```tikzcd
  A \arrow[r] & B \\
  C \arrow[ur] & D
  ```
  ````

- 数式内の `\ref{id}` と `\eqref{id}` は、既存の内部IDへのリンクとして出力する。`\ref` は参照先の番号・ラベルを、`\eqref` は数式用の括弧付き表示を用いる。未解決の場合は `UNRESOLVED_REFERENCE` 警告と `??` を出力する。
- `\mathbf`、`\mathsf`、`\mathtt` 等、MathJaxが提供する追加フォントコマンドを許可する。未知の数式形式は既存の数式診断規則に従う。

#### Callout style とHTML属性

- `layout.callouts.<name>.style` はフェーズ1の組み込み値 `plain`、`definition`、`remark`、`proof` に加え、フェーズ4ではCSSクラス名（例 `custom-theorem`）を受け付ける。カスタム値は `callout-plain callout-style-<name>` として出力し、組み込みの意味論を変更しない。
- `layout.callouts.<name>.class` とCallout・見出し属性の `.class` は追加クラスとして出力する。
- `{#id .class}` に加え、フェーズ4では安全な属性許可リストとして `role`、`title`、`lang`、`dir`、`tabindex`、`hidden`、`open`、`aria-*`、`data-*` を許可する。イベント属性、`style`、`src` 等の危険な属性は `UNSAFE_HTML_ATTRIBUTE` エラーとする。属性値はHTMLエスケープする。
- カスタムstyleと属性は見出しおよびCalloutに適用し、style名そのものをHTMLとして解釈しない。

### 最終フェーズ — 表装飾・文書スタイル・定理タイトル（実装済み）

- `markdown-it-multimd-table` の標準記法による `rowspan` / `colspan` セル結合と不正結合エラー
- `.mathmd-table` など安定した公開クラスと、標準CSSによる表のセル配置・罫線・範囲装飾
- トップレベルのglobal / scoped style、`@scope`相当のスコープ、制御タグ・Calloutを含む全生成要素への適用
- `mathmd.style.import` によるローカルCSS読み込み、CSSの非再帰import禁止、ローカル資産の解決とHTMLへのインライン展開
- CSS標準のcascade・詳細度・scope proximity・罫線衝突解決、Shadow DOMによるPreview内部UI隔離
- YAMLのCallout `title`におけるCommonMarkインラインMarkdownとインライン数式、カウンタープレースホルダーの事前展開
- 表装飾、style診断、定理タイトル装飾、Preview/PDF一致の1機能1文書テストと期待診断JSON
- Shikiによるコードハイライト、`言語:ファイル名`ヘッダー、トークンCSS、Preview限定コピー、コードブロックのPreview/PDFレイアウト検査

### 各フェーズの完了条件

各機能について正常系・異常系・レイアウト系を分離し、1機能1文書と期待診断 JSON を用意する。診断の severity、code、位置情報、終了コードは完全一致、message は部分一致とする。画像差分は参考値として記録するだけで合否判定には使わない。日付、タイムゾーン、外部リソースのキャッシュをテストで固定する。

### 組版品質の評価

組版品質は、Pandoc と MarkTeXset が同じように解釈できる標準 Markdown だけで書いた品質サンプルで測る。散文のサンプル（`examples/quality/prose.en.md`、`prose.ja.md`）、図・表・行列を含む別行立て数式・番号付きリスト・コード・脚注を含むサンプル（`structure.en.md`、`structure.ja.md`）、`report` クラスで章立てしたサンプル（`chapters.en.md`、`chapters.ja.md`）を英日それぞれに用意する。baseline は同じクラス（`report` は `report` / `ltjsreport`）で、Pandoc の `--number-sections` と、章立てのクラスでは `--top-level-division=chapter` を付けて組む。PDF から Poppler（`pdftotext -bbox-layout`、`pdffonts`）で行の位置とフォントを取り出し、次の指標を求める。SVG の数式は文字をもたず行が分断されるため、高さの大半が重なる断片を 1 行にまとめてから数える。柱とページ番号は、本文から大きく離れて各ページの同じ高さに現れる行として本文から除く。

| 指標 | 合格基準（MarkTeXset） |
|---|---|
| はみ出し行（本文の右端を 1.5pt 超える行。行末で二分に詰めた和文約物と、余白へ突き出す欧文の句読点・ハイフンは除く） | 0 |
| 禁則違反（行頭禁則文字で始まる行、行末禁則文字で終わる行） | 0 |
| 和文の字間の最大の広がり（2 字以上の和文の連なりの 1 字あたりの送りが、中央値を超える割合） | 10% 未満 |
| 連続するハイフン付き行末 | 2 行以下 |
| 最終ページ以外のページ下部の空白率（脚注がある場合は脚注の上の空き。罫線と前後のアキ 1.5 行分は除く。章立てのクラスでは、本文が上端から 3 行分以上下がって始まるページを章の始まりとみなし、その前の章の最後のページも除く） | 15% 未満 |
| 代替フォント・非埋め込みフォント | なし（既定フォント導入時） |

合格基準は `npm test` で検査する。`npm run quality -- --baseline` は同じサンプルを baseline の Docker 環境でも組版し、ページ数、行数、空白率、ハイフン、禁則、フォントを並べたレポートを `quality-report/` に出力する。baseline との比較は参考値であり、合否判定には使わない。CI は master への push ごとにこのレポートを作成する。

## 14. 仕様変更手順

仕様変更はこの文書を直接更新し、実装・テスト・README を同一の意味ある変更単位で更新する。過去版を確認する必要がある場合のみ `docs/old/` を参照する。新しい仕様を採用した場合は、旧仕様との互換性を暗黙に仮定せず、必要な移行診断とテストを追加する。
