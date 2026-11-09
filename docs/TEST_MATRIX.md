# FACET 受け入れテスト対応表

SPEC.md §11 の各 ID と、それを検証する自動テストの対応。E2E は Playwright（`tests/e2e`）で Electron アプリを実際に起動して行う。テスト名の先頭に ID を付けている。

| ID | 対象 | 自動テスト | 備考 |
|---|---|---|---|
| UI-01 | 共通ヘッダー | `tests/e2e/shell.spec.ts` › UI-01 | 展開形、4タブ（Manuscriptなし）、Search右隣の歯車、Workspace切替がSectionsより上 |
| UI-02 | 3ペイン | `tests/e2e/shell.spec.ts` › UI-02 | タブ切替前後で境界座標が一致。左右独立開閉、30pxレール、中央拡張、閉時は内部コントロール非描画 |
| UI-03 | 右ペイン | `tests/e2e/shell.spec.ts` › UI-03 | 全タブで Note Editor のみ |
| UI-04 | Canvas Tools | `tests/e2e/canvas.spec.ts` › UI-04 | 中央ペイン最上部、左右ペインを横断しない、他タブで非表示 |
| UI-05 | Canvas操作 | `tests/e2e/canvas.spec.ts` › UI-05 | 背景パン、カーソル基準ズーム（位置ずれ < 12px）、Fit all、100%、±、Fit group |
| UI-06 | Canvas表示 | `tests/e2e/canvas.spec.ts` › UI-06 | All の自由配置とUnassignedカード、章節選択で自動ツリー、Group移動で structure.json 不変 |
| UI-07 | Canvas本文 | `tests/e2e/canvas.spec.ts` › UI-07 | 5行クランプ、タイトル表示、ダブルクリックで右ペインの全文編集。シングルクリックで直下に全文展開・編集（`canvas.spec.ts` › UI-07 / UI-16） |
| UI-08 | Outline階層 | `tests/e2e/outline.spec.ts` › UI-08 | 単独章節も表示、並び替えで採番追従、個別/一括開閉、ツールバー固定 |
| UI-09 | Outline D&D | `tests/e2e/outline.spec.ts` › UI-09 / DAT-04、`tests/unit/commands.test.ts`（property-based） | メモ・Paragraph・章節の移動、親変更、循環拒否、多重配置なし |
| UI-10 | Inline Note編集 | `tests/e2e/outline.spec.ts` › UI-10 | Outline内編集 ⇄ 右Note Editor ⇄ Manuscript ⇄ .md ファイル |
| UI-11 | Manuscript | `tests/e2e/outline.spec.ts` › UI-11 / DAT-03 | 中央左右分割、閉じる、全画面、.md エクスポート |
| UI-12 | Cards | `tests/e2e/cards.spec.ts` › UI-12、› Search all workspaces | 正方形、検索、タグ/Outline別、章（子節含む）/Unassigned絞り込み、横断検索。クリックで直下に全幅で展開・編集（`cards.spec.ts` › UI-12 / UI-16）、複数表示時は1か所だけ展開、展開中も検索・並べ替え・グループ化、編集で検索に合わなくなっても折りたたむまで表示 |
| UI-13 | Reference | `tests/e2e/reference-settings.spec.ts` › UI-13、› BibTeX errors | 検索、カーソル位置への `[@key]` 挿入、解析エラー・重複キー、外部更新の再読込 |
| UI-14 | Settings | `tests/e2e/reference-settings.spec.ts` › UI-14 / DAT-06、`tests/integration/vault.test.ts` | Browse（E2EではOSダイアログをスタブ）、Save/Cancel、再起動後に復元 |
| UI-15 | 新規メモ | `tests/e2e/cards.spec.ts` › UI-15、› DAT-01 | タイトルと本文を別欄で入力、`.md` は `# Title` ＋本文、重複タイトルで入力を保持、入力ありのキャンセルで確認 |
| UI-16 | 展開編集の同期 | `tests/e2e/cards.spec.ts` › UI-12 / UI-16、`tests/e2e/canvas.spec.ts` › UI-07 / UI-16・UI-16 Canvas section tree、`tests/e2e/sync.spec.ts` › UI-16、`tests/e2e/unsaved.spec.ts`、`tests/unit/layout.test.ts` | Cards／Canvas の展開編集が右ペイン・Outline・`.md` と同期、同じメモの複数エディターで自己競合しない、競合バナー、Canvas のドラッグ・パン・ズームと競合しない、ツリー表示で重ならない |
| DAT-01 | メモ一意 | `tests/unit/commands.test.ts` › titles、`tests/e2e/cards.spec.ts` › DAT-01 | 同一Workspaceの重複（大文字小文字・NFC）を拒否、別Workspaceでは許可 |
| DAT-02 | WikiLink | `tests/unit/markdown.test.ts` › WikiLinks、`tests/e2e/cards.spec.ts` › DAT-02 | 補完、移動、Backlinks、改名時の連鎖更新（コード・数式・エスケープは対象外）、リンク切れ |
| DAT-03 | Paragraph | `tests/unit/markdown.test.ts` › manuscript、`tests/e2e/outline.spec.ts` › UI-11 / DAT-03 | 指定順で1段落化、H1/Groupタイトルなし、引用保持、複雑なメモは原文のまま出力して警告。本文中の H1〜H6 を除去（コード・数式・HTML は変えない）: `tests/unit/markdown.test.ts` › manuscript headings |
| DAT-04 | 配置一意 | `tests/unit/commands.test.ts` › moves・property、`tests/e2e/outline.spec.ts` › UI-09 / DAT-04 | 移動しても構造内に1回だけ、Unassigned は原稿に含まれない |
| DAT-05 | 保存・競合 | `tests/integration/vault.test.ts` › vault persistence・multi-file transactions、`tests/e2e/reference-settings.spec.ts` › DAT-05・Conflict・Markdown added、`tests/e2e/unsaved.spec.ts` | 再起動後の復元、外部編集の検知（同サイズ・同 mtime も）、外部削除を競合として扱う、無言上書きしない、ジャーナルのロールバックと改変ジャーナルの隔離、外部で追加したメモの取込み、終了・Workspace 切替・メモ切替で未保存本文を失わない |
| DAT-06 | Vault保護 | `tests/integration/vault.test.ts` › workspace manager、`tests/e2e/reference-settings.spec.ts` › UI-14 / DAT-06 | 別Workspace・存在しない・相対パス・構造が壊れたVaultを拒否し旧パスと旧セッションを維持、検証で候補Vaultに書き込まない、元Vaultは無変更 |
| WIN-01 | Windows実行 | `.github/workflows/ci.yml`（windows-latest: portable EXE ビルド＋パッケージ版で全E2E） | **Windows 11 実機での手動確認が別途必要**（下記チェックリスト） |
| WIN-02 | 配布更新 | `.github/workflows/ci.yml`（EXE を2フォルダーへ複製）、`tests/e2e/reference-settings.spec.ts` › DAT-05 | 設定は `%APPDATA%\FACET\settings.json`（EXE の場所に依存しない） |

## 追加の自動テスト

- `tests/unit/history.test.ts`: Undo/Redo の安全性（後から変更された内容は戻さない）、差分パッチ、検索トークナイザー
- `tests/integration/vault.test.ts`: パスガード（`..`・絶対パス・シンボリックリンクとジャンクションによる脱出）、孤立 .md の取り込み、壊れた構造参照の修復、ゴミ箱
- `tests/unit/layout.test.ts`: Canvas の章節ツリー表示が実測の高さで行を配置し、重ならないこと
- `tests/integration/performance.test.ts`: 10 Workspace × 1,000 メモ。WSL2 での実測は、10 Vault の読込み約 3.9 秒、横断検索 約 60ms（目標 100ms 未満）、原稿生成 約 0.5 秒（初回）、改名の連鎖更新 約 0.2 秒
- `FACET_EXECUTABLE=<パッケージ済み実行ファイル> npx playwright test` で、パッケージ版（asar 化と本番用 CSP を適用した状態）に対して全 E2E を実行できる

## WIN-01 手動チェックリスト（Windows 11 x64 実機）

1. `FACET-<version>-portable-x64.exe` を任意のフォルダーにコピーする。Node.js・Python・WSL・ブラウザは不要。
2. ネットワークを切断した状態で起動する（未署名のため SmartScreen の警告が出たら「詳細情報」→「実行」）。
3. Settings → Add workspace… で空フォルダーを選び、Vault を作成する。
4. メモの作成・編集、Outline への配置、Manuscript のエクスポートを行い、終了後に再起動して内容が戻ることを確認する。
5. EXE を別のフォルダーへ移動して起動し、Workspace の登録と Vault の内容が維持されていることを確認する（WIN-02）。
