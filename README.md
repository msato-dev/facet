# FACET

**FACET Arranges Concepts, Evidence, and Text**

研究論文の執筆に先立ち、独立した Markdown メモを蓄積・関連付けし、Paragraph Group 単位で論旨を構成し、章・節へ配置して原稿（Markdown）を生成するデスクトップアプリです。最終的な編集は Microsoft Word で行う想定です。

- 対象: Windows 11 x64。インストール不要のポータブル EXE（オフラインで動作）
- 仕様: [docs/SPEC.md](docs/SPEC.md)（唯一の現行仕様）
- UI 参照: [docs/mock/FACET_interactive_mock.html](docs/mock/FACET_interactive_mock.html)
- バージョン: 0.2.0（プロトタイプ。方針は [docs/VERSIONING.md](docs/VERSIONING.md)、変更履歴は [CHANGELOG.md](CHANGELOG.md)）
- 実装計画: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)、設計判断: [docs/DECISIONS.md](docs/DECISIONS.md)、テスト対応表: [docs/TEST_MATRIX.md](docs/TEST_MATRIX.md)

## 使い方の概要

1. 歯車（Settings）→ **Add workspace…** で、論文ごとのフォルダーを選びます。空のフォルダーなら新しい Vault として初期化し、既存の Vault ならそのまま登録します。
2. **Canvas** でメモと Paragraph Group を自由に配置し、**Outline** で章・節・段落の順序を決めます。
3. Outline の **Open Manuscript** で原稿をプレビューし、Markdown としてコピーまたはエクスポートします。
4. **Reference** タブでは、Zotero などからエクスポートした `references/library.bib` を検索し、カーソル位置に `[@Key]` を挿入します。

### Vault の構成

```text
<Vault>/
  project.yml              # Workspace ID・名前・BibTeX の場所
  notes/<id>.md            # 1メモ1ファイル（1行目 "# タイトル"）
  notes-index.json         # タグ・日時・アーカイブ状態
  structure.json           # 原稿構造の唯一の正本
  canvas-state.json        # Canvas の座標・表示状態
  references/library.bib   # 外部管理・読み取り専用
  exports/manuscript.md    # エクスポート先（派生ファイル）
  .facet/                  # 書込みジャーナルとゴミ箱
```

Vault は通常のフォルダーなので、Git などで外部から履歴を管理できます。FACET は外部で変更されたファイルを黙って上書きしません。アプリ設定（登録 Workspace など）は `%APPDATA%\FACET\settings.json` に保存されます。

## 開発

Node.js 24 を前提とします（開発は WSL2/Ubuntu でも可）。

```bash
npm ci
npm run dev          # 開発起動（HMR）
npm run typecheck    # 型検査
npm run lint         # ESLint
npm test             # 単体・統合テスト（Vitest）
npm run test:e2e     # ビルドして Playwright で Electron を E2E テスト
npm run dist:win     # Windows portable EXE（Windows 上で実行）
```

`FACET_EXECUTABLE=<実行ファイル> npx playwright test` で、パッケージ版に対して E2E を実行できます。Windows 版は `.github/workflows/ci.yml` の windows-latest ジョブでビルド・テストされ、portable EXE が成果物としてアップロードされます。

### 構成

- `src/shared` — 純粋な TypeScript のドメイン層（コマンド、不変条件、番号付け、Undo、WikiLink、原稿生成、検索トークナイザー、IPC 契約）
- `src/main` — Electron Main（Vault の I/O、アトミック書込みとジャーナル、競合検知、ファイル監視、設定、横断検索、BibTeX）
- `src/preload` — 型付きの最小限の API（`window.facet`）
- `src/renderer` — React UI（Canvas は React Flow、エディターは CodeMirror 6）

セキュリティ: `contextIsolation`・`sandbox` を有効にし、本番ビルドでは厳格な CSP を適用します。IPC の引数はすべて zod で検証し、Vault 外へのパスやシンボリックリンクによる脱出は拒否します。

### 注意

コード署名をしていない EXE は、初回起動時に SmartScreen の警告が出ることがあります。
