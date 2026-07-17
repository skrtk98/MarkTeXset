# MarkTeXset 最終仕様書・実装計画

**状態:** 確定版  
**対象:** フェーズ1から最終フェーズまで  
**更新日:** 2026-07-16

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
    counter:
      max-depth: 3
    footnote:
      format: "{footnote.arabic}"
      placement: bottom
    equation:
      numbered: false
      display: "({equation.arabic})"
      reference: "式 ({equation.arabic})"
```

フェーズ1は `language: en|ja`、`class: article`、`size: A4` のみ許可する。日付の既定値は指定タイムゾーンのシステム時刻、既定タイムゾーンは UTC。余白は mm、cm、in、pt の非負値で、上下左右を個別指定する map も許可する。ゼロは許可する。

## 5. Markdown と専用要素

CommonMark 基本構文、脚注、MathJax 数式、Callout、GFM 互換テーブル、Frontmatter、Heading Attributes、水平線をフェーズ1でサポートする。生 HTML は禁止するが、HTML コメントは自由記述として扱い、制御には使わない。

Heading Attributes は `{#id .class}` を許可する。見出しに自動 ID は付けない。`#:` のような番号なし見出しはカウンターを進めず、下位見出しは不足階層を 0 として表示する。

コードブロックはフェンス付き・インデント付き、画像は Markdown ファイル基準のローカル PNG/JPEG/SVG のみを許可する。`../`、絶対パス、URL、生 HTML、取り消し線、タスクリスト、定義リスト、include、embed、figure、画像サイズ拡張はフェーズ1では非対応。

トップレベルの制御要素は次の自己完結タグに限定する。

```html
<pagebreak />
<pagestyle name="empty" />
<maketoc />
<maketitle />
<references />
```

`pagestyle` は `empty`、`plain`、`headings` のみ。未知値は警告して `plain` にフォールバックする。`pagebreak` は先頭・末尾・連続でも実行し、空白ページを警告する。`maketitle`、`maketoc`、`references` は複数指定時に最初だけ有効とし、後続を警告する。

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

カウンター形式は `arabic`、`roman`、`Roman`、`alph`、`Alph`。`{h1 > theorem.arabic}` のようなスコープを許可し、要素数が `layout.counter.max-depth` を超えたらエラー。未知カウンター・未知形式はエラー。

## 7. ID、相互参照、引用

数式 `\label{eq:quadratic}`、Heading Attribute の ID、Callout の ID は同一名前空間を共有し、重複 ID はエラーとする。内部参照は標準 Markdown の fragment link に統一する。

```markdown
数式を[式](#eq:quadratic)で参照する。
番号を自動表示する場合は[](#eq:quadratic)。
```

明示テキストはそのまま表示し、空テキストは参照先の種類に応じて生成する。未解決参照は警告し、参照文字列全体を赤太字で表示する。

引用は Pandoc 互換の `[@key]` と複数引用 `[@a; @b]`。フェーズ1は numeric のみで、本文の初出順に番号を割り当てる。同一引用グループの重複キーは警告して除去する。`.bib` は Markdown 基準のローカルパスのみ、重複キーは警告して後勝ち。`<references />` の位置に `citation.heading.text` / `citation.heading.level` による見出しと参考文献を生成する。既定は `References` / level 2。

## 8. 数式

MathJax の SVG と MathML を出力する。インラインは `$...$`、ブロックは `$$...$$`。ブロックの行分割は `\\` のみで、実改行では分割しない。`&` と `&&` はアンカー位置を進め、アンカーごとに左右揃えを交互に切り替える。行ごとのアンカー不足は空セルで補う。

`equation.numbered: true` は全行を番号付けし、`\notag` 行は番号もインクリメントも行わない。`false` は `\label` のある行だけ番号付けする。`\notag` と `\label` の同一行はエラー。行列内の `&` / `\\` は行列用として解釈する。

許可する行列系は `cases`、`matrix`、`pmatrix`、`bmatrix`、`Bmatrix`、`vmatrix`、`Vmatrix`、`smallmatrix`。`aligned`、`alignedat`、`align`、`align*`、`gather`、`gather*` は採用しない。

フェーズ1の TeX subset は `\text`、`\operatorname`、`\frac`、`\sqrt`、主要大型演算子、`\mathbb`、`\mathcal`、`\mathrm` 等。`\text{...}` は Unicode、平文、`% # $ & _ { }` のエスケープだけ許可する。

マクロ・演算子・組み込みコマンドは同じ TeX コマンド名前空間で扱う。マクロは args 0〜4、オプション引数なし。組み込みを置き換える場合のみ `redef: true` を許可し、既定値は false。limits の既定値は false。

## 9. 脚注

脚注は arabic 番号で各ページ下部に配置する。同一定義の重複はエラー。フェーズ1では Callout 内の脚注定義を禁止する。未定義脚注参照は警告し、`[^missing]` 全体を赤太字で表示し、リンクと番号は生成しない。

## 10. 診断、フォント、ネットワーク

診断メッセージは英語固定。JSON の必須フィールドは `severity`、`code`、`message`、`location.file`、`location.start`、`location.end`。位置は Unicode code point の1始まり、`end` は排他的。診断順はエラー、警告の順にし、各グループ内は文書位置順とする。候補表示は編集距離2以下・最大3件。

既定フォントは Latin Modern、Harano Aji、Latin Modern Math 相当。外部ネットワークは既定で禁止し、許可時も root の `network.allow: true` と明示ドメイン、HTTPS を要求する。JavaScript、iframe、embed、include は常に禁止する。外部リソースは URL と内容ハッシュをキャッシュし、リセットオプションを備える。

## 11. 実装計画

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
- Preview でも Playwright + Paged.js による PDF 共通のレイアウト検査を行い、はみ出し・重なり・空白ページの診断を配信する。診断が空の場合はオーバーレイを表示しない。
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
- Paged.js によるページネーション、ページ番号、ページスタイル、改ページ
- ローカル資産の相対パス解決と画像の埋め込み、MathJax の SVG + 支援 MathML アクセシビリティ
- コード・表・数式のはみ出し警告、重なり検査、空白ページ警告
- レイアウト系テスト（ページ数、文字位置、overflow、overlap）
- baseline 用 Docker の Pandoc + LuaLaTeX、`article` / `ltjsarticle` 比較環境（MarkTeXset のコンパイルには使用しない）

### フェーズ3 — 文献・言語・高度な文書要素

- author-year 等の citation style
- BCP 47 言語タグ、未対応言語の en フォールバック
- `description` 環境相当の定義リスト
- Callout 内の表・画像・コード・脚注定義・入れ子
- 画像キャプション、図番号、図参照
- 取り消し線、タスクリスト、高度な日付フォーマット

### フェーズ4 — 数学・拡張機構

- `tikz-cd`
- `\ref` / `\eqref`
- ユーザー定義の組み込み style と任意 CSS class
- `aligned`、`alignedat`、`align`、`gather` 系ではなく、確定済みの MathJax 互換拡張として安全に設計した複数行環境
- `mathbf`、`mathsf`、`mathtt` 等の追加フォント
- 最終的に任意 HTML 属性を安全な許可リスト方式で提供

### 各フェーズの完了条件

各機能について正常系・異常系・レイアウト系を分離し、1機能1文書と期待診断 JSON を用意する。診断の severity、code、位置情報、終了コードは完全一致、message は部分一致とする。画像差分は参考値として記録するだけで合否判定には使わない。日付、タイムゾーン、外部リソースのキャッシュをテストで固定する。

## 12. 仕様変更手順

仕様変更はこの文書を直接更新し、実装・テスト・README を同一の意味ある変更単位で更新する。過去版を確認する必要がある場合のみ `docs/old/` を参照する。新しい仕様を採用した場合は、旧仕様との互換性を暗黙に仮定せず、必要な移行診断とテストを追加する。
