# 引き継ぎメモ（2026-11-08 時点）

次のセッションが最初に読むためのメモ。解決したら該当項目を消し、不要になったらファイルごと削除する。

## 現在の状態

- バージョン 0.1.0（タグ `v0.1.0` = ee6eef8）。`main` と `develop` は GitHub（`git@github.com:msato-dev/facet.git`）へ push 済み。リモートの既定ブランチは `main`。
- 開発は `develop` ブランチで行う。作業フォルダーは WSL の `/home/mthr/data/facet`。
- ローカル（WSL）では typecheck、lint、単体・統合テスト 54 件、E2E 30 件がすべて通る。
- CI（Linux と Windows）は run 42475840279（0065e24）で両方通った。Electron 本体のダウンロードは不安定なので、CI ではキャッシュし、`install.js` を 3 回までリトライする。
- Windows 11 実機での WIN-01/WIN-02 の確認はまだ（`docs/TEST_MATRIX.md` の手動チェックリスト）。CI の成果物の EXE で確認できる。

## 環境メモ

- **push と pull**: SSH 鍵は Bitwarden（Windows デスクトップアプリの SSH エージェント）で管理している。WSL の `ssh` からはこの鍵が見えないため、このリポジトリには `git config core.sshCommand ssh.exe` を設定し、Windows の OpenSSH を使わせている（`.git/config` にだけあり、clone し直すと消える）。接続確認は `ssh.exe -T git@github.com`。
- Windows 側の Git で clone する場合は、`git config --global core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"` が必要（Git 同梱の ssh は Bitwarden のエージェントを使えない）。
- `gh` は未ログイン。WSL にブラウザーが無いので、`BROWSER=explorer.exe gh auth login -h github.com -p https --web` でログインする（2026-11-08 には GitHub の `slow_down` エラーで失敗した）。ジョブの状態と注記は、ログインなしでも公開 API（`https://api.github.com/repos/msato-dev/facet/actions/runs`）で読める。

## 未解決 1: Windows のパッケージ版 E2E が一度だけ失敗した（原因の候補を修正済み、CI で未確認）

- run 42475175994（80c7bd7）で `E2E against the packaged Windows build` が失敗した。直後の run 42475840279 では 25 件すべて通った。ログは読めておらず、落ちたテストは分かっていない。
- 原因の候補: UI-14 の E2E が、FACET の atomic 書込みの途中で Vault を `cp` し、`canvas-state.json.facet-tmp` を巻き込むことがあった（WSL で約 10 回に 1 回再現）。0e4a174 で修正した。
- 次の CI で再発しなければ、この項目を消す。再発したら run の注記（Playwright の失敗は注記に出る）でテスト名を確かめる。

## 未解決 2: Windows でのローカルビルド（`npm run dist:win`）

`C:\Users\mthr\Downloads\facet` で試した。Node は v26.13.0。

- `npm ci` の後、`node_modules\electron\dist` が無かった（Electron 本体のダウンロードが失敗していた）。
- `npm run dist:win` は Vite のビルドまで成功し、Electron の zip をダウンロードした後で `socket hang up` になった。`node node_modules/electron/install.js` は `TypeError: fetch failed`。この環境では Node から GitHub Releases へのダウンロードが不安定。
- 回避策: ブラウザーで `https://github.com/electron/electron/releases/download/v45.2.3/electron-v45.2.3-win32-x64.zip` を取得して facet フォルダーに置き、次を実行する（PowerShell ではオプションを引用符で囲む）。

  ```bash
  npx electron-builder --win portable --x64 "--config.electronDist=electron-v45.2.3-win32-x64.zip"
  ```

- portable ターゲットは NSIS なども GitHub からダウンロードするため、同じ通信エラーが出るかもしれない（未確認）。VPN、プロキシ、セキュリティソフトの HTTPS 検査を疑う。
- 代替: CI の Windows ジョブが portable EXE を成果物 `FACET-portable-win-x64` としてアップロードする（run 42475840279 から）。
