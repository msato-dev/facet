// Validation for Vault Locations changes (SPEC §7, DAT-06). Never moves, overwrites or deletes vaults.
import { access, constants, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { VaultValidation } from '../../shared/ipc/contract'
import { VaultError, VaultRepository } from '../vault/VaultRepository'

function looksAbsolute(p: string): boolean {
  return path.isAbsolute(p) || path.win32.isAbsolute(p)
}

export async function checkDirectory(p: string): Promise<string | null> {
  if (!p.trim()) return 'パスを入力してください'
  if (p.includes('\0')) return 'パスに使用できない文字が含まれています'
  if (!looksAbsolute(p)) return '絶対パスを指定してください'
  let st
  try {
    st = await stat(p)
  } catch {
    return 'フォルダーが存在しません'
  }
  if (!st.isDirectory()) return 'フォルダーではありません'
  try {
    await access(p, constants.R_OK | constants.W_OK)
    const probe = path.join(p, `.facet-write-test-${process.pid}`)
    await writeFile(probe, '')
    await rm(probe, { force: true })
  } catch {
    return 'フォルダーへの読み書き権限がありません'
  }
  return null
}

/** Validate that `p` is the existing vault of workspace `workspaceId`. */
export async function validateVaultForWorkspace(workspaceId: string, p: string): Promise<VaultValidation> {
  const dirError = await checkDirectory(p)
  if (dirError) return { ok: false, path: p, message: dirError }
  try {
    const project = await VaultRepository.readProject(p)
    if (project.workspaceId !== workspaceId)
      return { ok: false, path: p, message: `別のWorkspace「${project.name}」のVaultです。このWorkspaceのVaultを指定してください` }
    return { ok: true, path: path.resolve(p), message: `有効なVaultです（${project.name}）` }
  } catch (e) {
    return { ok: false, path: p, message: e instanceof VaultError ? e.message : 'Vault構造を確認できません' }
  }
}

/** For "Add workspace": existing vault → register; folder without FACET files → initialize. */
export async function inspectNewWorkspaceFolder(p: string): Promise<{ ok: boolean; mode?: 'register' | 'init'; message: string }> {
  const dirError = await checkDirectory(p)
  if (dirError) return { ok: false, message: dirError }
  if (await VaultRepository.isVault(p)) {
    try {
      const project = await VaultRepository.readProject(p)
      return { ok: true, mode: 'register', message: `既存のVault「${project.name}」を登録します` }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }
  const entries = await readdir(p)
  const facetFiles = ['notes-index.json', 'structure.json', 'canvas-state.json'].filter((f) => entries.includes(f))
  if (facetFiles.length) return { ok: false, message: `project.yml がないのに ${facetFiles.join(', ')} があります。Vault構造を確認してください` }
  return { ok: true, mode: 'init', message: '新しいVaultとして初期化します（既存のファイルは変更しません）' }
}
