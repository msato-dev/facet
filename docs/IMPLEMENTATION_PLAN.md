# FACET 実装計画（承認済み 2026-11-08）

## Context

- リポジトリには `docs/SPEC.md`（v3.0、作業ツリーで未コミット）と `docs/mock/FACET_interactive_mock.html`（v1.3）しかない。コードはまだない。
- SPEC v3.0 を唯一の正本、モックを UI・操作体系の基準として、Windows 11 x64 向けのポータブル Electron アプリを新規に作る。
- 今回の成果物は計画だけ。SPEC §12-1 に従い、承認後に本計画を `docs/IMPLEMENTATION_PLAN.md` と `CLAUDE.md` として保存してから Phase 1 に入る。
- **REQ は変更しない**。以下で「推奨」と書いたものは、すべて SPEC が DESIGN／未確定事項として実装者に任せている範囲。

### 承認直後の作業（Step 0）

1. 作業ツリーの変更 `docs/SPEC.md`（v2.1 から v3.0 への全面整理）をコミットする。
   メッセージ: `docs: consolidate SPEC.md into standalone v3.0 specification`
   （ブランチは現在の `master`。Plan Mode 中はコミットできないため、承認後に最初に行う。）
2. 本計画を `docs/IMPLEMENTATION_PLAN.md` として保存する。決定記録を `docs/DECISIONS.md`（ADR 形式）として作る。
3. `CLAUDE.md` を作る。内容は、正本が SPEC.md であること、モックのパス、セキュリティ上のガードレール、Phase ごとの品質ゲート、モックの擬似データや localStorage を本番方式にしないこと。

---

## 1. モック分析から得た「本番で変える点」

モックの挙動のうち、SPEC に照らして本番では採用しないもの。

| モックの実装 | 本番での扱い（SPEC根拠） |
|---|---|
| `paragraphs[]` が平坦な配列で、`section` フィールドで所属を表す。子 Section と Paragraph Group（以下 PG）の順序が混在できない | Section の `children` を順序付きの配列として明示的に持つ（§8.2） |
| Section が 2 階層固定（`subs`） | 任意の深さに入れ子できる木にする。UI は 3 階層（章・節・項）まで検証する（§8.2「入れ子可」） |
| 引用を本文の末尾に追記する | CodeMirror のカーソル位置に挿入する（§6） |
| 改名時の WikiLink 更新が `split/join` による単純置換 | Markdown AST を使い、コードブロック・インラインコード・エスケープを除外して置換する（§8.1） |
| Vault パスを localStorage に保存し、Browse はフォルダー名しか取れない | Main プロセスの `dialog.showOpenDialog` で絶対パスを取り、userData に保存する（§7, §12-5） |
| 右ペインに Reference/Manuscript タブの残骸（`inspectorTab`、`manuscriptPanelHTML`）がある | 実装しない。右ペインは Note Editor 専用（§2.1, UI-03） |
| `state.canvases` で複数 Canvas を持つ | 内部の抽象としてだけ残し、UI は 1 枚にする（§3.2, §10） |
| Ctrl+S で保存 | 自動保存（入力停止 500ms 後とフォーカス喪失時）。Ctrl+S は即時フラッシュとして残す |

モックから**そのまま継承する**もの:
- 3 ペインの配置、ナビ行の順序
- 左ペインの開閉: 閉じると幅 30px のレールと復元ボタンが残る
- Canvas Tools の並び: New/Copy/Paste/Group/Select/Delete/Archive と Citation
- Fit all/100%/Fit group と、カーソルを中心にしたズーム（係数 1.11、範囲 0.1〜4）
- Outline D&D のドロップ判定: 上 25% は before、中央 50% は inside、下 25% は after
- Outline 上部に sticky 固定する Expand all/Collapse all
- Open Manuscript による中央の分割（Outline 51%、Manuscript 49%）と全画面モーダル
- Cards の正方形グリッド: `minmax(155px,1fr)`、`aspect-ratio:1/1`
- Global Search は中央に結果を表示し、所属 Workspace を示す。クリックで元の Workspace へ移動する
- v1.2/1.3 の配色トークン（`--bg:#17171b`、`--accent:#a78bfa` など）。v1.1 の Win2000 風の層は取り込まない

---

## 2. 実装アーキテクチャ

### 2.1 技術スタック（推奨と理由）

| 領域 | 推奨 | 理由 |
|---|---|---|
| シェル | Electron（最新安定版を固定）+ **electron-vite** | Main/Preload/Renderer を Vite で 1 つの設定にまとめてビルドできる。SPEC §9.1 の第一候補 |
| UI | React + TypeScript (strict) | SPEC の第一候補 |
| 状態管理（Renderer） | Zustand | 軽量で、ドメインのスナップショットと UI 状態を分けて持ちやすい |
| Canvas | **@xyflow/react (React Flow)** | パン、カーソル基準のズーム、`fitBounds`/`setViewport`、可視範囲だけの描画が標準で揃う。カスタムノードで PG とメモカードを描画する |
| D&D | **dnd-kit** | Outline のツリー並べ替えと Canvas の PG 内のメモ移動に使う。キーボード操作にも対応できる。React Flow のノード内では `nodrag` クラスで競合を避ける |
| エディター | **CodeMirror 6** | カーソル位置への挿入、`[[` 補完、Markdown ハイライト、テキスト専用の Undo が揃う。右 Note Editor と Outline インラインの両方で同じコンポーネントを使う |
| Markdown 解析 | unified / remark-parse（+ remark-gfm, remark-math） | 位置情報付きの AST が得られる。WikiLink 置換で code/inlineCode/math を除外でき、Manuscript 結合の安全判定もできる |
| 表示サニタイズ | rehype-sanitize | 生 HTML とスクリプトを実行させない（§9.1） |
| BibTeX | `@retorquere/bibtex-parser` | Zotero/Better BibTeX の出力に強い純 JS。ネイティブ依存がない |
| 検索 | **MiniSearch（メモリ内、Main で保持）**。トークナイザーは英語を単語単位、CJK を 2-gram に分ける | 想定規模（約 1 万メモ）ならメモリ内で十分速い。SQLite FTS5 は better-sqlite3 などのネイティブモジュールになり、portable EXE の ABI 再ビルドの手間がかかるため見送る。索引は再生成できるキャッシュとして扱う（§9.2） |
| ファイル監視 | chokidar | Windows で安定している。自分が書いた直後のイベントは書込みトークンで無視する |
| スキーマ検証 | zod | JSON/YAML の読込みと IPC 引数の検証を同じ定義で行う |
| YAML | `yaml` | `project.yml` を人が読める形に保つ |
| ID | ULID | 時系列で並べられ、衝突しにくい |
| 配布 | electron-builder の `portable` (win x64) | SPEC §9.1 の指定 |
| パッケージ管理 | npm | electron-builder と最も相性がよい |

すべての依存は exact バージョンで固定する（`save-exact=true`）。実行時に外部サービスへ通信しない。

### 2.2 プロセス構成と責務

```
Renderer (React, sandbox)          Preload (contextBridge)        Main (Node)
 ├─ views: Canvas/Outline/Cards/    window.facet.*  ── 型付きIPC ─→ ├─ ipc/handlers (zod検証)
 │  Reference/Settings/Search                                      ├─ WorkspaceService (正本・単一ライター)
 ├─ NoteEditor (CM6)                                               │   ├─ applyCommand → shared/domain
 ├─ store: domainSnapshot + uiState                                │   ├─ UndoStack
 └─ 呼ぶのは commands と queries だけ ←── events (changed/conflict) ┤   └─ VaultRepository (fs, atomic, journal)
                                                                   ├─ SettingsStore (userData/settings.json)
shared/ (純TS、Node/DOM非依存) ← Main と Renderer の両方が import    ├─ Watcher (chokidar)
                                                                   ├─ SearchIndex (MiniSearch)
                                                                   └─ Dialogs / Export
```

- **Main が正本を持ち、書き込むのも Main だけ**にする（推奨）。
  - Renderer は `executeCommand(wsId, cmd)` を送る。
  - Main は `shared/domain` の純関数で不変条件を検査してから適用し、永続化する。結果として新しいスナップショットか差分を返す。
  - 理由: 競合検知、トランザクション、Undo、外部変更の取込みを 1 か所に集約できる。ローカル IPC の遅延は数 ms で、操作性への影響はない。
- **本文の編集**: CM6 の Undo/Redo は CM6 自身が持つ。保存はデバウンスして `note.updateBody` コマンドで送る。
- **構造と改名などの Undo/Redo**: Main の UndoStack が持つ。各コマンドは逆操作を生成する。
- **セキュリティ**:
  - `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`
  - 厳格な CSP: `default-src 'self'`
  - `will-navigate` と `setWindowOpenHandler` は拒否する
  - IPC はファイルパスを受け取らない。受け取るのは `workspaceId` と `noteId` だけにする
  - Settings でパスを直接入力した場合だけ Main で検証する
  - Vault 内のパス解決は `realpath` で Vault ルート配下にあることを確認し、シンボリックリンクとジャンクションによる脱出を拒否する

### 2.3 コマンド（ドメイン操作）一覧

すべて `shared/domain/commands.ts` の純関数 `(state, cmd) => Result<{state, inverse, effects}>` として書く。effects は Main が書き込むファイルの一覧。

- **メモ**: `note.create` / `note.rename` / `note.updateBody` / `note.setTags` / `note.archive` / `note.unarchive` / `note.trash` / `note.restore` / `note.duplicate` / `note.copyToWorkspace`
  - `note.rename` は WikiLink の連鎖更新を含み、複数ファイルを更新するトランザクションになる
  - `note.copyToWorkspace` は新しい ID で独立したコピーを作る（§5）
- **構造**: `section.create` / `section.rename` / `section.move` / `section.delete`、`group.create` / `group.rename` / `group.move` / `group.delete`、`note.place` / `note.unplace` / `note.move`
- **Canvas**: `canvas.setGroupPos` / `canvas.setNotePos` / `canvas.setGroupExpanded` / `canvas.setViewport`
  - Canvas の座標は構造に影響しない（§3.2）
  - viewport は Undo の対象外

構造の**不変条件**は `validateStructure()` が全コマンドの後に検査する。

- 循環がない
- メモの配置は最大 1 か所
- PG の親は Section か、未配置プールのどちらか
- 参照される ID がすべて存在する
- 既存位置から外して新位置へ移すことを保証する

---

## 3. データモデル

### 3.1 Vault レイアウト（SPEC §9.2 の例をそのまま採用し、内部ディレクトリを追加）

```text
<Vault>/
  project.yml              # schemaVersion, workspaceId(ULID), name, createdAt
  notes/<note-id>.md       # 1行目 "# Title"、以下本文。フロントマターなし
  notes-index.json         # メモのメタデータ
  structure.json           # 原稿構造の唯一の正本
  canvas-state.json        # Canvas表示状態（構造とは分離）
  references/library.bib   # 外部管理・読み取り専用
  exports/manuscript.md    # 派生
  .facet/journal/          # 複数ファイル更新の先行書込みジャーナル
  .facet/trash/            # 削除メモの退避先（復元可）
```

### 3.2 スキーマ（zod で定義し、`schemaVersion` でマイグレーション）

```ts
// notes-index.json
{ schemaVersion: 1,
  notes: { [noteId]: { file: "notes/<id>.md", tags: string[], createdAt: ISO, updatedAt: ISO,
                       archived: boolean, contentHash: string } } }
// タイトルは .md の H1 が正本。index には持たない（二重管理を避ける）

// structure.json
{ schemaVersion: 1,
  root: { children: SectionNode[] },                 // Document
  unplacedGroups: GroupNode[] }                      // Section未所属のPG（推奨・後述）
type SectionNode = { kind:"section", id, title, children: (SectionNode|GroupNode)[] }
type GroupNode   = { kind:"group", id, title, noteIds: NoteId[] }
// 番号は保存しない。ツリー順から計算する（§2.3）

// canvas-state.json
{ schemaVersion: 1,
  canvases: [{ id:"main", name:"Main Canvas",
    viewport:{x,y,zoom},
    groups:{ [groupId]: {x,y,expanded} },
    looseNotes:{ [noteId]: {x,y} } }] }
// canvases は配列にしておき、将来の複数Canvasに備える。UIは [0] 固定

// <userData>/settings.json   （app.getPath('userData')。EXE の場所に依存しない → WIN-02）
{ schemaVersion: 1,
  workspaces: [{ id, name, vaultPath }],
  lastWorkspaceId, panes:{leftOpen,rightOpen},
  window:{bounds,maximized} }
```

### 3.3 ドメイン規則についての推奨（SPEC の未確定事項）

| 論点 | 推奨 | 理由 |
|---|---|---|
| タイトルの一意性の比較 | NFC 正規化し、大文字小文字を区別せず、前後の空白を除いて比較する | モックも大文字小文字を区別しない。WikiLink 解決の曖昧さをなくすため |
| タイトルの禁止文字 | `[[`、`]]`、`|`、`#`、改行、空文字を拒否する | WikiLink の構文と衝突させないため |
| WikiLink の別名 | `[[Title|Alias]]` を解析する。解決は Title で行い、Manuscript には Alias を出す | Obsidian の利用者が書きがちな記法を壊さないため。REQ の `[[Title]]` はそのまま |
| アーカイブされた配置済みメモ | アーカイブ時に構造から外し、元の位置を `lastPlacement` として index に記録する。解除すると未配置に戻り、元の位置へ戻す操作を提示する | 原稿に見えないメモが残る状態を作らないため。DAT-04 の一意性を保ちやすい |
| Section 未所属の PG | `unplacedGroups` として許可する。Canvas All と Outline の Unassigned に表示し、Manuscript には出さない | Canvas All でまず Group を作ってから章に割り当てる、という操作を自然にするため。モックは常に章に割り当てるが、REQ には反しない |
| 削除 | 確認ダイアログの後、`.facet/trash/` へ移動する。トーストの Undo と「Trash から復元」を用意する | §8.1 が求める「削除と区別・Undo/復旧」を満たすため |
| 見出しレベル | 深さ d の Section は `#`×d（6 で打ち切り）。番号は `4.`、`4.1.`、`4.1.2.` の形式 | モックの出力（章 `#`、節 `##`）を踏襲する |
| メモの結合 | 各メモの本文を trim して結合する。境界の両側が CJK 文字か全角句読点なら空白なし、それ以外は半角空白 1 つでつなぐ。メモ内の単一改行（ソフト改行）も同じ規則で 1 行にする | 日本語と英語の混在を自然に結合するため |
| 安全側の扱い（§8.3） | メモに複数段落、表、ブロック数式、リスト、コードブロック、見出しが含まれる場合はそのメモを結合しない。段落を区切ってから原文のブロックをそのまま出力し、Manuscript パネルに警告一覧を出す | 原文を破壊せず、利用者が気付けるようにするため |
| WikiLink だけの行 | 削除する。コードブロック内は対象外 | §8.3 の通り |

### 3.4 永続化・競合・トランザクション

- **単一ファイルの書込み**:
  1. `<file>.facet-tmp` に書いて fsync する
  2. `rename` で置き換える。Windows で EPERM/EBUSY が出たときは指数バックオフで最大 5 回まで再試行する（ウイルス対策ソフトや検索インデクサーによるロック対策）
- **複数ファイルの更新**（改名による WikiLink の連鎖更新など）:
  1. すべての一時ファイルを書く
  2. `.facet/journal/<txid>.json` に「元ファイルの退避先」と「置換対象」を記録する
  3. 元ファイルを退避してから、置換を順に実行する
  4. ジャーナルを削除する
  - 起動時にジャーナルが残っていたら、退避ファイルから**ロールバック**する。ロールフォワードより予測しやすいため
- **外部編集の競合**:
  - 読込み時の `mtime+size+contentHash` を覚えておき、書込み直前に再確認する
  - 外部で変更されていたら書き込まない。Renderer に `conflict` を通知し、「外部版を読み込む」「自分の版を別メモとして保存」「比較」から選ばせる（DAT-05）
  - chokidar が外部変更を検知した場合、未保存の編集がなければ自動で再読込みする。あれば競合 UI を出す
- **整合性の照合**（起動時と監視時）:
  - `notes/` にあって index にない `.md` は新規メモとして取り込む
  - index にあってファイルがないものは「欠損」として表示する
  - H1 のないファイルは、ファイル名をタイトルの候補として警告する
- **BibTeX**:
  - 読み取り専用。監視して再読込みする
  - 解析エラーは行番号付きで一覧にする。引用キーの重複は警告し、先に出たものを採用する

### 3.5 Settings / Vault Locations の検証（§7, DAT-06）

- パスの変更を受け付けたときの検証:
  - 絶対パスである
  - 存在する
  - 読み書きできる（試験ファイルの作成と削除で確認）
  - `project.yml` がある
  - その `workspaceId` が対象の Workspace と一致する
- どれか 1 つでも満たさなければ拒否し、旧パスを保つ。元の Vault は移動・上書き・削除しない。
- 対象 Workspace に未保存の編集があれば、先にフラッシュするか確認する。
- **推奨（SPEC に記載がない）**: Settings に「Add workspace…」と「Remove from list」を置く。
  - Add: 空のフォルダーなら新しい Vault として初期化し、既存の Vault なら登録する
  - Remove: 登録を解除するだけで、ファイルには触れない
  - 理由: Workspace を作る導線が SPEC にないため。ファイルを壊さない操作に限ることで REQ との衝突を避ける

---

## 4. ディレクトリ構成

```text
facet/
  CLAUDE.md
  package.json  electron.vite.config.ts  electron-builder.yml
  tsconfig.json tsconfig.node.json tsconfig.web.json
  eslint.config.js  .prettierrc  vitest.config.ts  playwright.config.ts
  docs/  SPEC.md  mock/  IMPLEMENTATION_PLAN.md  DECISIONS.md  TEST_MATRIX.md
  src/
    shared/                     # 純TS: Node/DOMを import 禁止（ESLintで強制）
      domain/  types.ts ids.ts structure.ts commands.ts invariants.ts numbering.ts titles.ts
      markdown/ wikilink.ts rename.ts manuscript.ts join.ts
      search/  tokenizer.ts
      bib/     normalize.ts
      ipc/     contract.ts      # IPCチャンネルとzodスキーマの単一定義
    main/
      index.ts  window.ts  security.ts
      ipc/handlers.ts
      workspace/ WorkspaceService.ts UndoStack.ts
      vault/   VaultRepository.ts atomic.ts journal.ts pathGuard.ts reconcile.ts schemas.ts
      settings/ SettingsStore.ts vaultValidation.ts
      watch/   Watcher.ts
      search/  SearchIndex.ts
      bib/     BibLoader.ts
      export/  manuscriptExport.ts
      testHooks.ts              # FACET_E2E 時のみ dialog をスタブ化
    preload/ index.ts
    renderer/
      index.html main.tsx App.tsx
      theme/ tokens.css         # モックv1.2/1.3の配色トークン
      store/ domain.ts ui.ts
      shell/ NavBar.tsx ThreePane.tsx LeftPane.tsx RightPane.tsx PaneToggle.tsx
      sections/ SectionsTree.tsx WorkspaceSwitcher.tsx
      editor/ NoteEditor.tsx CodeMirrorField.tsx wikilinkCompletion.ts citationInsert.ts
      canvas/ CanvasView.tsx CanvasTools.tsx GroupNode.tsx LooseNoteNode.tsx treeLayout.ts viewport.ts
      outline/ OutlineView.tsx OutlineTree.tsx InlineNoteEditor.tsx ManuscriptSplit.tsx
      cards/  CardsView.tsx CardGrid.tsx
      search/ GlobalSearchView.tsx
      reference/ ReferenceView.tsx CitationDialog.tsx
      settings/ SettingsDialog.tsx
  tests/
    unit/          # shared/ の単体テスト + property-based
    integration/   # main/ を一時ディレクトリで実行
    component/     # React Testing Library
    e2e/           # Playwright _electron、受け入れテストIDごと
    fixtures/vaults/  # zao, chamber（モックのデータを Vault 化したもの）
```

---

## 5. Phase 別実装計画

各 Phase の終わりには `npm run typecheck && npm run lint && npm test` を通し、その Phase の E2E も実行する。そのうえで変更ファイル、未実装の要件、決定事項を報告して停止する。次の Phase へは承認なしに進まない（§12-3）。

### Phase 1 — 基盤・ドメインモデル・Vault I/O
- electron-vite と electron-builder の雛形、セキュリティ設定、ESLint/Prettier/Vitest/Playwright を用意する。
- `shared/domain` を実装する: 型、コマンド、不変条件、番号付け、タイトル規則。
- `VaultRepository` を実装する: 読込み、atomic 書込み、ジャーナル、照合、pathGuard。`SettingsStore` も作る。
- 最小限のシェルを作る: ナビ行、左右ペインの開閉、Workspace 切替、Sections ツリー、右 Note Editor（CM6 による本文編集と保存）。
- 開発用に最小限の Workspace 登録を入れる（フォルダー選択で追加）。
- **リスク低減**: この時点で Windows 上で portable EXE をビルドし、起動・保存・再読込みを試す（WIN-01 の早期確認）。
- 対象テスト: DAT-01、DAT-05（一部）、UI-01、UI-02、UI-03

### Phase 2 — Outline / Paragraph / Manuscript
- Outline の全階層ツリー、個別と一括の開閉（sticky）、dnd-kit による D&D、Unassigned。
- インラインのメモ編集。右 Note Editor と同じ CodeMirror コンポーネントを使い、同じストアに反映させる。
- `manuscript.ts` と `join.ts`、警告の生成。分割プレビュー、閉じる、全画面、Copy、`.md` エクスポート。
- 構造操作の Undo/Redo。
- 対象テスト: UI-08、UI-09、UI-10、UI-11、DAT-03、DAT-04

### Phase 3 — Canvas
- React Flow を導入する。All 表示: PG と未配置カードの自由配置、パンくず表示、5 行のプレビュー、展開と折りたたみ。
- 章節を選んだときの自動ツリーレイアウト（`treeLayout.ts` は純関数として書き、テストする）。
- Fit all、100%（表示中心を保つ）、Fit group、カーソル基準のズーム、±ボタン。
- Canvas Tools: New/Copy/Paste/Group/Select/Delete/Archive/Citation。右クリックメニュー。
- PG 内のメモの並べ替えと所属変更を構造コマンドに流す。座標を `canvas-state.json` に保存する。
- 対象テスト: UI-04、UI-05、UI-06、UI-07

### Phase 4 — Cards / 検索 / WikiLink
- Cards: 正方形グリッド、検索、並べ替え、グループ化（タグ／Outline／なし）、Outline フィルター（親章は子孫を含む）。
- `SearchIndex` と CJK 2-gram トークナイザー。Search all workspaces の結果表示と、クリックでの Workspace 移動。別 Workspace へのコピー。
- WikiLink: `[[` 補完、クリックで移動、Backlinks、リンク切れの検知、改名時の AST 安全な連鎖更新（トランザクション）。
- 対象テスト: UI-12、DAT-02

### Phase 5 — Reference / Settings / ポータブル配布
- BibTeX の読込み、監視、エラーと重複の表示。Reference タブでの検索。Citation ダイアログからカーソル位置への挿入。
- Settings / Vault Locations: Browse（OS のダイアログ）、パスの直接入力の検証、Save/Cancel、再起動後の復元、Add/Remove workspace。
- electron-builder portable の最終設定: アイコン、`productName: FACET`、userData の場所を固定する。
- 対象テスト: UI-13、UI-14、DAT-06、WIN-02

### Phase 6 — 統合試験・品質改善
- 性能: 10 Workspace × 1,000 メモの合成 Vault で、起動、検索、Canvas 描画、Outline の D&D を計測する。目標は検索 100ms 未満、タブ切替 200ms 未満（DESIGN の目標値）。
- アクセシビリティ: 閉じたペインの中身にフォーカスが移らないこと、キーボードで D&D できること。
- 全受け入れテストを Windows 11 実機と Windows CI で実行する。WIN-01 の手動チェックリスト。

---

## 6. 自動テスト戦略

| 層 | ツール | 主な対象 |
|---|---|---|
| 単体 | Vitest + **fast-check** | `structure`/`commands`: ランダムな操作列を適用しても循環・多重配置・ID 欠損が起きないこと（property-based）。番号付け、タイトルの一意性、WikiLink の解析と改名（コードフェンス、インラインコード、`\[[`、数式内を変えない）、Manuscript のゴールデンファイル（日本語と英語の結合、警告ケース）、トークナイザー、BibTeX の正規化と重複 |
| 統合 | Vitest (Node) + 一時ディレクトリ | atomic 書込み、ジャーナル（各ステップで故障を注入し、ロールバック後の状態を検証）、外部編集の検知、シンボリックリンクとジャンクションによる脱出の拒否、照合、Settings の保存と無効パスの拒否（DAT-06）、Canvas 座標を含む再読込み |
| コンポーネント | Vitest + React Testing Library (jsdom) | ペインの開閉と隠れた要素の inert 化、Cards のフィルターの組合せ、Outline の開閉、Sections の番号表示 |
| E2E | **Playwright `_electron`** | 受け入れテスト ID ごとに 1 ファイル（`tests/e2e/UI-02.spec.ts` など）。一時 userData と fixture の Vault で起動する。UI-02 はタブ切替の前後でペイン境界の `boundingBox` を比べる。UI-05 はマウス操作の後に viewport を検証する。UI-14 と DAT-05 はアプリを終了して再起動し、復元を確認する。フォルダーダイアログは `FACET_E2E=1` のときだけ Main 側でスタブにする |
| Windows | GitHub Actions の `windows-latest` | 単体、統合、E2E、portable のビルドを実行する。ビルドした EXE を 2 つの別フォルダーにコピーして起動するスモークテスト（WIN-02）。WIN-01 は実機での手動確認 |

- `docs/TEST_MATRIX.md` で SPEC §11 の全 ID とテストファイルを 1 対 1 で対応させる。
- 優先順位はデータ整合性（DAT 系）、UI 構造（UI 系）、見た目の順にする（§12-3）。スクリーンショットの比較は任意で、最後に回す。
- ESLint の `no-restricted-imports` で、`shared/` から `electron`/`fs`/DOM を import できないようにする。Renderer から `electron`/`fs` も import できないようにする。

---

## 7. 確認したいリスク・前提

- **ビルド環境**: portable のターゲットは NSIS を使うため、WSL 上では Wine が必要になる。**Windows ネイティブか GitHub Actions の windows-latest でビルドすることを推奨**する。開発と単体テストは WSL で行ってよい。
- **未署名 EXE**: SmartScreen の警告が出る。署名は MVP の対象外とし、README に注意を書く。
- **portable の一時展開**: userData は `%APPDATA%\FACET` に置くため、EXE を移動しても設定は失われない（WIN-02）。

## 8. 検証（本計画の承認後）

- Step 0 の後に `git log -1` でコミットを確認する。`docs/IMPLEMENTATION_PLAN.md`、`DECISIONS.md`、`CLAUDE.md` が存在することを確認する。
- 各 Phase: `npm run typecheck`、`npm run lint`、`npm test`、`npm run test:e2e -- --grep <対象ID>`。
- 最終: Windows 11 実機で portable EXE を単独起動し、オフラインで作成・保存・再読込みできることを確認する。

---

## 実装状況（2026-11-08）

- Phase 1〜5 の機能を develop ブランチに実装済み。Phase 6 の自動テスト（単体・統合 45、E2E 25）と性能計測を実施済み。
- 計画からの変更点は `docs/DECISIONS.md` の ADR-021〜027 に記録（D&D は HTML5 ネイティブ、BibTeX パーサーは純 JS ビルドなど）。
- 未完了: Windows 11 実機での WIN-01/WIN-02 の手動確認（CI の windows-latest ジョブで portable EXE をビルドし、パッケージ版で E2E を実行する構成は用意済み）、コード署名。
