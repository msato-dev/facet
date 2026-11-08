# バージョン付けの方針

FACET は `MAJOR.MINOR.PATCH` 形式（Semantic Versioning 準拠）を使う。

- **プロトタイプ期間は `0.MINOR.PATCH`**。`1.0.0` は、Windows 11 実機での受け入れテスト（WIN-01/WIN-02 を含む）を通り、日常の論文作業に使えると判断した時点で付ける。
- **MINOR**: 機能追加、UI や操作体系の変更、Vault 形式（`schemaVersion`）の変更。0.x の間は、互換性のない変更も MINOR で表す。
- **PATCH**: 不具合修正や小さな改善で、Vault 形式を変えないもの。
- 各要素は **10 以上の値も取る**（Python と同様、桁上がりしない）。例: `0.9.0` → `0.10.0`、`0.12.15`。
- バージョンは `package.json` の `version` を唯一の正本とする。アプリ（ステータスバー、Settings）と portable EXE のファイル名（`FACET-<version>-portable-x64.exe`）はこの値を使う。
- リリース時は `v<version>` の Git タグ（例: `v0.1.0`）を付け、`CHANGELOG.md` に変更内容を記録する。

## 手順

```bash
npm version 0.2.0 --no-git-tag-version   # package.json と package-lock.json を更新
# CHANGELOG.md を更新してコミット
git tag -a v0.2.0 -m "FACET 0.2.0"
```
