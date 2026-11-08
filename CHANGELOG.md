# Changelog

形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準じる。バージョン付けの方針は [docs/VERSIONING.md](docs/VERSIONING.md) を参照。

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

[0.1.0]: https://github.com/msato-dev/facet/releases/tag/v0.1.0
