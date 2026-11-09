# 引き継ぎメモ（2026-11-09 時点）

次のセッションが最初に読むためのメモ。解決したら該当項目を消し、不要になったらファイルごと削除する。

## 現在の状態

- バージョン 0.2.0（`package.json`、`CHANGELOG.md`）。メモの作成・表示・編集の改修（SPEC v3.1、ADR-033〜037、`docs/IMPLEMENTATION_PLAN.md` の「改修計画 0.2」）を `develop` に実装済み。**`develop` はまだ push しておらず、`v0.2.0` タグも未作成**。
- 0.1.0（タグ `v0.1.0` = ee6eef8）は `main` と `develop` とも GitHub（`git@github.com:msato-dev/facet.git`）へ push 済み。リモートの既定ブランチは `main`。
- 開発は `develop` ブランチで行う。作業フォルダーは WSL の `/home/mthr/data/facet`。
- ローカル（WSL）では typecheck、lint、単体・統合テスト 64 件、E2E 35 件がすべて通る。
- 次の作業: `develop` を push して CI（Linux と Windows のパッケージ版 E2E）を確認する。通ったら Windows 11 実機で `docs/TEST_MATRIX.md` の手動チェックリスト（6・7 は 0.2.0 の追加分: IME 入力、ズーム中の編集）を確認し、`v0.2.0` タグを付ける。
- E2E の UI-05（Canvas のパン・ズーム）が一度だけタイムアウトした（単独の再実行は 4/4 成功）。再発したら調べる。
- Electron 本体のダウンロードは不安定なので、CI ではキャッシュし、`install.js` を 3 回までリトライする。Playwright の失敗は Actions の注記に出る。

## 環境メモ

- **push と pull**: SSH 鍵は Bitwarden（Windows デスクトップアプリの SSH エージェント）で管理している。WSL の `ssh` からはこの鍵が見えないため、このリポジトリには `git config core.sshCommand ssh.exe` を設定し、Windows の OpenSSH を使わせている（`.git/config` にだけあり、clone し直すと消える）。接続確認は `ssh.exe -T git@github.com`。
- Windows 側の Git で clone する場合は、`git config --global core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"` が必要（Git 同梱の ssh は Bitwarden のエージェントを使えない）。
- `gh` は未ログイン。WSL にブラウザーが無いので、`BROWSER=explorer.exe gh auth login -h github.com -p https --web` でログインする（2026-11-08 には GitHub の `slow_down` エラーで失敗した）。ジョブの状態と注記は、ログインなしでも公開 API（`https://api.github.com/repos/msato-dev/facet/actions/runs`）で読める。

## 未解決: Windows でのローカルビルド（`npm run dist:win`）

`C:\Users\mthr\Downloads\facet` で試した。Node は v26.13.0。

- `npm ci` の後、`node_modules\electron\dist` が無かった（Electron 本体のダウンロードが失敗していた）。
- `npm run dist:win` は Vite のビルドまで成功し、Electron の zip をダウンロードした後で `socket hang up` になった。`node node_modules/electron/install.js` は `TypeError: fetch failed`。この環境では Node から GitHub Releases へのダウンロードが不安定。
- 回避策: ブラウザーで `https://github.com/electron/electron/releases/download/v45.2.3/electron-v45.2.3-win32-x64.zip` を取得して facet フォルダーに置き、次を実行する（PowerShell ではオプションを引用符で囲む）。

  ```bash
  npx electron-builder --win portable --x64 "--config.electronDist=electron-v45.2.3-win32-x64.zip"
  ```

- portable ターゲットは NSIS なども GitHub からダウンロードするため、同じ通信エラーが出るかもしれない（未確認）。VPN、プロキシ、セキュリティソフトの HTTPS 検査を疑う。
- 代替: CI の Windows ジョブが portable EXE を成果物 `FACET-portable-win-x64` としてアップロードする（run 42475840279 から）。
