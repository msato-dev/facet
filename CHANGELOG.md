# Changelog

形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準じる。バージョン付けの方針は [docs/VERSIONING.md](docs/VERSIONING.md) を参照。

## [0.2.0] - 2026-11-09

メモの作成・表示・編集の改修（SPEC v3.1、ADR-033〜037）と、0.1.0 以降のデータ保護の修正。データモデルと Vault 形式は変更なし。

### Added
- 新規メモダイアログで、タイトルと本文（Markdown、`[[` 補完付き）を別の欄に入力できる。タイトルの重複・不正は入力を保持したまま欄に表示し、入力がある状態で閉じるときは確認する（UI-15）
- Cards: カードをクリックすると、その直下（次の行に全幅）に本文全体を展開して Markdown で編集できる。複数表示されるメモはクリックした位置だけ展開し、編集で検索に合わなくなっても折りたたむまで表示を維持する（UI-12、UI-16）
- Canvas: Paragraph Group 内のメモと未配置カードをクリックすると、その下に本文全体を展開して編集できる。章節ツリー表示では後続の行が下へずれる。編集中はノードのドラッグ・パン・ズームが起きない。ダブルクリックで右ペインを開く操作は従来どおり（UI-07、UI-16）

### Changed
- Manuscript は、メモ本文中の H1〜H6 見出しを出力せず、見出し直下の本文を保持する。章・節の見出しは Outline 構造だけを正本とする。見出しを含むメモは原文のまま出力して警告していたが、見出しを除いたうえで通常どおり結合する（DAT-03、ADR-033）
- 同じメモを複数のエディターで開いているとき、フォーカスを移した直後の入力は、他のエディターの保存が反映されるまで保留してから適用する。自分自身との競合バナーが出なくなった。他所の変更を反映するときにカーソル位置を保つ（ADR-035）
- 競合バナーの「最新を読み込む」は、同じメモを開いている全エディターに適用する
- ダイアログ内で Escape を補完リストの close などに使ったときはダイアログを閉じない。Tab のフォーカス循環にエディター欄を含める

### Fixed
- Canvas の章節ツリー表示で、グループ内のメモ・展開ボタン・右クリックメニューがクリックできなかった
- 終了・Workspace 切替・メモ切替で、保存できていない本文を失うことがあった（ADR-031、032）
- 外部で追加された Markdown を、Workspace を開いたまま取り込む
- 書込み前に必ず内容ハッシュを比較し、外部での削除も競合として扱う（ADR-029）
- 改変されたジャーナルで Vault 外のファイルを上書き・削除できた問題。ジャーナルを検証し、復旧を Vault 内に限る（ADR-028）
- Vault パス変更で、新しい Vault が完全に開けるまで旧 Vault を保つ。正規化したパスを保存する（ADR-030）

### Known limitations
- Windows 11 実機での WIN-01/WIN-02 と、展開編集での IME 入力・ズーム中の入力の確認は未実施
- 展開中のノードを画面外までパンすると、そのエディターは閉じられ（本文は保存される）、戻ると再表示される
- 同じメモの別エディターへ移った直後の保留中に押した Backspace/Delete は適用されない

## [0.1.0] - 2026-11-08

最初のプロトタイプ。SPEC v3.0 の Phase 1〜6 の範囲を実装した。

### Added
- Electron + React + TypeScript による Windows 向けポータブルデスクトップアプリの基盤（sandbox、厳格な CSP、zod で検証する型付き IPC）
- Markdown Vault: 1メモ1ファイル、`structure.json` を原稿構造の唯一の正本とする、アトミック書込み、ジャーナルによるロールバック、外部編集の検知（無言で上書きしない）、ゴミ箱
- 3ペインのシェル（左右のペインを独立して開閉可能）、Workspace の切替、動的に番号を振る Sections ツリー、右ペインの Note Editor（CodeMirror 6、自動保存、`[[` 補完）
- Canvas: Paragraph Group と未配置メモの自由配置、章節を選ぶと自動ツリー表示、パン・ズーム・Fit all・100%・Fit group、Canvas Tools
- Outline: 全階層の D&D（Alt+↑/↓ でも移動可）、折りたたみ、Outline 内でのメモ編集、Unassigned、Manuscript の分割プレビュー・全画面表示・Markdown エクスポート
- Cards: 正方形グリッド、検索・並べ替え・グループ化・Outline フィルター、アーカイブとゴミ箱からの復元
- Search all workspaces（日本語の 2-gram と英単語で横断検索）と、別 Workspace への独立コピー
- Reference: BibTeX の検索、カーソル位置への `[@Key]` 挿入、解析エラーと重複キーの表示、外部更新時の再読込
- Settings / Vault Locations: OS のフォルダー選択ダイアログ、パスの検証、Workspace の追加と登録解除
- 構造操作の Undo/Redo
- テスト: 単体・統合 45 件、Playwright E2E 25 件（受け入れテスト UI-01〜14、DAT-01〜06）、性能テスト
- GitHub Actions: Linux でのチェックと、Windows portable EXE のビルドおよびパッケージ版に対する E2E

### Known limitations
- Windows 11 実機での WIN-01/WIN-02 の確認は未実施
- EXE はコード署名なし（SmartScreen の警告が出ることがある）

[0.2.0]: https://github.com/msato-dev/facet/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/msato-dev/facet/releases/tag/v0.1.0
