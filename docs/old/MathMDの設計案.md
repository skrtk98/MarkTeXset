# 企画概要

## コンセプト
markdown+TeXを、TeX文書相当の活版品質で組版できるようにする。

ここでいう最低限の「TeX文書相当」は、MarkTeXsetが対応するMarkdownを Pandoc の Markdown→LaTeX 変換にかけ、その出力をTeXエンジンで組版したPDFを基準とする。MarkTeXsetはこの基準に対して、文書構造・数式の意味と判読性・脚注や参照・ページ内の収まりを損なわないことを保証する。フォントや行末、改ページの完全一致までは要求しない。

## 狙い
- TeXのデメリット解消
	- TeXの難解なエラー体系を避けることで、コンパイルエラーをわかりやすくする。
	- 遅いコンパイルを改善することで作業効率を上げる
- 学習コストを低くする
	- 組版エンジンとして広く知られているTeXの数式記法を採用することで参入障壁を低くする
- 数式の記述と文章構成の責務を分離する
	- 文章レイアウトや地の文についてはmarkdownに任せることで、既存のmarkdownと同様の書き方で書ける

## 補足

- ドキュメントのレイアウトなどの記述の仕方は、R Markdownの記法を参考にした。
- 注釈や定理環境などはQiitaの記法を参考にした。

# 詳細

## 文章の要素

MarkTeXset 文書は次の要素で構成される:
1. YAML Frontmatter（メタ情報）
    `---` で囲む
2. Markdown 本文

例：
```markdown
---
mathmd:
	import:
		- "presets/base-article.yaml"
		- "presets/measure-theory.yaml"
	
	bibliography:
		- "hogehoge.bib"
	
	meta:
		title: "測度論ノート"
		author: "Yusei ISHIDA"
		date: 2025-12-01
	
	layout:
		class: article
		paginate: true
		page:
			size: A4
			margins: 25mm

	command:
		macros:
		  R: '\mathbb{R}'
		  abs:
			  args: 1
			  body: '\left|#1\right|'
		operators:
			Hom:
				text: 'Hom'
---

本文はここから始まる。

例：$\Hom(X,Y)$や$\abs{x}$。
```

## YAML Frontmatter

- Frontmatterは文書の最初に1回のみ配置する。
- 最上位で `import` を書くことが推奨。(実装では順序非依存とする。)

## 使用可能なキー

|キー|<|<|型|内容|
|:--|:--|:--|:--|:--|
|`mathmd`|<|<|map|MarkTeXset 専用のメタデータ|
||`import`|<|list|外部 YAML 設定ファイルのパス|
|^|`bibliography`|<|list|参考文献ファイル(bib形式)|
|^|`meta`|<|map|メタ情報|
|^||`title`|string|文書タイトル|
|^|^|`author`|string or list|著者|
|^|^|`date`|timestamp|日時|
|^|`layout`|<|map|レイアウト情報|
|^|`command`|<|map|数式関連設定|
|^||`macros`|map|マクロ(`\newcommand` 相当)|
|^|^|`operators`|map|演算子(`\DeclareMathOperator` 相当)|

`author`は次のような記述をサポートする。

```yaml
author: "hogehoge" # 著者名
```

```yaml
author:
	- "hogehoge" # 1人目の著者名
	- "hugahuga" # 2人目の著者名
```

```yaml
author:
	- name: "hogehoge" # 著者名
	url: https://hugahuga.com/ # 著者のURL
```

```yaml
author:
	- name: "hogehoge"
	url: https://hogehoge.com/
	affiliation: "hugahuga" # 所属名
```

```yaml
author:
	- name: "hogehoge"
	url: https://hogehoge.com/
	affiliation: # 所属情報
		- name: "hugahuga" # 所属名
		- url: https://hugahuga.com # 所属先URL
```

## Import System

### 目的

設定（タイトル、レイアウト、マクロ、演算子等）を  **共通化し再利用できるようにする**ための仕組み。

### import の形式

Frontmatter のトップレベルに書く：
```yaml
import:
  - "presets/base-article.yaml"
  - "presets/category.yaml"
```

### Import ファイルの形式

**Frontmatter と同じスキーマを持つ YAML ファイル**のみ import 可能。

例：
```yaml
title: "Default Title"
layout:
	page:
		size: A4
	    margins: 20mm
math:
	macros:
	    N: '\mathbb{N}'
	operators:
		Hom:
		    text: 'Hom'
```

※ import ファイルは本文を持たず、「設定のみを含むファイル」として扱う。

### 再帰的 import と循環

- import ファイルが更に `import` を含んでもよい。
- 循環 import はエラーとする。

### マージ規則

#### ステップ順

1. ルート Frontmatter を読み込む
2. `import` に listed されたファイルを **上から順に処理**
3. 各 import ファイルも再帰的に import する
4. すべての import 結果を「ベース設定」とする
5. 最後に **ルート Frontmatter 本体**をベースに上書きマージする

#### キー別マージ規則

- スカラ値(string, number, boolean): 後勝ち(上書き)
- 配列(list): 後勝ち(置換)
- 連想配列(map): シャローなキー単位マージ
	例：`page` など：
	- `page.size` → 後勝ちで上書き
	- `page.margins` → 後勝ち
	- 未定義キーは追加

## Command Settings

`command:` キー配下では、
- **macros**: `\newcommand` 相当のマクロを定義
- **operators**: `\DeclareMathOperator` 相当の演算子定義

### Macros

#### 目的
TeX の `\newcommand` 互換の仕組みだが、

- TeX の catcode/macro 展開モデルは使わない
- AST に展開される安全なテンプレート置換
- 文書全体への副作用を排除

する。

#### 定義形式

- 0 引数の場合:
	```yaml
	macros:
		R: '\mathbb{R}'
	```
	呼び出し: `\R`
- n 引数の場合:
	```yaml
	macros:
		abs:
			args: 1
		    body: '\left|#1\right|'
	    inner:
		    args: 2
		    body: '\langle #1, #2 \rangle'
	```
	呼び出し: `\abs{x}`, `\inner{x}{y}`

- `args`: 引数の数
- `body`: 定義する演算子の本体。`\newcommand` と同様に`#1`などして引数の場所を指定する。

#### 制約

- 引数数は **0〜4 に制限**
- `body` 内で使用可能なのは **MarkTeXset が許可する TeX サブセットのみ**
- 未定義マクロ参照 → エラー
- 再帰禁止
- 組み込みコマンド（`\frac`, `\sum`, など）は上書き禁止
- import ファイル同士の macro 名衝突は **エラー**
- ただしルートヘッダ側の定義は import を上書きできる

### Operators

#### 目的
TeX の `\DeclareMathOperator` 互換の仕組み。

#### 定義形式

```yaml
operators:
	Hom:
		text: 'Hom'
	limsup:
		text: 'limsup'
		limits: true
```
呼び出し: `\Hom(X, Y)`、`\limsup_{n\to\infty} a_n`

- `text`：表示するローマン文字列
- `limits` `true` なら `\lim` 型。`false` なら `log` 型。

#### 制約

- 演算子名はマクロ名と同じ空間を共有するため重複禁止
- 組み込み演算子（`\lim`, `\sup` など）は上書き不可
- import 同士の衝突はエラー
- ルートヘッダ側は import を上書き可

## Markdown

MarkTeXset における Markdown 本文は、標準的な Markdown コマンドに加えて以下のコマンドを持つ:
1. **改ページ**:
	- 改ページを挿入したい箇所に `---` を記述する。
2. **番号付きの節**: 
	- フロントマッターの `layout.heading.visible: true` とすると`#` や `##` などに番号をつけることができる。デフォルトは空文字。
	- 番号のレイアウトは、`layout.heading.h1: "Chapter {h1.arabic}."` や `layout.heading.h3: "{h1.roman}.{h2.roman}.{h3.roman}"` などと設定する。( `Alph`, `alph`, `Roman`, `roman`, `arabic`, `fnsymbol` をサポート)
	- 個別に省略したい場合は `#:` や `##:` などにする。
3. **参考文献**:
	- フロントマッターで読み込んだ参考文献の一覧を出力したい場所に `<!--- refs: References -->` を記述する。
4. **文章内リンク(ラベルと参照)**:
	- 参照元を設置したい場所に `@hoge` を記述し、文章内で参照する際は`[...](@hoge)` とする。
	- `[...](@hoge "huga")` とするリンクタイトルをつけることができる。
5. **注釈**:
	- 本文中に `[^example]` のように文字列を記述することで、脚注へのリンクを表現できる。注釈内容は、同じく本文中に `[^example]: ...` というように記述する。
	- 本文中の脚注記号は、記述順に自動的に番号が振られる。
	- 番号のレイアウトは、`layout.footnote: "{footnote.fnsymbol}"` などと設定する。( `Alph`, `alph`, `Roman`, `roman`, `arabic`, `fnsymbol` をサポート)
6. **定理/証明環境**:
	- blockquote を拡張する形で実装する。
	- ObsidianのcalloutsやGithub DocsのAlertsのような書き方。
	- 記述方法: 
		- `> [!axiom] 公理`
		- `> [!remark] リマーク`
		- `> [!fact] 事実`
		- `> [!definition] 定義`
		- `> [!theorem] 定理`
		- `> [!lemma] 補題`
		- `> [!proposition] 命題`
		- `> [!corollary] 系`
		- `> [!example] 例題`
		- `> [!proof] 証明`
7. **箇条書きの拡張**:
	- 既存の番号なし箇条書き( `*` `+` `-` )や、番号付き箇条書き( `1.` `2.` ... )に加えて、見出し付き箇条書きを `- {hogehoge} hugahuga` としてサポートする。

## TeX Subset

MarkTeXset は TeX の完全互換ではなく、安全なサブセットを採用する。

### 許可される内容の例

- 四則演算、比較、括弧類
- 関数名：`\sin`, `\cos`, `\log`, `\exp`, ...
- `\frac`, `\sqrt`, `\sum`, `\int`, ...
- 主要記号：`\mathbb`, `\mathcal`, `\mathrm`、ギリシャ文字など
- `\begin{align}`, `\begin{cases}` など一部環境（明記する）

### 禁止事項

- `\newcommand`, `\renewcommand`, `\def`
- catcode 操作 (`\catcode`, `\obeylines`等)
- ページ制御（`\newpage`, `\vspace`等）
- 環境を跨ぐマクロ本体
- 未定義コマンド（エラー）

## Parsing and Error Rules

MarkTeXset パーサは文書を以下の単位で解析する(MathJaxベース)：

- **インライン数式**: `$ ... $` 
- **ブロック数式**: `$$ ... $$`
- **図式**: `` ```cd ... ``` `` ( tikz-cd記法 )

### エラー情報の必須属性

- 行番号・列番号
- 種別（inline-math / block-math / operator / macro）
- 本文中の正確な位置
- 修正候補の提示（未定義コマンドのとき）

例：

> Undefined macro `\innter` at line 42, column 15.  
> Did you mean `\inner`?

# Appendix: Minimal Example

```markdown
---
mathmd:
	import:
		- "presets/base-article.yaml"
	
	meta:
		title: "線形代数の基礎"
		author: ["Yusei Ishida"]
		class: article
	
	command:
		macros:
			norm:
				args: 1
				body: '\left\|#1\right\|'
		operators:
			ker:
				text: 'ker'
---

行列 $A$ に対して $\ker(A)$ を考える。

また、ノルム $\norm{x}$ を用いる。
```
