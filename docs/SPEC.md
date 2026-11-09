# FACET — 実装仕様書（整理版 v3.1）

更新日: 2026-11-09  
対応UI: `FACET_interactive_mock.html` v1.3（Obsidian風・コンパクトUI、左右ペイン開閉、Vault Settings）  
対象: Claude Code / Codex による新規実装

## 1. 製品定義と仕様の扱い

- **正式名称・リポジトリ名**: `FACET`。
- **正式な展開形**: **FACET Arranges Concepts, Evidence, and Text**。アプリ左上の `FACET` の直下に小さく表示する。独立した図形ロゴは不要。
- **目的**: 研究論文の執筆に先立ち、独立Markdownメモを蓄積・関連付けし、Paragraph Group単位で論旨を構成し、章・節へ配置して原稿を生成する。
- **最終編集先**: Microsoft Word。FACETはアイデア整理・アウトライン構築・原稿プレビュー・Markdownエクスポートを担い、Wordの完全な置換は目指さない。
- **対象プラットフォーム**: Windows 11 x64。**インストール不要のポータブルWindowsデスクトップアプリ**として配布する。WSL2/Ubuntuは開発時のみ使用してよい。配布アプリの実行にWSL、Python、Node.js、ローカルWebサーバー、外部ブラウザを要求しない。
- **外観**: Obsidianを想起させるチャコール／グラファイト基調、控えめな紫アクセント、適度に角丸のフラットUI。**情報密度を高める**。Obsidianのコード・ロゴ・アセットは流用しない。

### 1.1 正本と実装提案

- **REQ（確定要件）**: 本文で「必須」「する」「設けない」と定義する製品挙動。勝手に変更しない。
- **DESIGN（実装提案）**: Electron/TypeScript、保存スキーマ、ライブラリ等の具体策。REQを満たせば変更可能だが、変更理由を記録する。
- **MOCK（参照）**: `docs/mock/FACET_interactive_mock.html`。UI配置・相互作用の基準であり、サンプルデータ・インメモリ状態・不完全な処理を本番仕様とみなさない。
- 本書は**旧版のSPEC.md全文に代わる単独の現行仕様**。旧版の後付け変更章や優先順位の注釈を参照する必要はない。未記載の挙動を旧版から黙って復活させない。

## 2. 画面構成（全タブ共通）

### 2.1 ナビゲーションと3ペイン

上部共通ナビゲーション行を左から次の順に配置する。

1. `FACET` とその直下の `FACET Arranges Concepts, Evidence, and Text`。
2. **Canvas / Outline / Cards / Reference** の4つのメインタブ。
3. 右端に **Search all workspaces**。
4. そのすぐ右に歯車の **Settings** ボタン。

メインタブに **Manuscript** は置かない。独立図形ロゴ、共通ヘッダー内のNew/Copy/Paste等も置かない。

4タブの各画面は、原則**左ペイン／中央作業領域／右ペイン**の3ペインで構成する。

- **左ペイン**: 上部に現在Workspaceの切替（Sectionsの上）、その下に **Sections**（`All`と章・節ツリー）のみ。Paragraph Groupや個別メモ、Reference切替、Note Editor切替、Manuscript切替を置かない。
- **中央ペイン**: 選択タブの作業画面。タブ固有のツールバーはこの領域の内部に置く。
- **右ペイン**: **Note Editor専用**。Reference、Manuscript等へのタブ切替は一切設けない。ノート未選択時は空状態または選択案内を表示する。Cards・Canvasの展開編集、Outlineのインライン編集と同じMarkdown本文を編集し、相互に同期する。
- **配置の安定性**: ペインが開いている間、Canvas / Outline / Cards / Referenceのタブ切替で左右ペインの標準幅・境界位置が飛び跳ねないこと。中央だけ内容が切り替わる。

### 2.2 左右ペインの折りたたみ

- 左と右にそれぞれ開閉ボタンを設ける。**独立して閉じられ、同時に閉じることも可能**。
- 閉じた状態でも狭い復元レールと開くボタンを残す。中央作業領域は利用可能な幅まで広がる。
- 開閉は表示状態だけを変更する。選択Workspace、選択Section、メモ本文、Outline、Canvas座標は変更しない。
- タブ切替後も開閉状態を維持する。隠れたコントロールはフォーカス不能とする。
- DESIGN: 開閉状態はアプリ設定へ保存してよい。

### 2.3 WorkspaceとSections

- 1 Workspace は原則1論文の作業領域。各Workspaceはメモ、Outline、**MVPでは1枚のCanvas**、BibTeX参照を独立に持つ。
- Workspace切替は**左ペインでSections見出しより上**に常時配置し、タブ名の行には置かない。
- 左Sectionsツリーには`All`、章、節を表示する。**章・節が1件しかなくても省略しない**。Paragraph Groupと個別メモはこのツリーに表示しない。
- 章節の番号はツリー順から**動的に採番**する（例: `4. Discussion`, `4.1. Magma recharge`）。番号を章節タイトルの実データには書き込まない。
- CanvasではSectionsの選択が表示範囲を切り替え、Cardsでは所属フィルタに反映する。Outlineでは全構造を編集可能なまま、左側はナビゲーションに使う。

### 2.4 視覚設計

- オブシディアン風の**コンパクトなダークテーマ**。背景は濃いグレー、選択状態やフォーカスは紫、境界は低彩度。装飾的な立体ベベルは使わない。
- ツリーの行高・インデント・余白、ボタン寸法、カード間隔を抑え、見渡せる情報量を増やす。ただし可読性やクリック領域を損なわない。
- 3ペインやツールの**配置・機能はモックv1.3に準拠**。ライトテーマ切替はMVPに必須ではない。

## 3. Canvas

### 3.1 配置と操作

- Canvasタブを開いた場合に限り、**中央ペインの最上部**に `Canvas Tools` を置く。New / Copy / Paste / Group / Select / Delete / Archive（必要ならCitation）を提供する。
- Canvas Toolsは左Sections・右Note Editorの上を横断しない。他タブでは表示しない。画面下部にも移動しない。
- 中央作業領域にCanvas表示操作を提供する: **全体表示 / 100% / グループにフィット**。
- 背景ドラッグでパン、マウス位置を中心としてホイールズーム。表示倍率±の補助操作も可能とする。
- **全体表示**: 表示中のすべてのノード（Allでは未配置カードを含む）を画面に収める。
- **100%**: 倍率を1.0に戻し、できる限り現在の表示中心を保つ。
- **グループにフィット**: 選択したParagraph Groupにパン・ズームする。

### 3.2 All表示と章節表示

- **All**: WorkspaceのParagraph Groupを2次元に**自由配置**。各グループの左上にOutline所属の章節パンくずを表示する。
- **Allの未配置メモ**: Paragraph Group / Outlineのどちらにも入っていないメモは、独立したCanvasカードとして**自由配置**できる。`Unassigned`と明示し、Manuscriptには含めない。
- **章節選択**: 選択した章節とその子孫に所属するParagraph Groupを自動レイアウトした**ツリー表示**へ切替える。Allの座標を移動・拡大して見せる方式ではない。
- Allでの自由配置座標を変更してもOutline上の原稿順は変わらない。章節ツリーの座標は構造から計算する。
- Paragraph Groupは展開／折りたたみ可。展開時は順序付きの内部メモカードを表示し、**各カードにメモタイトルと本文を約5行**プレビューする。未配置カードも同じ程度の本文を表示する。長文は省略表示する。
- 配置済み・未配置のカードを**クリックすると、そのカードの直下に本文全体を展開**し、Markdownで編集できる。再クリックまたは閉じる操作で折りたたむ。ダブルクリックで右Note Editorを開く。
- 展開に応じてノードの大きさを更新し、章節ツリー表示では後続の配置をずらす。Allの自由配置座標は展開で変更しない。展開領域での編集中はノードのドラッグ、パン、ズームを発生させない。
- グループ・メモの編集、選択、移動と操作結果の同期を提供する。原稿上の順序変更・所属変更は単一の構造モデルに反映させる。
- WorkspaceあたりのCanvasはMVPで1枚のみ。複数Canvas作成・切替UIは不要。

## 4. Outline

- 中央に章・節、Paragraph Group、個別メモの**全階層ツリー**を表示する。見出しが単独でも省略しない。
- 各階層は個別に**折りたたみ／展開**できる。
- **Expand all / Collapse all** をツリー上部の**スクロール後も見える位置に固定**する。
- インデントは浅めで、深い階層でも表示幅を圧迫しない。
- 章・節、Paragraph Group、各メモをドラッグで並び替える。章節は子孫ごと、Paragraph Groupは中のメモごと移動する。
- Subsectionを別の親Sectionへ、Paragraph Groupを別のSectionへ、メモを別Paragraph Groupへ移動できる。未配置メモを新たに配置できる。
- 不正な階層構造、親子循環、メモの多重配置は許可しない。メモの移動先では**コピーでなく移動**が基本。
- 各メモはOutline内で**直接本文を開いて編集**できる。右Note Editorでの編集もでき、どちらも同じMarkdown本文に反映される。
- `Unassigned`一覧を持ち、まだ原稿に組み込まれていないメモを表示する。

### 4.1 Manuscriptプレビュー

- 独立タブではなくOutline中央の **Open Manuscript** ボタンで開く。
- 中央ペインを**Outline（左）／Manuscript（右）**に横分割する。右Note Editorペインには表示しない。
- 分割プレビューを閉じる操作、Manuscriptの**全画面表示**を提供する。
- プレビューは原則読み取り専用。章節やParagraphのD&D、Note編集の結果を再生成して反映する。
- 原稿はMarkdownコピー／エクスポート可能。Word内での引用フィールド化や完全な書式編集は対象外。

## 5. Cards と Global Cards

- Cardsは現在Workspaceのメモを**正方形カードのレスポンシブグリッド**で表示する。リスト表示は不要。
- タイトル・本文抜粋・タグを表示し、メモ検索と並び替え（作成順・逆順・タイトル）を提供する。
- グループ化はタグ別／Outline所属別／グループなしから選ぶ。複数タグのメモは複数表示されても**同一データ実体**を指す。
- カードを**クリックすると、その直下（次の行に全幅）に本文全体を展開**し、Markdownで編集できる。再クリックまたは閉じる操作で折りたたむ。複数表示されるメモはクリックした位置だけを展開し、編集は同一データ実体に反映する。展開中のメモは、編集で検索条件から外れても折りたたむまで表示を維持する。
- **Outlineフィルタ**でAll、Unassigned、章、節を指定する。親章選択は子節の所属メモも含む。検索・グループ化と併用可能。
- 上部の **Search all workspaces** では登録済みWorkspaceを横断検索。結果に所属Workspaceを示す。クリックで元Workspaceへ移動できる。
- 別Workspaceへの再利用は**独立したコピー**（新しいメモID）で行い、Workspaceをまたぐ生きた参照リンクを自動生成しない。

## 6. Referenceと引用

- **Referenceは独立したメインタブ**。右Note Editorや左SectionsにReference切替タブを置かない。
- WorkspaceごとにZotero等からエクスポートしたBibTeX（`.bib`）を参照し、著者、年、タイトル、引用キー、DOI等で検索する。
- BibTeXは原則外部管理・読み取り専用とし、再読込・解析エラー・引用キー重複を扱う。
- Note Editorまたは右クリックなどから引用検索ダイアログを開き、**選択中のメモ本文のカーソル位置**へ`[@CitationKey]`を挿入する。
- BibTeX引用構文とWikiLinkは別物として扱う。Manuscriptに`[@CitationKey]`を保持する。

## 7. Settings / Vault Locations

- **Search all workspacesのすぐ右**に歯車アイコンのSettingsボタンを表示する。
- Settingsの **Vault Locations** で各Workspaceの現在参照先ディレクトリを一覧・変更できる。
- `Browse…`から**Windows標準フォルダー選択ダイアログ**を開き、絶対パスを取得する。パス直接入力を許すなら存在・アクセス権・形式を検証する。
- Saveで保存しアプリ再起動後も維持する。Cancelは未保存変更を破棄する。
- 参照先変更時、元Vaultを**自動移動・上書き・削除しない**。未保存編集の確認、新パスの妥当性、Vault構造の検証を行い、無効なパスなら旧参照先を保つ。
- Windowsアプリでのパス解決はElectron Main等の権限ある層で行う。HTMLモックの`Browse…`はブラウザ制約によりフォルダー名のみ得られる場合があり、本実装のパス選択機能ではない。

## 8. ドメインモデルと本文ルール

### 8.1 Markdownメモ

- メモは**1件につき1つの独立`.md`ファイル**。先頭行は`# メモタイトル`、以下が本文。
- 新規作成では**タイトルと本文（Markdown）を別の欄**で入力する。タイトルは保存時に先頭のH1になる。タイトルが不正または重複しているときは、入力を保持したまま拒否する。
- タイトルは**同一Workspace内で一意**。異なるWorkspace間の同名は許可。新規作成・改名時に重複を拒否する。
- メモの不変内部IDを保持し、リネームやファイル移動で参照整合性を失わない。
- タグ、作成・更新時刻、アーカイブ状態などの付帯情報は人間可読なWorkspaceメタデータ等に保存する（DESIGN）。
- 本文のWikiLinkは`[[メモタイトル]]`。`[[`入力時に同Workspace内タイトルを補完し、クリックで移動、被リンク一覧を提供する。
- タイトル改名時には**参照元のWikiLinkを更新**。本文のコードブロック等にある単なる文字列を誤って置換しない。リンク切れを検知する。
- アーカイブは非破壊で復元可能。削除とは区別し、削除には確認とUndo/復旧手段を用意する。

### 8.2 Outline構造

- `Document → Section（章・節、入れ子可）→ Paragraph Group → Note`が基本。Sectionの中にParagraph Groupと子Sectionを順序付きで配置できる。
- Paragraph Groupは**順序付きメモの集合であり、原稿上は1段落**として出力する。段落タイトルは原稿に出力しない。
- 1つのメモが原稿構造の複数箇所を占めることはない。移動操作は既存位置から外して新位置へ配置する。Canvas上の参考表示はこの原則と区別する。
- 章節とParagraph Groupの順序を**明示的に保存**する。Canvas AllのXY位置は原稿順序に影響しない。
- 未配置メモは存在可能で、CardsとCanvas All、OutlineのUnassignedで閲覧・移動できる。
- DESIGN: 全原稿階層は`structure.json`等の**単一の正本**に保存。`outline.md`を出力する場合は派生ファイルとし、双方向同期はMVP対象外。

### 8.3 Manuscriptへの変換

- Section/Subsectionの見出しを**現在の自動番号付き**で出力する。章・節の見出しはOutline構造だけを正本とする。Noteの先頭H1とParagraph Groupタイトルは出力しない。
- Note本文中の**H1〜H6見出し（ATX・Setext）は出力しない**。見出し直下の本文は保持する。コード・数式・HTML内の`#`は変換しない。変換はManuscript生成時に行い、原本のメモは変更しない。
- Paragraph Groupのメモ本文を明示順で結合し、**1つの段落**とする。空メモはスキップ。
- 本文中の`[[Memo Title]]`は見せる場合に単なる`Memo Title`へ変換し、WikiLinkだけの独立行は削除する。コード・エスケープ構文を誤変換しない。
- `[@CitationKey]`は保持する。原稿に配置されていないメモは出力しない。
- 複数段落、表、ブロック数式を含むメモの自動結合はMVPでは安全側に扱う（検証・警告し、原文を破壊しない）。空白・句読点の接続方式は仕様に沿って統一する（DESIGN）。
- 最終的な`.md`をエクスポート可能にする。DOCXへの直接変換はMVPの必須機能ではない。

## 9. ファイル保存・アーキテクチャ（DESIGN）

### 9.1 技術構成

- 第一候補: **Electron + React + TypeScript + Vite**。ElectronはWindows上で独立実行するデスクトップアプリだが、Win32ネイティブウィジェット製ではない。要求の本質は**Windowsでインストール不要・オフライン・単独起動**すること。
- Windows配布: `electron-builder`等の**portable `.exe`**ターゲット。実行時に内部で一時展開する場合がある。コード署名のないEXEはSmartScreenの警告対象となり得る。
- `Main`: VaultファイルI/O、設定永続化、OSダイアログ、ファイル監視、書出し。`Preload`: 限定された型付きIPC。`Renderer`: UIと編集、直接的な無制限ファイルアクセスを禁止。
- `nodeIntegration: false`、`contextIsolation: true`、可能ならsandbox有効。Markdownは安全に表示してスクリプトを実行させない。
- CanvasライブラリはReact Flow、D&Dはdnd-kit、Markdown編集はCodeMirror等を比較して採用可能。バージョンを固定し、不要な外部ランタイムサービスを追加しない。
- HTTP/FastAPIサーバーはMVPで不要。クラウド提供は将来の別工程。

### 9.2 保存場所

- **研究データ本体**はユーザーが指定したWorkspace/Vaultディレクトリに保持する。任意の外部Gitによる履歴管理を妨げない。FACET内のGit操作機能は不要。
- **Workspace登録一覧・Vaultパス**などのアプリ設定はWindowsユーザープロファイル下のアプリデータに保存する。ポータブルEXEを移動しても設定を失わない。
- DESIGN（例）:

```text
<Vault>/
  project.yml                 # Workspace ID、名称等
  notes/<note-id>.md           # タイトルH1＋本文
  notes-index.json            # ID、相対パス、タグ、日時、アーカイブ等
  structure.json              # 原稿構造の唯一の正本
  canvas-state.json           # 単一CanvasのXY座標・表示状態
  references/library.bib      # Zotero等からエクスポート
  exports/manuscript.md       # 派生ファイル（任意）
```

- `project.yml`や`notes-index.json`の採用は提案だが、**Markdownメモの可搬性**、原稿階層の単一正本、ビュー状態の分離を守ること。
- 検索索引はSQLite FTS5等の再生成可能キャッシュでよい。本文・構造ファイルの代わりにキャッシュを唯一の正本としない。
- ファイル書込みは一時ファイルとatomic rename/復旧情報を活用。タイトル改名で複数Markdownを更新する際は失敗時のロールバック/復旧を設計する。
- 外部編集が競合した場合、**黙って上書きしない**。アクセス権限、パス境界、シンボリックリンク/ジャンクション等を考慮し、任意パス読み出しをIPC経由で許さない。
- Workspace横断検索の日本語・英語を考慮する。目安として1 Workspace約1,000メモ、約10 Workspaceで操作性を検証（目標値はDESIGN）。

## 10. MVPで明示的に実装しないもの

- Wordにおける本格WYSIWYG編集、ZoteroのWordフィールド自動生成。
- FACET内部のGit/GitHub操作、認証付きクラウド同期、クラウドWeb版。
- 複数Canvasの作成・切替UI（Workspaceごとに1枚）。
- Cardsのリスト表示、左ペインのParagraph/Noteツリー、左右ペインのReference切替。
- Manuscriptの独立メインタブ、右Note Editor内のManuscript表示。
- ライトテーマ切替やWindows 2000風スキン。
- `outline.md`からの自動双方向同期、複雑な論文出版ワークフローの全自動化。

## 11. 受け入れテスト（必須）

| ID | 対象 | 合格条件 |
|---|---|---|
| UI-01 | 共通ヘッダー | `FACET`＋展開形、4タブ、Search、右隣のSettings歯車。Workspace切替は左ペインのSectionsの上。 |
| UI-02 | 3ペイン | タブ切替時に左・右の展開時幅／境界位置が変わらない。左右開閉は独立、閉時に復元ボタンが残り中央が拡張。 |
| UI-03 | 右ペイン | すべてのタブでNote Editor専用。Reference／Manuscriptの右ペインタブがない。 |
| UI-04 | Canvas Tools | Canvas中央ペイン最上部のみに表示。他タブや全幅ヘッダー、下部に表示しない。 |
| UI-05 | Canvas操作 | 背景パン、カーソル基準ズーム、全体表示、100%、選択Groupフィットが機能。 |
| UI-06 | Canvas表示 | AllではGroup自由配置とUnassigned独立カード。章節選択では該当範囲の自動ツリー。移動でOutlineの順序を変えない。 |
| UI-07 | Canvas本文 | Group内とUnassignedのNote本文プレビューが約5行で切れる。タイトルを表示し、クリックでカード直下に全文を展開・編集、ダブルクリックで右Note Editor。 |
| UI-08 | Outline階層 | 1つしかない章節も表示。自動採番が変更に追従。折りたたみと固定の一括開閉が使える。 |
| UI-09 | Outline D&D | 章節・Paragraph・Noteの移動と順序変更、親変更が可能。循環・多重配置を作らない。 |
| UI-10 | Inline Note編集 | Outline内でメモ本文を開いて編集し、右Note Editorやプレビューに反映される。 |
| UI-11 | Manuscript | Outline中央のOpen Manuscriptで中央左右分割、閉じる、全画面。独立タブなし。 |
| UI-12 | Cards | 正方形Grid、検索、タグ別/Outline別グループ化、章・節/Unassigned絞り込みが機能。クリックで直下に全文を展開・編集し、展開中も検索・並べ替え・グループ化が機能。 |
| UI-13 | Reference | メインReferenceタブでBibTeX検索、カーソル位置への引用挿入。左右にReferenceタブなし。 |
| UI-14 | Settings | Search右の歯車からVault Locationsを開く。WorkspaceごとにBrowseで絶対パス取得、Save/Cancel、再起動後復元。 |
| UI-15 | 新規メモ | タイトルと本文（Markdown）を別欄で入力して作成。タイトルはH1で保存。不正・重複タイトルは入力を保持したまま拒否。 |
| UI-16 | 展開編集の同期 | Cards／Canvasの展開編集が右Note Editor・Outline・`.md`と同期。Autosave、競合検出、未保存ドラフト、WikiLink、引用挿入が機能し、Canvasのドラッグ・パン・ズームと競合しない。 |
| DAT-01 | メモ一意 | 同Workspaceの重複タイトルを拒否、別Workspaceでは同名許容。 |
| DAT-02 | WikiLink | `[[Title]]`解決・補完・Backlinks、改名時の参照更新、壊れたリンク検知。 |
| DAT-03 | Paragraph | 複数Noteを指定順で1段落化し、H1/Paragraphタイトルと本文中の見出しを出力しない。見出し直下の本文と引用は保持。 |
| DAT-04 | 配置一意 | メモをParagraph AからBへ動かしても構造内に1回しか現れず、Unassignedは原稿に入らない。 |
| DAT-05 | 保存・競合 | 再起動でVault・Outline・Canvas座標・Settingsを復元。外部編集を無言上書きしない。 |
| DAT-06 | Vault保護 | 無効な参照先変更を拒否し、元Vaultを移動・削除・上書きしない。 |
| WIN-01 | Windows実行 | Windows 11 x64でポータブルEXE単独起動。ランタイム・WSL・Webサーバー・ブラウザの別途導入なし、オフラインで作成・保存・再読込。 |
| WIN-02 | 配布更新 | EXEを別フォルダーへ移動・再配置しても既存Vaultと登録設定を破壊しない。 |

## 12. Claude Codeに対する開発手順

1. **最初はPlan Mode**で本書とモックを読み、曖昧点と実装提案を整理し、`docs/IMPLEMENTATION_PLAN.md`の計画を提示する。設計合意前に大量のコードを実装しない。
2. 推奨Phase: **(1) Electron基盤・ドメインモデル・Vault I/O → (2) Outline/Paragraph/原稿生成 → (3) Canvas → (4) Cards/検索/WikiLink → (5) Reference/Settings/ポータブル配布 → (6) 統合試験・品質改善**。依存関係で分割し直してよい。
3. 各Phaseの最後に型検査、Lint、自動テストを実行。データ整合性のテストをGUI装飾より優先する。完了時に変更ファイルと未実装要件を報告し、次のPhaseへ無断で進まない。
4. `CLAUDE.md`に本書が正本であること、モック参照パス、技術上のガードレールを記載する。Gitコミットは小さく保つ。Codexの独立レビューは別工程として実施可能。
5. **モックの疑似データやlocalStorageによるVaultパス保存は本番の永続化方式として採用しない。** Settingsのパス選択はWindows OSダイアログを使用する。
6. 最終的にWindows上でportable EXEをビルド・動作確認。WSLでのみ動作することは合格としない。

---

### 補足：実装者が提案してよい未確定事項

- 正本の具体的なJSONスキーマ、メタデータの形式、Canvas表示状態ファイルの拡張子。
- Markdown記法の例外処理（複数段落や数式）、空白・句読点の自動結合ルール。
- 安全なUndo/Redoと複数ファイル更新のトランザクション方式。
- 複数Canvas・高度なVisual Groupなどの将来拡張に向けた内部抽象化。

これらは確定済みの画面・操作・データ一意性・可搬性要件を変更しない範囲で設計し、判断を記録すること。
