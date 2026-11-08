# FACET — 実装仕様書 v2.1 (2026-11-08)

> **正式名称**: **FACET**（**FACET Arranges Concepts, Evidence, and Text**）。プログラム名・Gitリポジトリ名ともに `FACET` とする。表示名は `FACET`、内部のJavaScript/TypeScriptパッケージなど大文字を避ける識別子は `facet` とする。バックロニムはREADMEやAbout画面に記載する。
>
> **目的**: 論文執筆前のZettelkasten型アイデア整理から、Paragraph単位の論証構造化、Outline編成、Wordへ渡すためのMarkdown原稿生成までを一貫して行うローカルファーストアプリケーション。
>
> **Codexへの指示**: 本書を一次仕様として実装する。まずデータモデル・テスト・永続化層、次にWindowsポータブルデスクトップシェルと4つのメインタブ、Outline内のManuscriptプレビュー、Global Cards、最後にエクスポートを実装する。不明な細部は本書の「暫定決定」を初期値とし、設定・型・APIを拡張可能にしておく。Wordの本格編集、Git UI、クラウド認証は実装対象外。本書のUXモック `FACET_interactive_mock.html` は画面参考であり、データモデルの正本ではない。

## 0. 仕様の区分

- **確定要件 (REQ)**: ユーザーとの検討で合意した内容。実装変更には仕様変更が必要。
- **実装提案 (DEC)**: 本書で補った詳細。別案でも確定要件を満たせれば代替可能。
- **将来 (FUTURE)**: APIやデータ保存で拡張余地を残すがMVPでは作らない。

## 1. 確定要件

0. アプリケーションおよびGitリポジトリの正式名称は **FACET**。バックロニムは **FACET Arranges Concepts, Evidence, and Text**。UIのアプリ名、README、ドキュメントおよび生成物の名称に統一して使用する。

1. 論文単位でWorkspaceを作成・切替。Workspaceごとにメモ・Canvas・Outline・BibTeXを持つ。
2. 全Workspaceのメモを横断一覧・検索するGlobal Cardsを提供する。Workspaceを跨ぐメモ再利用は独立コピー。
3. 主要タブは **Canvas / Outline / Cards / Reference**。**Manuscriptは独立タブを持たず**、Outlineの中央ペインを分割してプレビュー表示、または全画面で開く。
4. メモは独立Markdownファイル。先頭の`# タイトル`をメモ名、それ以降を本文とする。UIで「Fragment」という用語は使わない。
5. 同一Workspaceのメモタイトルは一意。別Workspaceで同名は可。タイトル変更でWikiLinkも更新する。
6. メモ本文内のWikiLinkはObsidian風の`[[メモタイトル]]`形式。入力補完、クリックで遷移、被リンク表示を提供する。引用文献構文とは区別。
7. WikiLinkおよびメモタイトルはManuscriptにリンク・見出しとして出力しない。インラインWikiLinkは文字列に、独立したリンク行は行ごと除去する。
8. 複数メモを順序付き**Paragraph Group**にまとめると、生成原稿では一段落になる。Paragraph Groupを章・節へ組み込んでOutlineを作る。
9. OutlineはSection（章・節）とParagraph Groupを階層的に持ち、D&Dで順序・所属を変更できる。**メモの原稿配置箇所は同一WorkspaceのOutline内で最大1か所**。
10. Paragraph Groupのさらに上位のCollection/Sectionはネスト可能。メモ自体に親子構造は設けない。
11. **MVPではWorkspaceごとにCanvasは1つのみ**。将来の複数Canvasへの拡張余地を残す。Canvas / Outline / Cardsの左ペインは**Sectionsのみ**（最上位`All`、章・節）を表示する。左ペインにReference/Note Editor/Manuscriptの切替タブは設けない。
12. Canvasの`All`では**Outline未配置のメモも独立したカードとして表示・自由配置できる**。Paragraph Groupを二次元空間に自由配置し、各Group左上に所属章節のパンくずを表示する。章節選択時は該当範囲のParagraph Groupを整列した**ツリー**で表示する。
13. Canvas空白をドラッグしてパン、ホイールでカーソル位置を中心にズームする。Paragraph Groupカードも直接操作できる。
14. Cardsは**正方形カードのレスポンシブグリッド表示のみ**（リスト表示は不要）。タグ、章節所属、作成順などで表示・絞り込み・並び替え、タググループとOutlineグループを切替。
15. 右クリックから新規メモ・グループ作成、本文エディタからcitation挿入を行う。**Canvasタブ選択時のみ、メインタブの直下に横長のCanvas Toolsバー**を設け、新規/コピー/ペースト/グループ/複数選択/削除/アーカイブを提供する。他タブの上部や共通ヘッダーにはこれらのCanvas専用コマンドを配置しない。
16. Workspace単位でZoteroエクスポートのBibTeXを読み込み、Referenceで検索。右クリックまたは上部メニューから引用検索ダイアログを開き、`[@citationKey]`を本文のカーソル位置へ挿入できる。
17. Manuscriptは確認・Markdown出力が主用途。最終執筆・書式調整はWordで行う。高度なWYSIWYG Word編集は不要。Outlineでは**中央作業領域をOutlineとManuscriptに左右分割**してプレビューを開閉でき、全画面表示もできる。Manuscriptは右側のNote Editor/Referenceペインに埋め込まない。
18. Vaultは標準ファイル群で保存しGit/GitHubを外部コマンドで管理。Git操作画面を実装しない。
19. **Windows 11向けのインストール不要のスタンドアロン・ネイティブデスクトップアプリ**として配布する。Ubuntuサーバー／WSL2／ローカルWebサーバー／ブラウザの起動を必要としない。見た目はWindows 2000風の明色クラシックUIを初期テーマとし、ダークテーマは必須としない。

20. **独立したロゴ画像や図形は不要**。アプリ名 `FACET` をメインタブ左側にテキスト表示し、その直下に **FACET Arranges Concepts, Evidence, and Text** を小さく表示する。**Workspace切替はヘッダーではなく、左ペインのSections見出しより上**に配置する。
21. Outlineタブのツリーは折りたたみ可能とし、**Expand all / Collapse all** を上部に固定表示する。インデント幅は過大にしない。
22. Outlineタブでは章・節、Paragraph Group、内部メモのすべてをD&Dで並び替えできる。Note本文は**Outlineツリー上で直接展開編集**でき、右側Note Editorでも編集できる。
23. Canvas / Outline / Cards / Referenceの**右ペインはNote Editor専用**とする。右ペインにReferenceタブや切替は設けない。ManuscriptはOutline中央ペイン内の左右分割ビューと全画面プレビューで表示する。

### 1.1 v1.2で追加・変更した確定要件（引き続き適用）

20. **Outlineの章・節は、配下にParagraph Groupが1つしかない場合も絶対に省略しない。** 配下が0件であっても章・節名を表示する。折りたたみは明示操作によるもののみ。
21. **章・節の番号は自動採番**する。例：`4. Discussion`、`4.1. Magma recharge`。表示順から毎回計算し、章・節の改名・移動・追加で更新する。番号をタイトルの正本に埋め込まない。サイドペイン、Outline、Canvasのパンくず、Manuscriptの見出しで整合させる。
22. **Workspace切替は左ペインのSectionsの上側**に常時配置する。FACET名とバックロニムはメインタブの左側、検索導線は同じナビゲーション行の**タブ右端**に配置する。
23. **WorkspaceごとのCanvasは当面1つ**。過去版の複数Canvas作成・切替要件より優先する。データモデルは後で複数に増やせる設計を許容。
24. **未配置メモをCanvasに表示できる**。Paragraph Group / Outlineのどちらにも未所属のメモを独立カードとして自由配置し、`Unassigned`を明記する。未配置メモはManuscriptには含めない。
25. **Cardsは正方形タイルのグリッドのみ**。縦長リスト形式はMVP対象外。画面幅に応じて列数を変え、カード内容は必要に応じて省略する。
26. **Canvas左ペインは章・節だけのナビゲーション領域**にする。Allボタンと章・節ツリーを表示し、Paragraph Groupやメモは表示しない。章・節、Paragraph Group、メモのD&D編集は専用Outlineタブに集約する。右ペインはメモ編集に専念する。
27. **初期テーマは明色のWindows 2000風クラシックUI**。ダークモードもテーマ切替UIもMVPでは必要ない。

## 2. 主要設計判断

### 2.1 一つの構造ツリー、複数の表示

**構造の唯一の正本**はWorkspace内の`structure.json`（DEC）。Canvasの章別ツリーとOutlineとManuscriptはこれを読み、同じ操作コマンドで更新する。二重に階層構造を保存しない。`outlines/main.md`は人間可読な可搬用**派生エクスポート**とし、直接編集による双方向同期は初期実装対象外（DEC、将来実装可能）。

`All`の自由配置座標、Canvasの表示ノード、Pan/Zoom状態は当面単一Canvasの表示状態であり、構造ツリーには含めない。`All`でカードを動かしても原稿の順序は変わらない。章別のツリーは構造から都度自動レイアウトし座標の正本を持たない。

### 2.2 グループ種別

- **Section**: 章・節。SectionとParagraph Groupを子にできる。見出しレベルはツリー深度に対応（上限6レベル、超過時警告）。
- **Paragraph Group**: 順序付きメモ集合。原稿では**ちょうど1段落**として結合する。最低0、通常1個以上。UIではグループ内メモの順序をドラッグで変更できる。
- **Visual Group**: Canvas限定、装飾的な囲い。原稿への影響なし。必要ならネスト可（DEC）。
- **Collection**: 論旨のまとまりを作る中間ノード（DEC）。Section/Collection/Paragraph Groupを含み、原稿出力時は見出しなしで子を展開。章節ツリーにも表示可。

**Paragraphの中に別のParagraphは置かない。** 「ネスト」は主にSection→Collection→Paragraph Group→メモ、およびSection/Collectionの入れ子で実現。必要になれば段落内小グループを拡張するがMVPでは不要（DEC）。

### 2.3 メモの同一性

- 表示名は先頭H1。**同一Workspaceでタイトルを重複させない**。空タイトル不可。
- 内部IDはUUID/ULID等の不変値。ファイル名はID由来。**H1以外のID表記をMarkdown本文に挿入しない**。メモのIDとファイルパスの対応は`notes-index.json`等のWorkspaceメタデータに保存（DEC）。
- タグ・created_at・updated_at・archived等のメタ情報は`notes-index.json`に保存（DEC）。個別MarkdownファイルはH1と本文のみ。
- タイトル比較ではUnicode NFC・前後空白trim・casefold相当の大文字小文字正規化を適用。重複時は操作を拒否し通知。
- ファイル外部編集時にはH1とindex整合性を検証。重複・削除・不整合は保存を上書きせず警告。

### 2.4 WikiLink

- ユーザーが入力する基本構文は`[[メモタイトル]]`のみ。Obsidian系の単純な二重角括弧（`[[`補完あり）。
- 同一Workspaceのタイトルを解決。ユーザーがリンク先タイトル変更時、**対象Workspace内のすべてのメモ**を安全に走査し、構文上のWikiLinkだけを更新する。未解決リンクを警告。
- 本文中の`[[タイトル]]`をクリックすると対象メモを開く。Backlinksを索引で計算。
- WikiLinkの引用は`[@key]`、通常Markdownリンクとは別に処理。
- **Manuscript変換**: インライン`[[タイトル]]`→`タイトル`、WikiLinkだけの行→行ごと除去。`[[...]]`は通常のMarkdown文字列・コードブロック・インラインコードに現れた場合、誤変換しない（構文解析を利用）。
- 独立したリンク行に説明文が付属している場合、説明文は自動削除しない。知識整理専用の文章を消したければ、専用の除外ブロック／UIを別途追加（DEC）。
- タイトル重複を避けるため、初期実装ではエイリアス記法`[[target|label]]`や見出しアンカーは不要（DEC）。

### 2.5 Paragraph原稿生成

- Paragraph内のメモは明示的な配列順。最初のH1は除外。
- メモ本文からWikiLink構文変換、引用記法保持、原稿向け補助情報除外を行い、文字列を結合して**1段落**を生成する。空メモはスキップ。
- 改行・連続空白は原則整形するが、句読点・英語単語境界で破損しないよう、**各隣接メモの結合方式**（既定: 英文半角空白、手動: 空白なし／句点追加／独自接続文字列）をParagraph側に保持（DEC）。
- 複数段落、表、見出し、コードブロック、ブロック数式を含むメモは結合前に警告し、MVPでは単一段落のみ許可する（DEC）。データは失わない。
- Sectionの見出しのみManuscriptに出力する。Paragraph Groupタイトルは出力しない。
- 未配置メモはManuscriptに出力しない。複数配置はDB側で禁止（将来の複数Canvas表示に備える）。
- 引用キー`[@key]`はそのまま残す。未解決citationは検査で提示。DOCX変換は後続タスクとしてもよい。

## 3. UI詳細

### 3.1 共通

- **共通ナビゲーション行**: 左からFACET文字ロゴ（直下にバックロニム）、**Canvas / Outline / Cards / Reference** の4タブ、右端に**Search**（Global Cards横断検索）を配置する。New / Copy / Paste / Group / Select / Delete / Archive は共通ヘッダーに置かない。
- 切替時には選択ビュー・スクロール・CanvasカメラをWorkspaceごとに保持。
- **Canvas / Outline / Cardsの左ペインはSections専用**であり、Referenceを含む左ペイン用タブは一切表示しない。**Workspace切替をSectionsの上に設置したうえで**、最上段に`All`、下に章・節（単一の節も省略しない）のみ表示する。Paragraph Group、メモ、Reference / Note Editor / Manuscript の切替タブは左ペインに置かない。右ペインはNote Editor専用とする。
- 右クリック: 空白→新規メモ/Paragraph Group/Section/Visual Group; 選択メモ→編集/リンク/引用/コピー/アーカイブ/削除。
- 破壊的操作はUndo/Redo。削除は確認、アーカイブは非破壊。コピーしたメモは新規ID・重複しないタイトルにする。


### 3.1.1 v1.6確定：共通ナビゲーションおよびペイン構成

- **位置**: ナビゲーション行の左側に `FACET`（直下に `FACET Arranges Concepts, Evidence, and Text`）を置き、続いて `Canvas / Outline / Cards / Reference`、右側に検索導線を置く。独立した図形ロゴは不要。
- **Canvas**: 左はWorkspace切替とSectionsのみ、中央上部にCanvas専用編集コマンドとビューポート操作、中央にCanvas、右はNote Editor専用。Canvas内のメモ本文プレビューは約5行。
- **Outline**: 左はSectionsのみ、中央は通常Outlineツリー。`Open Manuscript`で**中央を左右分割**（左Outline、右Manuscript）し、閉じるとOutlineが全中央幅に戻る。プレビューは全画面表示可能。右InspectorはNote Editor専用で、Manuscriptタブを設けない。
- **Cards**: 左はSectionsのみ、中央は正方形カードグリッドおよび検索・フィルタ、右はNote Editor専用。
- **Reference**: トップナビゲーションの独立タブを維持し、Workspaceの文献を中央に一覧表示する。
- **左ペインのSections選択**: Canvasでは対象章節へ表示を切替。Cardsでは同じ選択を章節フィルタにも利用可能。Outlineは全構造の編集が主用途のため、左ペインは位置選択／ナビゲーションでありツリー自体を隠す必要はない。
- **利用可能な操作と場所を混同しない**: Referenceは独立メインタブから開き、左右Inspectorの切替には含めない。Citation挿入はNote Editor／Canvasの文脈操作から行う。

### 3.2 Canvas

- WorkspaceごとにCanvasはMVPでは1つ。複数Canvasの追加・改名・削除UIは初期実装しない（将来拡張）。
- 左サイドペインのトップに`All`、続いてSectionツリー。`All`ならそのCanvas上の対象Paragraph Groupを自由配置し、各カード左上に`Introduction > Background`のような所属パンくずを表示。未配置は`Unassigned`。
- 章・節選択でそのSection配下のParagraph Groupを構造に従い整然と自動配置。**サイドペインの選択は表示フィルタを変更**し、既存のAllの座標へ飛ぶのではない。
- ホイールはマウス位置中心にズーム（暫定10–400%）。背景ドラッグでパン。グループ移動はヘッダードラッグ。ズーム±、全体表示、100%を提供。
- Paragraph Groupは展開/折りたたみ可能。**各Noteの本文を約5行**まで表示し、長文は省略する。中のメモを閲覧・編集、メモ間順序変更、別Paragraphへの移動を提供。
- All座標はWorkspaceのCanvas用に保存。章別自動レイアウトは表示のみ。章別のD&Dは原稿構造の順序・所属を更新し、自動再配置。
- Canvas内の同一メモへの参照表示は複数許可。ただし原稿構造所属は最大一つ。
- ユーザーの「自由配置」は**AllのParagraph Group単位**、メモはGroup内で整列する（DEC）。

### 3.2.1 Canvasプレビューとビューポート（v1.3確定）

- Canvasの各メモカードは、タイトルの下に**本文の約5行**をプレビューする。全文が長い場合は行数で省略し、本文編集で全文を確認できるようにする。WikiLinkはカード内では読みやすい表示名に整形してよい。Paragraph Groupの展開状態において、内部メモカードそれぞれにこのプレビュー規則を適用する。未配置メモも同様。
- 左ペインの章・節は表示対象の選択のみを担当し、Paragraph Groupやメモのツリーは表示しない。構造編集はOutlineタブに集約し、右ペインはメモ編集専用とする。
- Canvas上部に**「全体表示」「100%」「グループにフィット」**の3操作を表示する。Canvas専用のNew/Copy/Paste/Group/Select/Delete/Archiveは**中央ペインの下端**に配置し、Canvasタブ以外では表示しない。パン・ホイールズーム機能は維持する。「全体表示」は表示対象（Allなら未配置メモも含む）の外接矩形とコンテナ寸法から倍率・オフセットを求める。「100%」は倍率1.0とし可能な限り表示中心を維持する。「グループにフィット」は選択Paragraph Groupへパン・ズームする。

### 3.3 Outline

- Section、Collection、Paragraph Group、メモをインデントで表示。
- **OutlineタブではSection、Subsection、Paragraph Group、配下の個別メモをすべて表示し、それぞれをドラッグ操作可能**にする。章・節（子孫を維持したまま）の並び替え、Subsectionの親Section変更、Paragraph Groupの並び替え・所属Section変更、Paragraph内のメモの並び替え・別Paragraphへの移動、未配置メモのParagraphへの追加を許可する。移動先はD&D中に強調表示し、不正な親子関係、循環参照、メモ多重配置を禁止する。SectionやParagraph Groupが一つしかなくても省略しない。
- `Unassigned`一覧を持ち、ここからParagraphへドラッグで配置。
- 構造変更はAllの座標に影響させず、パンくずは即時更新。
- **Open Manuscript** ボタンでOutline中央ペインを横方向に分割し、左側に操作可能なOutlineツリー、右側に読み取り専用Manuscriptを同時表示する。プレビューの開閉と全画面表示に対応し、構造変更・メモ編集時はManuscript側にも反映する。Manuscriptを左ペインや右側Inspectorタブとして表示しない。

### 3.4 Cards / Global Cards

- Cards: 現在Workspaceのすべてのメモ。**正方形Gridのみ**（List不要）、グループは`タグ / Outlineの所属 / なし`、並び替えは作成日昇順/降順/タイトル。**独立したOutlineフィルタ**として、All、Unassigned、章、節を選択して所属メモだけを抽出できる。親章を選択した場合は子節のメモも含む。タグ別グループ化や本文検索と組み合わせて適用する。
- タグ別表示では複数タグを持つメモは複数グループに登場してよい（同じ実体）。
- Global Cards: 登録済みWorkspaceすべてから横断検索し、Workspaceで絞込。結果クリックでWorkspaceを開く。「別Workspaceへ独立コピー」はコピー先で新規ID・新タイトル調整が必要。
- ローカル検索索引はSQLite FTS5等の**再生成可能キャッシュ**。Markdownと構造ファイルが正本。

### 3.5 Manuscript

- **独立したメインタブは作成しない**。Outline中央の左右分割ビュー、または全画面表示から利用する。
- 読み取り専用プレビュー。章見出しとParagraph本文を構造ツリー順に生成。
- `Download .md`、`Copy manuscript`。必要ならWordでの最終編集用DOCXはPandocで将来追加。
- メモタイトル・Paragraph Groupタイトル・独立行WikiLinkは出力しない。インラインWikiLinkはプレーンテキスト化。
- Paragraphクリックで構成メモへのソースマッピングを表示（MVPは選択リンクでも可）。

### 3.6 Reference

- 各WorkspaceのBibTeX（例: `references/library.bib`）を読み込み、author/year/title/key/DOIで検索。複数BibTeXの統合は将来。
- キー重複・解析エラーを警告。引用選択ダイアログは右クリック/上部/Markdownエディタから開き、`[@citationKey]`を**現在の入力カーソル**へ挿入。
- BibTeXは原則読み取り専用。Zoteroエクスポートの再読み込みを可能とする。

## 4. ファイル構成案

```
%APPDATA%/FACET/
├── config/workspaces.json       # 登録先絶対パス等（Vault外）
├── cache/global-index.sqlite    # 再生成可能、Git対象外
└── vaults/                     # 例示。通常はユーザーが別途選択した任意のローカルフォルダ
    ├── PaperA/                 # 独立Gitリポジトリ可
    │   ├── project.yml         # workspace UUID, 表示名, 設定
    │   ├── notes-index.json    # メモID, path, tags, timestamps, archived
    │   ├── notes/<id>.md       # H1タイトル＋本文のみ
    │   ├── structure.json      # 唯一の原稿構造正本
    │   ├── canvases/
    │   │   ├── index.json      # Canvas一覧
    │   │   └── <id>.canvas     # JSON Canvas規格ノード、座標
    │   ├── canvas-state.json   # ビューポート/表示固有情報
    │   ├── references/library.bib
    │   ├── outlines/main.md    # 派生ファイル（可搬用）
    │   └── exports/manuscript.md # 派生ファイル
    └── PaperB/...
```

### 4.1 `structure.json`の概念スキーマ

```json
{
  "schemaVersion": 1,
  "documentId": "doc-01",
  "children": [
    {"id": "sec-intro", "type": "section", "title": "Introduction", "children": [
      {"id": "para-01", "type": "paragraph", "title": "Background", "notes": [
        {"noteId": "note-a", "joinBefore": ""},
        {"noteId": "note-b", "joinBefore": " "}
      ]}
    ]},
    {"id": "sec-results", "type": "section", "title": "Results", "children": []}
  ]
}
```

- 全ノードID一意。Section/Collectionには`children`、Paragraphには`notes`。
- 1ノートの`noteId`を構造ツリーで2回使用してはならない。
- OutlineのD&D後、構造は原子的に書換（tempファイル→rename）。
- `outlines/main.md`はトランザクション終了後に再生成。派生ファイルをGit管理するかどうかは運用で選択可能。

### 4.2 JSON Canvasと互換性

JSON Canvas規格は`nodes`/`edges`を持ち、グループの厳密な親子関係や原稿構造を規定しない。したがって**`.canvas`に原稿構造の唯一の正本を置かない**。座標とノード表示にのみ利用。元のノードがSection/Paragraph/noteのどれを表すかはアプリ固有のメタデータ（または関連付けJSON）で管理し、未知のプロパティがある場合の他アプリ互換性を過大に保証しない。

## 5. デスクトップサービス/IPC案

MVPはHTTPエンドポイントを公開しない。Electron RendererからPreloadで公開した型付きIPCを通し、Mainプロセスが認可済みWorkspace内のファイルを読み書きする。以下は**IPCメソッドの概念案**である。

- `workspaces.list()` / `workspaces.registerDirectory()` / `workspaces.open(id)`
- `notes.list(workspaceId)` / `notes.create(...)` / `notes.read(id)` / `notes.update(...)` / `notes.archive(id)`
- `notes.backlinks(noteId)` / `notes.copyToWorkspace(noteId, destinationWorkspaceId)`
- `structure.read(workspaceId)` / `structure.move(workspaceId, move)` / `structure.update(...)`
- `canvas.read(workspaceId)` / `canvas.updateLayout(workspaceId, layout)`（WorkspaceあたりMVPは1 Canvas）
- `manuscript.preview(workspaceId)` / `manuscript.exportMarkdown(workspaceId, target)`
- `references.list(workspaceId)` / `references.reload(workspaceId)`
- `search.global(query, filters)`

複数ファイルへの変更は一時ファイル・バックアップ・変更リビジョンにより保護する。楽観ロックと競合通知を採用し、RendererはMainからのイベントで外部編集を認識する。ユーザーが選んでいないファイルパスをRendererから任意に渡して読み出せるようにしてはならない。

## 6. 操作別データ変更表

| 操作 | 書き換える正本 |
|---|---|
| メモ本文編集 | `notes/<id>.md`, notes-index 更新日時 |
| メモタイトル変更 | 対象Markdown、全参照元Markdown中WikiLink、notes-index |
| メモタグ変更 | notes-index |
| AllでParagraphカードをドラッグ | Canvas表示状態のみ |
| 章別CanvasやOutlineでParagraph順序変更 | structure.json |
| Paragraph内メモの並び替え | structure.json |
| Canvas空白パン/ズーム | viewport stateのみ |
| Canvasの表示状態更新 | Canvas表示ファイル（Workspaceにつき当面1件） |
| BibTeX再読込 | 検索キャッシュ（BibTeX原本はユーザー管理） |
| メモアーカイブ | notes-index、原稿配置済なら警告して扱い選択 |
| Manuscript生成 | 原稿正本は無変更。派生ファイルのみ |
| WikiLink追加 | 参照元Markdown、Backlinks索引再構築 |

## 7. 非機能要件・安全性

- Windows 11 x64で単独起動するポータブルアプリを最優先。ユーザーにPython/Node.js、WSL、Webサーバー、ブラウザ、インストーラ、管理者権限を要求しない。開発機にはNode.js等が必要でもよい。
- ネットワーク公開不要のデスクトップアプリとして作る。将来クラウド化する場合は別のサーバーアダプターにより認証、HTTPS、権限管理等を追加するがMVPでは実装しない。
- MarkdownをHTML表示する場合にはスクリプトを実行させない。WikiLinkもユーザー作成文字列としてescapeし、XSS防止。
- WikiLinkリネーム、構造移動など複数ファイル更新は失敗時の復旧処理を用意。安全な一時書込み・バックアップを採用。
- 1000メモ/Workspace、10Workspace程度を目安に検索とCanvasの操作性を検証（初期性能目標、暫定）。
- 代表的な日本語・英語タイトルをテスト。ケースフォールドおよびUnicode正規化の仕様を一貫させる。
- Git UIは実装しないが、キャッシュ・lock・テンポラリはVaultまたはGitに混入しないよう分離。

## 8. 受入テスト（Given / When / Then）

1. **タイトル一意**: 同Workspaceに`# Diffusion`がある状態で同名を作る→拒否。別Workspaceなら成功。
2. **リネーム追従**: `[[Diffusion]]`を参照する2ノートがある→`Diffusion ages`に変更→2リンクが新タイトルへ更新。コードブロック内は更新しない。
3. **参照リンク**: ノートAに`[[B]]`を記述→BのBacklinksにAが現れる。リンククリックでBが開く。
4. **Paragraph**: A/BをParagraphへ配置して順序変更→ManuscriptはA→Bの1段落。両メモのH1は出ない。
5. **配置一意**: あるメモがParagraph Pに所属→Paragraph Qへの追加操作は「移動」になる。二重配置は生成しない。
6. **Canvas All**: ResultsにParagraph Pがある→Allでパンくずが表示。Pを移動→Allの座標のみ変わりOutline順は不変。
7. **Canvas章別**: Results選択→Results配下だけツリー表示。背景ドラッグでパン、ホイールでズーム。
8. **単一Canvas**: Workspaceを切り替える→それぞれの唯一のCanvasが表示され、Allの座標とカメラ位置が別々に保持される。新Canvas作成UIはない。
9. **Outline D&D**: Paragraph PをIntroductionからDiscussionに移動→Outline/章別Canvas/Allパンくず/Manuscriptに反映。
10. **Cardsタグ表示**: 同一メモにDiffusionとRechargeタグ→タグ別表示に2回現れるが実体IDは同一。
11. **Global Cards**: Paper A/Bに同名メモ→横断検索では両方表示しWorkspace名で区別する。
12. **BibTeX**: Workspace Aに`keyA`をロード→Reference検索して挿入→`[@keyA]`がエディタカーソルに追加される。BのBibTeXと混ざらない。
13. **Manuscript変換**: `This implies [[Recharge]].`→`This implies Recharge.`。単独行`[[Recharge]]`は出力されない。`[@keyA]`は保持。
14. **保存復元**: アプリ停止・再起動で構造・All座標・WikiLink・BibTeX設定が復元される。
15. **競合**: 外部エディタが同一メモを変更しアプリから古い版を保存→警告し無言上書きしない。
16. **アーカイブ**: メモをアーカイブ→非破壊で復元可能。参照が失われない。
17. **章節番号**: Chapter 4に下位節が1件だけある→`4. Discussion`と`4.1. Magma recharge`を両方表示。並び替えると番号を再計算し、元のタイトルには番号を追加しない。
18. **未配置Canvasカード**: Outlineに所属しないメモをCanvas Allに配置して移動可能。章別表示とManuscriptでは非表示。
19. **左ペインは章・節ナビゲーション**: Allと各章・節のみが表示され、Paragraph Groupと個別メモは含まない。章・節選択によりCanvas表示を絞り込める。
20. **Cards Grid**: すべてのカードは正方形のGrid。画面幅の変化によって列数が再配置され、リストモードはない。
21. **クラシックテーマとWorkspace**: 初期表示はWindows 2000風の明色UI。左ペインのSections見出しの上からWorkspaceを切り替えられる。暗色テーマ切替は必須でない。

## 9. 開発順序・Codexへの実行指示

**Phase 1 — ファイルとドメイン**: Workspace registry、Markdownノート、タイトル検証、WikiLink parser、BibTeX parser、structure schema、原稿生成、テスト。

**Phase 2 — デスクトップサービス層/索引**: Electron Main/Preloadの限定IPC、Workspace CRUD、notes CRUD、構造更新、検索/Backlinks、ファイル監視・競合処理、テスト。HTTPサーバーやFastAPIはMVPで使用しない。

**v1.3 UI受け入れ基準**:

21. Canvasで展開中のParagraph Group内メモに本文が約5行表示され、長文は省略される。未配置メモにも同様のプレビューを適用する。
22. Canvas左ペインにはAllと章・節のみ表示する。OutlineタブにはSection、Subsection、Paragraph Group、個別メモをすべて表示し、階層をまたぐD&Dにより正しい構造更新ができる。
23. CardsのOutlineフィルタで`4. Discussion`を選択→直下と子節配下のメモだけがグリッド表示される。`4.1. Magma recharge`の選択では当該節のみ、`Unassigned`では未配置メモのみを表示する。
24. Canvasの「全体表示」は全表示ノードを画面に収め、「100%」は倍率1.0にする。「グループにフィット」は選択したParagraph Groupを画面に収める。All表示で未配置メモが存在する場合も全体表示の対象に含める。

**v1.4 Outline操作の追加受け入れ基準**:

25. OutlineタブでSection AをSection Bより後ろにD&Dすると、そのSectionとすべての配下のSubsection・Paragraph・メモが一緒に移動し、番号が自動再計算される。
26. Subsectionを同じ親Section内または別のSectionへ移動でき、配下のParagraphとメモは維持される。
27. Paragraph Groupを別Section/Subsectionへ移動でき、AllのパンくずとManuscriptの掲載位置が更新される。
28. Paragraph内のメモを並べ替え、または別Paragraphへ移動でき、Manuscriptの結合順序が更新される。
29. 未配置メモをOutlineのParagraph Groupへドロップでき、Outlineからは同一メモを複数箇所に配置できない。ドラッグ先が不正な場合はデータを変更しない。
30. 左ペインにはParagraphとメモを表示しない。単一のSubsectionも省略しない。


**v1.9でも適用するUI受け入れ基準（旧UI配置規則に優先）**:

31. FACETとバックロニム、4つのタブ、タブ右側のSearchが同じナビゲーション行に並ぶ。**Workspace切替のみ左ペインのSectionsより上**に置く。独立ロゴ画像はない。
32. Canvasでのみ、Canvas Toolsの横長ツールバーが**中央ペインの最上部**（中央のCanvas操作バーより上）に表示される。左Sectionsと右Note Editorの位置・幅はCanvas/Outline/Cards/Referenceのタブ切替で変化しない。
33. Canvas / Outline / Cardsの左ペインにはSectionsのみ表示し、Referenceを含む切替タブを表示しない。右ペインはすべてのタブでNote Editor専用とし、Referenceタブ/切替は設けない。
34. Canvasの展開されたメモカードは本文を最大約5行表示する。
35. Outlineで`Open Manuscript`をクリックすると**中央ペインが左右分割**され、Outlineツリーを保持したまま原稿が見える。再クリックで閉じ、全画面表示も選べる。
36. OutlineのD&Dとインラインメモ編集の結果が分割Manuscriptに反映される。
37. Canvas / Outline / Cards / Referenceの右側InspectorはNote Editor専用。ReferenceペインまたはManuscriptペインの切替タブを表示しない。OutlineのManuscriptは中央ペインを分割して表示する。
38. Cardsで左Sectionsを選択した場合、中央のカード抽出条件と不整合にならない。

**Phase 3 — GUI**: Electron Renderer上のReact/TypeScript、4タブ共通シェル＋Outline内Manuscript分割ビュー、右側エディタ、Cards/Reference、Canvas All/章別、Outline D&D、Global Cards。グラフ画面のライブラリはReact Flow、編集はCodeMirror系、ツリー並び替えはdnd-kit等を候補として採用する（バージョン固定）。

**Phase 4 — 安定化とポータブル配布**: パン・ズーム、右クリック、Undo/Redo、単一Canvasの状態保存、Markdownエクスポート、WindowsネイティブE2E、portable .exeビルド、README/配布検証。

**Codexの完了条件**: Gitリポジトリ `FACET` のルートに `README.md`、`CLAUDE.md` を置き、アプリの正式名称とバックロニムを記載する。 READMEにWindowsでのポータブル起動手順、Electron IPC/データモデルの説明、単体テスト/デスクトップE2Eの実行方法、既知の制限、GitHub Releases配布手順を記載。型検査・Lint・基本テスト通過。Vaultサンプルを添付し、上記の受入試験を確認できること。

## 10. 変更が必要になったときの優先順位

1. ユーザーが確定した要件 > 本書の暫定決定。
2. ユーザーが編集するMarkdownの可搬性とGitでの復旧性 > GUI内部都合。
3. 一つの原稿構造正本・メモ一意配置の整合性 > Canvas表現の自由度。
4. 誤消去防止・引用解決・不正なリンク処理 > 一時的な操作速度。
5. 未実装機能は画面上でも明確に区別し、動作しているふりをしない。

## 11. 実装時に留意する未確定箇所

- Paragraph内部の複数段落ブロック、表、数式の結合は初期警告。将来的にブロック対応を設計。
- Allの自由配置範囲には**未配置メモも含める（確定要件）**。未配置Paragraph Groupの表示は将来拡張を含めて検討する。未配置メモはOutlineタブのUnassignedにも一覧表示する。
- 章節選択の子階層をどこまで同時表示するかは、既定で選択Sectionの全子孫を表示。
- Workspace横断WikiLinkは初期実装では許可しない。
- `outlines/main.md`の手動変更は正本に自動反映しない。READMEで明示し、将来的なインポート機能を検討。
- Git/GitHubに機密資料や認証情報を誤ってpushしないよう、Vault内にトークンなどを置かない。

## 12. 参考仕様・公式資料

- React Flow viewport: https://reactflow.dev/learn/concepts/the-viewport
- React Flow API: https://reactflow.dev/api-reference/react-flow
- JSON Canvas v1.0: https://github.com/obsidianmd/jsoncanvas/blob/main/spec/1.0.md
- dnd-kit: https://dndkit.com/

## UI visual design baseline (Mock v1.2 — Obsidian-inspired compact theme)

- **視覚テーマはObsidian風**のチャコール／グラファイト色を基調としたダークUIとする。アクセントは落ち着いた紫、文字は高コントラストのオフホワイトとする。実際のObsidianのコードや専用アセットには依存しない。
- 本変更は**外観・情報密度のみ**。アプリの4タブ（Canvas / Outline / Cards / Reference）、3ペイン構成、各ペインの左右配置、Workspace切替位置、Search位置、中央ペインCanvas Tools、Note Editor、Manuscriptの中央分割表示は変更しない。
- コンパクトなデスクトップアプリを想定し、ヘッダー／ツールバー／ボタン／リスト行／カード／セクション間の余白・行高を削減する。極端な小文字化はせず、読みやすさとクリック領域を確保する。
- タブはフラットで控えめな選択表示、サイドバーは密度の高いツリー、Canvasカードは濃淡差と薄い境界線で区別する。角は小さく丸め、立体的なWindows 2000風ベベルやベージュ色は使わない。
- Canvasのドットグリッド、パン、ズーム、Fit All／100%／Fit Group、Paragraph Group上の本文最大約5行、独立した未配置メモを維持する。
- Outlineの階層折りたたみ・一括展開・D&D・Note直接編集、Cardsの正方形グリッドと検索／章節フィルタ、Referenceタブでの文献検索・引用挿入を維持する。
- ManuscriptプレビューはOutline中央ペイン内の分割プレビューとして維持し、必要なら全画面表示できる。
- Windows 11 x64上での**インストール不要・オフライン動作のポータブルEXE**方針、Electron + React + TypeScriptの推奨構成は変更しない。
- UIモック参照：`FACET_interactive_mock.html` v1.2。実装仕様の一次情報は本SPEC.mdとする。

> **優先順位**: 旧Windows 2000風、ライトテーマ、ベージュ背景、ベベル等を指定した箇所は、v2.1のObsidian風デザイン方針で上書きする。配置・操作の確定事項は従前どおり維持する。

### v1.7 UI配置変更（現行の中央ペインCanvas Tools要件と併用）

- Canvas Tools（New / Copy / Paste / Group / Select / Delete / Archive / Citation）は、Canvas選択時のみ、**中央ペインの上部**に横長のツールバーとして表示する。左/右ペインの真上まで横断させず、中央ペイン下部には置かない。
- Canvas / Outline / Cardsの**左ペイン**にはSectionsのみを表示し、Referenceタブ・Reference一覧・Referenceを開くための左ペイン切替を設けない。
- **右ペインはNote Editor専用**とする。OutlineのManuscript中央分割、各画面のその他の操作、データモデルはv1.6から変更しない。


### v1.8 UI配置変更（v1.7以前の配置指定に優先）

- **全タブ共通：右側InspectorはNote Editor専用**。右ペインのReference切替タブおよび文献一覧UIを削除する。メインナビゲーションの独立した`Reference`タブは維持し、文献管理・引用挿入の機能自体は削除しない。
- **Canvasのみ：Canvas Toolsはタブ行の下にある三分割レイアウトのうち、中央Canvasペインの最上部に限定して配置**する。左右ペインへ跨がる全幅ツールバーは禁止。上部のCanvas固有コマンド行はCanvasタブでのみ表示する。
- **画面の安定性**：Canvas、Outline、Cards、Referenceの切替で左右ペインの開始位置、横幅、高さを変えない。中央ペイン内の各ビュー固有ツールバーだけが変化する。
- **非変更事項**：左ペインSections専用、FACETフルネーム、Workspace切替、検索位置、Outline中央のManuscript分割、Canvasメモの約5行プレビュー、各タブのデータ操作は従前通り。

**v1.8受け入れ基準**：
39. CanvasタブではCanvas Toolsは中央ペインの幅に収まり、左Sectionsと右Note Editorの上には重ならない。
40. Outline/Cards/Referenceへ切り替えても左Sectionsと右Note Editorの幅・位置が変わらない。
41. 右Note EditorにReferenceボタン・切替タブが存在しない。ReferenceはメインのReferenceタブからのみ閲覧できる。
42. モックのメモ編集、Canvas操作、Outlineツリー、Manuscript分割等は従前と同様に動作する。


## 13. v1.9 固定の配布方針と技術構成（旧Webサーバー案に優先）

### 確定要件

- Windows 11 x64のユーザーが**インストールせずに**、配布された `FACET.exe` を実行してアプリを使えること。起動にUbuntu/WSL、別プロセスのWebサーバー、ユーザーによるNode.js/Python導入やブラウザ操作を必要としない。
- アプリと論文Vaultは分離し、メモの実体は通常のMarkdownファイルとしてユーザー指定のディレクトリに保管する。ユーザーの研究データをexeや一時展開先に保存しない。
- 配布後はネットワーク接続なしでも基本機能が使える。外部ライブラリ/CDNへの実行時依存を設けない。
- UIの3ペイン構成、タブ、メモ操作、原稿生成、D&D、検索、カードの動作は変えない。

### 実装提案（Claude Code / Codexが評価できる部分）

- **Electron + React + TypeScript + Vite** を第一候補とする。Windowsネイティブのデスクトップウィンドウとして動き、Chromium/Nodeのランタイムをアプリに同梱する。外部ブラウザは不要。
- **electron-builder の `portable` Windowsターゲット**でインストール不要の単体 `.exe` を作る。インストーラは出力しない。初回起動時に一時展開が発生する場合があるので「ディスクへの一切の展開がない」という意味ではない。アプリ本体の移動可能性と保存先の明確さを受け入れ要件とする。
- `electron/main` でVaultファイルI/O、OSダイアログ、ファイル監視、原稿エクスポートを担当する。`electron/preload` は限定された型付きIPCのみ公開する。RendererはNode.js直接アクセス不可（`nodeIntegration: false`、`contextIsolation: true`、sandbox可能なら有効）。IPCではパス検証、Vault境界チェック、機密情報保護を行う。
- Web APIのHTTP/FastAPIはMVPでは不要。ドメインロジックはUIと独立したTypeScriptモジュールに分けておき、将来他のプラットフォーム/クラウド向けアダプターを追加しやすくする。
- アプリ設定（Workspaceディレクトリの一覧等）と検索キャッシュはユーザープロファイル下のアプリデータに配置し、研究データの実体はVaultに保持する。ポータブルEXEと同じフォルダへ配置するモードが必要なら明示オプションで扱う。
- コード署名なしのexeはWindows SmartScreen警告の対象となり得る。Windows Defender/管理者設定による実行ブロックを「必ず回避できる」とは約束しない。

### v1.9 追加受入テスト

39. FACET名とバックロニムは上部ナビの左、Workspace選択は左ペインSectionsの上、Searchはナビ右側にある。Workspace切替で既存のメモ、Outline、Canvasの操作が動く。
40. 3ペインの幅/境界位置がCanvas/Outline/Cards/Referenceで変化しない。Canvas ToolsはCanvasタブ中央ペイン上部のみに現れる。
41. 外観はObsidian風のコンパクトなダークUIとする。Canvasのパン/ズーム、OutlineのD&D、Note編集、Manuscriptの中央分割、Cardsの正方形Gridなどの動作は維持する。
42. Windows 11クリーン環境でportable `FACET.exe`を展開/実行するだけで起動。別途ランタイム・WSL・サーバー・ブラウザを要求せず、オフラインでメモを作成・再起動後に再読込できる。
43. EXEを別フォルダへ移してもWorkspaceパス設定が維持され、既存Vaultが消えない。更新時にもユーザーデータは破壊されない。

**旧仕様に残るUbuntu/WSL2・FastAPI・ダーク専用・Workspaceをナビ行に置く説明はすべて非適用。** 本章および要件19/20/22/27を優先する。


## 14. v2.0 外観・UI密度の確定変更（2026-11-08）

### 確定要件

1. **視覚表現のみ変更**。現行v1.1のDOM構造、機能、データモデル、タブ・ペインの位置、操作体系を変えない。
2. Obsidianの標準的なデスクトップアプリを想起させる、チャコール背景・紫アクセント・低彩度の境界線・控えめな角丸のテーマを採用する。Obsidianの製品ロゴやアセットを流用しない。
3. 余白、見出し、ボタン、ツリーノード、Canvasカード、Cardsグリッド、Reference一覧の行高を適度に圧縮し、一画面当たりの情報量を増やす。文字可読性および操作対象の識別性を維持する。
4. Workspace選択は左ペインSections上、Searchは上部タブ右側、Canvas ToolsはCanvas中央ペイン上部、右ペインはNote Editor専用とする。OutlineのManuscriptは中央ペインの分割表示。
5. Windows 11向けポータブルアプリとしての技術・配布方針は引き続き第13章に従う。

### 追加受け入れ条件

- v1.1とv1.2でCanvas / Outline / Cards / Referenceの各画面構造と操作は同じである。
- タブ切替時に左右ペイン幅と境界位置が変化しない。
- Canvas ToolsはCanvasにのみ現れ、中央ペインの幅に収まる。
- 長いOutlineや多くのCardsで同じ画面サイズにより多くの項目を表示できる。
- ダーク配色でも本文、補助テキスト、選択状態、入力フォームの区別がつく。


## 15. v2.1 — ペイン開閉とSettings / Vault参照先（確定要件、2026-11-08）

本節は過去のペイン常時表示に関する記述に優先する。既存の画面構成、Canvas Toolsの位置、Windowsポータブルアプリ方針、データモデル、操作体系は変更しない。

### 15.1 左右ペインの折りたたみ

- Canvas / Outline / Cards / Referenceの**全タブ共通**で、左Sectionsペインおよび右Note Editorペインのそれぞれに独立した開閉ボタンを設ける。
- 左ペインを閉じると狭幅の復元レールと「開く」ボタンを残す。右ペインも同様。両側を同時に閉じることができ、中央コンテンツが利用可能な幅を占める。
- 展開時のペイン幅は従来の設定値を維持する。閉じる操作は表示状態のみを変え、選択中Workspace、Section、Note、Canvas配置、Outlineの構造、メモ本文を削除・変更しない。
- タブを変更しても開閉状態は維持する。非表示のペインに属するコントロールがキーボードフォーカスの対象にならないようにする。
- 右側は従来通り**Note Editorのみ**。Referenceを開閉ペインに追加しない。左側は従来通りWorkspaceセレクターとSectionsのみ。
- 実装提案: React UI stateで`leftPaneOpen`と`rightPaneOpen`を別個に管理し、切替時に中央領域をFlex/Gridで自動リサイズする。望ましければ開閉状態をアプリ設定に永続化する。

### 15.2 Settingsの起動導線

- 上部ナビゲーション右端の **Search all workspaces** ボタンの**直後（右側）**に歯車のSettingsアイコンボタンを配置する。
- 歯車をクリックするとSettings画面またはダイアログが開く。初期設定には **Vault Locations** の項目を設ける。
- Workspaceごとに対応するVaultの参照先フォルダーを表示し、「Browse…」からWindows標準のフォルダー選択ダイアログで参照先を変更できる。パス文字列の編集も許す場合は入力値の検証を行う。
- 現在使用中のVaultを含め、登録済みWorkspaceのパスを確認できる。**保存前のCancel操作は変更を反映しない**。設定保存後にアプリを終了・再起動しても参照先が維持される。
- Vaultパス変更時に旧Vaultのファイルを**勝手に移動・削除・上書きしない**。既存データの移行は別操作とし、参照先変更前に未保存編集の確認と新参照先の検証を行う。参照不能、アクセス拒否、既存ファイル不整合を明示する。
- 実装はWindowsネイティブアプリ向けにElectron Mainプロセスから`dialog.showOpenDialog({properties:['openDirectory']})`などのOSダイアログを開き、Preloadの限定IPC経由でRendererへ結果を渡す。入力パスの正規化、ディレクトリ存在確認、Workspaceメタデータ検証、パス境界保護を実施する。
- Workspaceレジストリ/アプリ設定はユーザープロファイルのアプリデータ等に保存し、研究データ本体はユーザー指定Vaultに置く。ポータブルEXEからの再起動でもその設定を読み込む。

### 15.3 HTMLモックの制約と対応

- HTML単体モックのSettingsではWorkspace別Vaultパスを入力してローカルUI設定として保存し、再度Settingsを開いたときに表示する。ブラウザが提供するフォルダー選択APIも可能な範囲で使用する。
- ブラウザのファイル選択では**Windowsの絶対フォルダーパスを取得できない場合がある**。モックの「Browse…」で得られるフォルダー名は実ディスク上のVault接続を意味しない。モックはVaultファイルを読み書きせず、Electron実装で初めて実ディレクトリへ接続する。
- ローカル設定の保存可否はブラウザの制限に依存する。保存が使えない環境でも、現セッション内では入力内容が保持される。

### 15.4 追加受け入れテスト

44. 左ペインを閉じる→中央ペインが広がる→復元ボタンで元の幅・内容に戻る。右ペインも同様であり、左右を同時に閉じて戻せる。
45. Canvas / Outline / Cards / Referenceへタブを切り替えても、左右ペインの開閉状態が変わらない。既存の選択・編集データを破損させない。
46. Search all workspacesボタンの右側にSettings歯車が1つ表示され、クリックでVault Locationsを開ける。
47. 各WorkspaceのVaultフォルダーを別々に選択でき、Saveで参照先が保存され、アプリ再起動後も参照先が維持される。Cancelでは更新しない。
48. 不在のフォルダー、アクセス拒否、破損または無効なVaultが選ばれた場合は適切なエラーを表示し、既存Vaultを変更しない。
49. WindowsポータブルアプリでBrowseを押すとOS標準のフォルダー選択ダイアログが起動し、選択したフォルダーの絶対パスを取得できる。HTMLモックに絶対パスの取得を要求しない。
