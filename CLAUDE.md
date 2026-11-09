# FACET — Claude Code ガイド

## 正本と参照
- **唯一の現行仕様**: `docs/SPEC.md`（v3.1）。旧版や改訂履歴は参照しない。未記載の挙動を旧版から復活させない。
- **UI・操作の基準**: `docs/mock/FACET_interactive_mock.html`（v1.3）。配置と相互作用の参照であり、サンプルデータ・インメモリ状態・不完全な処理は本番仕様ではない。v1.1（Windows 2000 風）の層は採用しない。
- **実装計画**: `docs/IMPLEMENTATION_PLAN.md`。**設計判断**: `docs/DECISIONS.md`（DESIGN を変えるときは ADR を追加）。
- **受け入れテスト対応表**: `docs/TEST_MATRIX.md`（SPEC §11 の全 ID とテストファイル）。
- **引き継ぎメモ**: `docs/HANDOFF.md` があれば最初に読む（未解決の課題と環境メモ）。
- REQ（確定要件）は変更しない。曖昧な点は推奨案と理由を示して確認する。

## 技術上のガードレール
- Electron: `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、厳格な CSP、ナビゲーションと新規ウィンドウは拒否。
- ドメインの正本と書込みは Main プロセスのみ。Renderer はコマンド送信だけを行う。
- IPC 引数は zod で検証する。IPC でファイルパスを受け取らない（`workspaceId`/`noteId` のみ。Settings のパス直接入力だけは Main で検証）。
- Vault 内パスは `realpath` で Vault ルート配下を確認し、シンボリックリンク・ジャンクションによる脱出を拒否する。
- `src/shared/` は純 TS。`electron`/`fs`/DOM を import しない。Renderer は `electron`/`fs` を import しない。
- ファイル書込みは atomic（tmp → rename）。複数ファイル更新はジャーナル。外部編集を無言で上書きしない。
- Markdown 表示はサニタイズし、スクリプトを実行させない。
- **モックの擬似データや localStorage による Vault パス保存を本番方式に使わない。** Vault パスは OS フォルダーダイアログで取得し、userData の `settings.json` に保存する。
- 依存は exact バージョンで固定する。実行時に外部サービスへ通信しない。ネイティブモジュールは避ける。

## Phase の進め方
- 各 Phase の終わりに `npm run typecheck && npm run lint && npm test`（とその Phase の E2E）を通す。
- 変更ファイル・未実装要件・新しい決定を報告し、**承認なしに次の Phase へ進まない**。
- データ整合性のテストを見た目より優先する。
- Git コミットは小さく保つ。
- 最終確認は Windows 11 上の portable EXE。WSL でのみ動くことは合格としない。

## コマンド
- Node は開発機では `~/.local/opt/node/bin` に配置（`export PATH=~/.local/opt/node/bin:$PATH`）。
- `npm run typecheck` / `npm run lint` / `npm test`（Vitest: 単体・統合）/ `npm run test:e2e`（ビルド＋Playwright で Electron を起動）。
- E2E はダイアログを `FACET_E2E=1` 時のみスタブ化（`tests/e2e/fixtures.ts` の `setTestHook`）。パッケージ版は `FACET_EXECUTABLE=... npx playwright test`。
- Windows portable EXE は Windows（または CI の windows-latest）で `npm run dist:win`。
