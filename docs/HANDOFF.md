# 引き継ぎメモ（2026-11-08 時点）

次のセッションが最初に読むためのメモ。解決したら該当項目を消し、不要になったらファイルごと削除する。

## 現在の状態

- バージョン 0.1.0（タグ `v0.1.0` = ee6eef8）。`main` と `develop` は GitHub（`git@github.com:msato-dev/facet.git`）へ push 済み。リモートの既定ブランチは `main`。
- 開発は `develop` ブランチで行う。作業フォルダーは WSL の `/home/mthr/data/facet`。
- ローカル（WSL）では typecheck、lint、単体・統合テスト 45 件、E2E 25 件がすべて通る。
- Windows 11 実機での WIN-01/WIN-02 の確認はまだ（`docs/TEST_MATRIX.md` の手動チェックリスト）。

## 環境メモ

- **push と pull**: SSH 鍵は Bitwarden（Windows デスクトップアプリの SSH エージェント）で管理している。WSL の `ssh` からはこの鍵が見えないため、このリポジトリには `git config core.sshCommand ssh.exe` を設定し、Windows の OpenSSH を使わせている（`.git/config` にだけあり、clone し直すと消える）。接続確認は `ssh.exe -T git@github.com`。
- Windows 側の Git で clone する場合は、`git config --global core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"` が必要（Git 同梱の ssh は Bitwarden のエージェントを使えない）。
- `gh` は未ログイン。CI のログを読むには `gh auth login` してから `gh run view <run-id> --log-failed`。

## 未解決 1: CI が失敗している（run 42471829890、コミット ee6eef8）

https://github.com/msato-dev/facet/actions/runs/42471829890

- **Windows ジョブ**: `tests/integration/vault.test.ts:249`（workspace manager & settings (DAT-06, UI-14) > registers workspaces, validates location changes and keeps the old path when invalid）が失敗する。
  - `expected 'C:\Users\RUNNER~1\AppData\Local\Temp\…' to be 'C:\Users\…'`。8.3 形式の短いパス（`RUNNER~1`）と正式なパスを文字列のまま比べているのが原因と見られる。
  - テスト側の期待値を `realpath` で正規化するだけでなく、アプリ側（`src/main/settings/vaultValidation.ts`、`SettingsStore`、`WorkspaceManager`）の保存・比較でもパスを `fs.realpathSync.native` で正規化すべきか確認する。ユーザー名が長い Windows 環境では、同じ問題が実際に起きうる。
  - このテストの失敗で後続の `dist:win` と E2E が実行されず、portable EXE の成果物がまだ作られていない。
- **Linux ジョブ**: どこかのステップが exit code 1 で失敗している（ワークフローの 11 行目付近の注記）。原因は未調査。GitHub API が不安定でログを取得できなかった。
- 警告（失敗ではない）: `actions/checkout@v4`、`setup-node@v4`、`upload-artifact@v4` が Node.js 20 対象で非推奨。新しいメジャーへの更新を検討する。`test-results/` が無いときのアップロード警告は `if-no-files-found: ignore` で消せる。

## 未解決 2: Windows でのローカルビルド（`npm run dist:win`）

`C:\Users\mthr\Downloads\facet` で試した。Node は v26.13.0。

- `npm ci` の後、`node_modules\electron\dist` が無かった（Electron 本体のダウンロードが失敗していた）。
- `npm run dist:win` は Vite のビルドまで成功し、Electron の zip をダウンロードした後で `socket hang up` になった。`node node_modules/electron/install.js` は `TypeError: fetch failed`。この環境では Node から GitHub Releases へのダウンロードが不安定。
- 回避策: ブラウザーで `https://github.com/electron/electron/releases/download/v45.2.3/electron-v45.2.3-win32-x64.zip` を取得して facet フォルダーに置き、次を実行する（PowerShell ではオプションを引用符で囲む）。

  ```bash
  npx electron-builder --win portable --x64 "--config.electronDist=electron-v45.2.3-win32-x64.zip"
  ```

- portable ターゲットは NSIS なども GitHub からダウンロードするため、同じ通信エラーが出るかもしれない（未確認）。VPN、プロキシ、セキュリティソフトの HTTPS 検査を疑う。
- 代替: CI を直せば、Windows ジョブが portable EXE を成果物としてアップロードする。
