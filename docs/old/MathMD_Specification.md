# MarkTeXset 仕様書 (Draft v0.3)

## 1. 概要
MarkTeXsetは、Web技術（Markdown + HTML + CSS）をベースに、論文品質の数学ドキュメントを作成するためのパブリッシングシステムである。
Markdownの可読性とTeXの数式表現力を維持しつつ、Paged.jsによる印刷品質の確保と、最新のWebエコシステムへの適合を目指す。

### 1.1 活版品質の定義

本仕様における「TeX相当の活版クオリティ」は、抽象的な見た目の印象ではなく、次の基準実装を下回らないこととして定義する。

> **最低基準 (TeX baseline)**: MarkTeXsetが対応するMarkdown文書を、同等の文書構造・設定で Pandoc の Markdown→LaTeX 変換にかけ、その出力を標準的なTeXエンジンで組版したPDF。

MarkTeXsetの印刷用PDFは、少なくともこの基準に対して以下を満たさなければならない。

- 本文、見出し、箇条書き、脚注、参考文献、定理環境などの文書構造が欠落・重複しない。
- 数式の記号、構造、上下付き文字、分数、行列、複数行数式の意味と視認性を損なわない。
- 指定された用紙サイズ、余白、ページ番号、見出し番号を守り、本文がページ境界や余白からはみ出さない。
- 長い数式・表・コード・脚注を原因とする意図しない切断、重なり、読めない縮小を発生させない。
- 改ページ、相互参照、定理・数式番号が、同じ入力に対する基準PDFと比較可能な形で安定して出力される。

ここでいう「下回らない」は、PandocのTeX出力とのバイト単位の一致や、行末・改ページの完全一致を意味しない。フォント、行分割、改ページなどの差異は許容するが、内容の欠落、参照の破綻、判読性の低下、文書構造に起因する不自然な組版は許容しない。

この最低基準は、MarkTeXsetがサポートすると宣言した構文・設定の範囲に対して適用する。未対応のTeXコマンドや外部パッケージを入力した場合は、黙って低品質なPDFを生成せず、位置を示すエラーまたは明示的な警告を出す。

### 1.2 品質段階

品質目標は次の3段階で管理する。

|段階|意味|
|:--|:--|
|TeX baseline|PandocのMarkdown→LaTeX→TeX組版を最低ラインとして、内容・構造・判読性を満たす。|
|Print-ready|baselineに加え、ページネーション、脚注、相互参照、定理・数式番号、表・図を印刷用PDFとして安定させる。|
|TeX parity|baselineでは許容される組版差（行分割・改ページなど）も、代表的な文書ではTeX組版に近づける。|

初期リリースの必須目標は **TeX baseline** とし、Print-readyを実装上の目標とする。TeX parityは互換性を保証する範囲ではない。

### 1.3 検証方法

品質検証には、本文・数式・定理・脚注・参考文献・表・図・相互参照を含む代表文書を用いる。各文書について、MarkTeXsetのPDFと基準PDFを次の観点で比較する。

- テキストと数式の欠落、重複、順序の変化
- ページ内のはみ出し、重なり、空白ページ、意図しない切断
- 番号、脚注、参考文献、相互参照の解決結果
- 画面表示および印刷時の判読性

この検証ケースは仕様変更時の回帰テストとして維持する。

## 2. ファイル構成
- **Input:** CommonMark (GFM) + YAML Frontmatter + MarkTeXset Extensions
- **Output:** HTML5 (Preview with Paged.js / Print-ready PDF)

## 3. Frontmatter (YAML)
文書の設定はファイル先頭の YAML Frontmatter に記述する。

```yaml
---
mathmd:
  # 外部設定のインポート (下にあるものが設定を上書き)
  import:
    - "presets/article.yaml"
  # マージ規則:
  # 1. importされたファイルを上から順に読み込む (再帰的importも解決)
  # 2. Baseとなる設定に対し、後続の設定が上書き(Override)またはマージされる
  #    - スカラ値: 上書き
  #    - リスト: 置換 (または追加、実装依存)
  #    - マップ: キー単位でマージ

  # 参考文献データ (.bib)
  bibliography:
    - "references.bib"
    
  # メタデータ
  meta:
    title: "My Document"
    date: 2025-01-01
    author:
      - name: "Author Name"
        affiliation: "Affiliation"
        url: "https://example.com"

  # コマンド・演算子定義
  command:
    # マクロ定義 (TeX互換コマンド)
    macros:
      R: \mathbb{R}                        # 0引数 (定数)
      abs: (1) -> \left| #1 \right|        # 1引数 (Arrow-style)
      inner: (2) -> \langle #1, #2 \rangle # 2引数

    # 演算子定義 (通常: \log型)
    operators:
      Hom: "Hom"
      Ker: "Ker"
      Tr: { text: "Tr", font: "mathcal" }  # 詳細設定が必要な場合

    # 演算子定義 (Limits付き: \lim型)
    # ここに定義されたものは自動的に limits: true となる
    operators*:
      limsup: "lim sup"
      colim: "colim"

  # レイアウト設定
  layout:
    size: A4
    margins: 25mm
    numbering:
      headings: true  # 章番号の自動採番
      theorems: true  # 定理番号の自動採番
      equations: true # 数式番号の自動採番
---

```

## 4. Markdown 拡張構文

### 4.1. ラベルとID付与

参照先（アンカー）を作成するためのID付与は、対象の文脈に合わせて3通りの記法をサポートする。

1. **ブロック要素 (段落, リスト, 見出し):**
要素の末尾に `{#id}` を記述する。
```markdown
# 序論 {#sec:intro}
これは重要な定義である。 {#def:main}

```


2. **インライン要素 (文中の語句):**
スパン記法 `[...]{#id}` を使用する。
```markdown
ここで [ポアンカレ予想]{#term:poincare} について述べる。

```


3. **数式内:**
LaTeX標準の `\label{id}` を使用する。
```markdown
$$
  f(x) = x^2 \label{eq:quadratic}
$$

```



### 4.2. 参考文献リスト

Heading Attributes を使用し、`.references` クラスを持つ見出しを定義する。
コンパイラはこのクラスを検知し、直後に文献リストを生成・挿入する。

```markdown
# 参考文献 {.references}

```

### 4.3. 定理・証明環境

Blockquote の拡張構文（Callouts）を使用する。

* **定理:** `> [!theorem] タイトル {#id}`
* **証明:** `> [!proof] タイトル`
* 証明終了記号 (Q.E.D. / \square) はレンダラー(CSS)により自動配置される。
* **サポートされる環境:** `theorem`, `lemma`, `proposition`, `corollary`, `definition`, `remark`, `fact`, `example`, `proof` 等。Markdownの引用記法 `> [!type]` の形式であれば任意のクラス名としてパースされる。



### 4.4. 改ページ
改ページを挿入したい箇所に `---` (Horizontal Rule) を記述する。レンダラーはこの要素に対して `break-after: page` (または `page-break-after: always`) を適用する。

### 4.5. リンク・参照

標準 Markdown リンク構文を使用する。

* `[定理1.2](#thm:main)`
* テキスト部分の自動補完（「定理1.2」の自動挿入）は、将来的な実装フェーズでサポートを検討する。

### 4.6. 定義リスト (Description Environment)

LaTeXの `description` 環境に相当する機能として、Pandoc / PHP Markdown Extra 互換の定義リスト記法をサポートする。

```markdown
用語
:   定義文。
:   複数行も可能。

$f(x)$
:   数式を見出しにすることも可能。
```

HTML出力は `<dl>`, `<dt>`, `<dd>` に変換される。

## 5. 数式構文 (KaTeX Subset)

* **Inline:** `$ ... $`
* **Block:** `$$ ... $$`
* **制限:** `\newcommand`, `\def` 等の定義系コマンドは使用禁止（YAML側で管理するため）。

### 5.1. 可換図式 (TikZ-CD)
tikz-cd記法による図式記述をサポートする。
````markdown
```tikzcd
A \arrow[r] & B \\
```
````
※ 実装フェーズでは `tikzjax` 等のライブラリ連携を検討する。

## 6. レンダリングとプレビュー

* **HTML:** Paged.js を同梱したHTMLを出力する。
* **Preview:** ブラウザで開くことで、A4用紙レイアウト、ページ番号、脚注のページネーションが適用された状態で閲覧可能。

## 7. エラーハンドリング要件
パーサは以下の情報を含むエラーメッセージを提供すべきである：
* **基本情報**: 行番号・列番号 (Line/Column)、本文中の正確な位置
* **種別**: コンテキスト情報 (inline-math / block-math / operator / macro)
* **修正支援**: 未定義コマンド等の場合、類似する定義済みコマンドの修正候補 (Did you mean...?)

例:
> Undefined macro `\innter` at line 42, column 15.
> Did you mean `\inner`?
