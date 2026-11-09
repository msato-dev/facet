# FACET 設計判断記録（DECISIONS）

SPEC.md §1.1 の DESIGN 項目と §補足の未確定事項について行った判断を記録する。REQ は変更しない。
判断を変更する場合は新しい ADR を追加し、旧 ADR を `Superseded by ADR-xxx` とする。

| ADR | 日付 | 判断 | 理由 | 状態 |
|---|---|---|---|---|
| 001 | 2026-11-08 | Electron + React + TypeScript + electron-vite、配布は electron-builder portable (win x64) | SPEC §9.1 第一候補。Main/Preload/Renderer を単一設定でビルド | Accepted |
| 002 | 2026-11-08 | ドメインの正本と書込みは Main に一本化。Renderer はコマンド送信とスナップショット受信のみ | 競合検知・トランザクション・Undo・外部変更取込みを一か所に集約 | Accepted |
| 003 | 2026-11-08 | Canvas は @xyflow/react、D&D は dnd-kit、エディターは CodeMirror 6 | パン・ズーム・fitBounds が標準装備／キーボード対応 D&D／カーソル位置挿入と補完 | Accepted |
| 004 | 2026-11-08 | Markdown 解析は unified/remark（gfm, math）、表示は rehype-sanitize | 位置付き AST でコード・数式を除外した WikiLink 置換と安全表示 | Accepted |
| 005 | 2026-11-08 | 検索は MiniSearch（Main メモリ内）、英語は単語、CJK は 2-gram | 約1万メモ規模に十分。SQLite FTS5 のネイティブ依存を portable EXE で避ける。再生成可能キャッシュ | Accepted |
| 006 | 2026-11-08 | Vault レイアウトは SPEC §9.2 の例どおり。加えて `.facet/journal/` と `.facet/trash/` | 可搬性・単一正本・ビュー状態分離を維持 | Accepted |
| 007 | 2026-11-08 | `structure.json` は Section の `children` に子 Section と PG を順序付きで混在、任意深さ。番号は保存しない | §8.2 の明示順序と入れ子、§2.3 の動的採番 | Accepted |
| 008 | 2026-11-08 | Section 未所属の PG を `unplacedGroups` として許可（Manuscript 非出力） | Canvas All で先に Group を作る操作を自然にする | Accepted |
| 009 | 2026-11-08 | タイトル一意性は NFC・大文字小文字無視・trim で比較。`[[` `]]` `|` `#` 改行・空を禁止 | WikiLink 解決の曖昧さを排除 | Accepted |
| 010 | 2026-11-08 | `[[Title|Alias]]` を解析し、解決は Title、Manuscript には Alias | Obsidian 由来の記法を壊さない | Accepted |
| 011 | 2026-11-08 | 配置済みメモのアーカイブは構造から外し `lastPlacement` を記録 | 原稿に見えないメモを残さない、DAT-04 を保ちやすい | Accepted |
| 012 | 2026-11-08 | 削除は確認後 `.facet/trash/` へ移動し、Undo トーストと Trash 復元を提供 | §8.1 の削除とアーカイブの区別、復旧手段 | Accepted |
| 013 | 2026-11-08 | Manuscript 結合: CJK・全角句読点の境界は空白なし、それ以外は半角空白1つ。複数段落・表・ブロック数式・リスト・コード・見出しを含むメモは結合せず原文ブロックを出力し警告 | §8.3 の安全側処理、日英混在の自然な結合 | Accepted（見出しの扱いは Superseded by ADR-033） |
| 014 | 2026-11-08 | 見出しは深さ d で `#`×d（最大6）、番号 `4.` / `4.1.` / `4.1.2.` | モックの出力形式を踏襲 | Accepted |
| 015 | 2026-11-08 | 単一ファイルは tmp 書込み→fsync→rename（EPERM/EBUSY は最大5回再試行）。複数ファイルはジャーナル方式、起動時に残存ジャーナルはロールバック | §9.2 の atomic 書込みと失敗時復旧 | Accepted |
| 016 | 2026-11-08 | 外部編集は mtime+size+hash で検知し、無言上書きせず競合 UI を表示 | §9.2, DAT-05 | Accepted |
| 017 | 2026-11-08 | Settings に Add workspace（空フォルダー初期化／既存登録）と Remove from list（登録解除のみ）を追加 | SPEC に Workspace 作成導線がないため、ファイルを壊さない操作に限定 | Accepted |
| 018 | 2026-11-08 | Vault パス変更は絶対パス・存在・読み書き・`project.yml`・workspaceId 一致を検証し、失敗時は旧パス保持 | §7, DAT-06 | Accepted |
| 019 | 2026-11-08 | Windows ビルドは Windows ネイティブまたは GitHub Actions `windows-latest` で行う | portable (NSIS) は Linux で Wine が必要 | Accepted |
| 020 | 2026-11-08 | 本文は自動保存（500ms デバウンス＋blur）、Ctrl+S は即時フラッシュ | データ消失の防止 | Accepted |
| 021 | 2026-11-08 | Outline と Canvas の D&D は dnd-kit ではなく HTML5 ネイティブ D&D で実装（ADR-003 の D&D 部分を置換）。キーボード代替として Alt+↑/↓ | モックと同じ before/inside/after ゾーン判定をそのまま再現でき、React Flow の変換座標下でも安定する。依存を1つ減らせる | Accepted |
| 022 | 2026-11-08 | BibTeX は `@retorquere/bibtex-parser` の純 JS ビルド（`/js`）を Main で使用 | v13 の既定エクスポートは WASM。純 JS ビルドなら単一バンドルに収まり、エラー行番号も得られる | Accepted |
| 023 | 2026-11-08 | E2E 用フック: `FACET_E2E=1` のときだけ OS ダイアログ（フォルダー選択・保存先・.bib 選択）をスタブにし、`FACET_USER_DATA` で userData を差し替える | OS ダイアログは自動操作できないため。通常起動では無効 | Accepted |
| 024 | 2026-11-08 | アーカイブ済みメモは Cards の「Archived」で表示・解除し、削除済みメモは Cards の「Trash」から復元 | SPEC §8.1 の「復元可能」を満たす導線。左ペインに項目を増やさない（§2.1） | Accepted |
| 025 | 2026-11-08 | Canvas Tools の Copy/Paste は独立したメモの複製（同じ Workspace では「(copy)」を付けた新規メモ、別 Workspace では新しい ID のコピー）。Group は複数選択中のメモを新しい Paragraph Group にまとめる | SPEC §5 の「独立コピー」原則に合わせる | Accepted |
| 026 | 2026-11-08 | Main は依存をすべて単一ファイルにバンドルし、`dependencies` を持たない（すべて devDependencies） | ESM 専用パッケージへの対応と、portable EXE を小さく保つため | Accepted |
| 027 | 2026-11-08 | 開発環境（WSL2）では Wine がないため portable EXE は作らず、GitHub Actions の windows-latest でビルドし、パッケージ版に対して E2E を実行する | ADR-019 の具体化 | Accepted |
| 028 | 2026-11-08 | ジャーナルは信頼しない入力として扱う。形式 v2 は Vault 相対パスだけを保存し、一時ファイルと退避先は ID から導出する。復旧時は zod で検証し、全パスを `resolveInVault` で解決する。不正なジャーナルは実行せず `.facet/journal-quarantine/` へ移して警告する。0.1.0 の絶対パス形式は、Vault 内に収まり導出規則と一致する場合だけ変換して復旧する。`.facet/journal` がリンクなら Vault を開かない | 改変されたジャーナルを含む Vault を開くだけで Vault 外のファイルを上書き・削除できたため（ADR-015 の補強） | Accepted |
| 029 | 2026-11-08 | 書込み前の確認では内容ハッシュを必ず比較する（size と mtime の一致で省略しない）。FACET が知っているファイルが外部で削除されていた場合も競合とし、黙って再作成しない | タイムスタンプを保つ置換やファイル削除を見逃して上書きしていたため（ADR-016 の補強、DAT-05） | Accepted |
| 030 | 2026-11-08 | Vault パス変更では、変更先の全ファイル（index、メモ、structure、canvas、trash）を書込みなしで読み込んで検証する（`VaultRepository.inspect`）。保存時は新しいセッションを先に開き、設定の書込みまで成功してから旧セッションと差し替える。どこかで失敗したら旧設定・旧セッションを保つ。設定の書込みに失敗したときはメモリ上の設定も元に戻す | `project.yml` と ID の確認だけでは、壊れた structure.json などで新セッションが開けず、旧参照先を失っていたため（ADR-018 の補強、DAT-06） | Accepted |
| 031 | 2026-11-08 | エディターのフラッシュは成功・失敗を返す。失敗（競合・保存エラー）があれば Workspace 切替、Vault パス変更、アクティブ Workspace の登録解除を止めてトーストで知らせる。保存できていない本文は Workspace・メモ ID 単位のドラフトとして Renderer のメモリに保持し、メモを開き直すと競合バナー付きで復元する。保存成功・「最新を読み込む」で破棄する | 競合で保存できないまま切替が進み、エディターの破棄で本文を失っていたため（ADR-020 の補強） | Accepted |
| 032 | 2026-11-08 | ウィンドウの close は一旦保留し、Renderer にフラッシュを依頼して結果を待ち（15 秒で未応答なら失敗扱い）、Main の書込みキューと設定の書込みの完了も待つ。保存できない変更が残る場合は「戻る」（既定）と「変更を破棄して終了」を選ばせる。E2E では `closeChoice` フックで応答する | 入力直後に閉じると本文を失いうるため。破棄の選択肢がないと、書き込めない Vault で終了できなくなる | Accepted |
| 033 | 2026-11-09 | Manuscript では本文中の見出し（ATX・Setext の H1〜H6）を AST の位置情報で除去する。行頭の見出し（ルート直下と引用内）は行ごと削除し、前後の空行を1つに詰める。リスト項目のマーカーと同じ行の見出しは `#` だけを外して文字列を残す。除去は WikiLink だけの行の削除の後、分類の前に行い、除外は警告しない。見出しを含むメモを原文で出力する ADR-013 の扱いを置き換える | 章節見出しの正本を Outline 構造に一本化する（SPEC §8.3）。AST で判定するのでコード・数式・HTML 内の `#` を誤変換しない。原本は変更しない | Accepted |
| 034 | 2026-11-09 | Cards と Canvas の展開編集は既存の `MarkdownEditor` を薄いラッパー `NoteBodyPanel` で包んで使う。展開状態は Renderer の UI 状態（永続化しない、Workspace 切替でリセット）で、各ビュー1件まで。Cards は表示位置（グループキー＋メモ ID）で管理し、複数表示のメモはクリックした位置だけ展開する。シングルクリックで選択と展開の切替、ダブルクリックの右ペインは維持し、展開時に自動でフォーカスしない。パネルはカード・チップの外側の兄弟要素として置く | 保存・競合・ドラフトの処理を1か所に保つ。既存の操作（右ペイン、HTML5 D&D、キーボード）を壊さない | Accepted |
| 035 | 2026-11-09 | 同じメモの別エディターにフォーカスが移ったとき、他のエディターに未保存・保存中の変更があれば、その保存が終わってこのエディターに反映されるまで、入力を保留し、反映後にカーソル位置へ再適用する（保留中の削除キーは適用しない）。他所の変更の反映は差分だけを置き換え、カーソル位置を保つ（末尾のカーソルは末尾のまま） | 展開編集で同じメモのエディターを同時に表示するのが標準になるため、古い rev のまま編集して自分自身と競合するのを防ぐ（ADR-031 の補強） | Accepted |
| 036 | 2026-11-09 | Canvas の展開は、章節ツリー表示ではノードの実測の高さで再レイアウトする。All の自由配置では座標を変えず、展開を含むノードを前面に表示する。パネルに `nodrag`/`nopan`/`nowheel` を付け、ドラッグ・パン・ズームを起こさない。画面外でノードがアンマウントされた場合は、既存のアンマウント時の保存とドラフトで本文を守る | Canvas の座標はユーザーのデータ。編集と Canvas 操作の競合を防ぐ | Accepted |
| 037 | 2026-11-09 | 新規メモダイアログはタイトル欄と、保存処理のない CM6 の本文欄（WikiLink 補完を共有）を持ち、既存の `note.create` の `body` で1回で作成する。不正・重複タイトルではダイアログを閉じずに欄のエラーとして示し、入力がある状態で閉じるときは破棄を確認する | コマンド・IPC・保存形式を変えない。入力した本文を失わない | Accepted |
