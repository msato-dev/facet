// Settings / Vault Locations (SPEC §7, UI-14, DAT-06).
import { useState } from 'react'
import type { VaultValidation } from '../../shared/ipc/contract'
import { Modal } from '../common/Dialogs'
import { confirmAction, ensureSaved, promptText, refreshWorkspaces, toast, useApp } from '../store/store'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const workspaces = useApp((s) => s.workspaces)
  const version = useApp((s) => s.version)
  const [paths, setPaths] = useState<Record<string, string>>(() =>
    Object.fromEntries(workspaces.map((w) => [w.id, w.vaultPath])),
  )
  const [results, setResults] = useState<Record<string, VaultValidation>>({})
  const [busy, setBusy] = useState(false)

  const browse = async (id: string) => {
    const p = await window.facet.browseFolder(paths[id] || undefined)
    if (p) {
      setPaths((s) => ({ ...s, [id]: p }))
      setResults((s) => ({ ...s, [id]: undefined as never }))
    }
  }
  const validate = async (id: string) => {
    const p = paths[id]
    const w = workspaces.find((x) => x.id === id)
    if (!w || p.trim() === w.vaultPath) return
    const v = await window.facet.validateVaultPath(id, p)
    setResults((s) => ({ ...s, [id]: v }))
  }
  const save = async () => {
    setBusy(true)
    try {
      // SPEC §7: unsaved edits are dealt with before any location changes.
      if (!(await ensureSaved())) return
      const changed = Object.fromEntries(
        Object.entries(paths).filter(
          ([id, p]) => workspaces.find((w) => w.id === id)?.vaultPath !== p.trim(),
        ),
      )
      if (!Object.keys(changed).length) return onClose()
      const r = await window.facet.saveVaultLocations(changed)
      setResults(r.results)
      if (!r.ok) {
        toast('無効な参照先があるため保存しませんでした（元の参照先を維持）', 'error')
        return
      }
      await refreshWorkspaces(r.workspaces)
      toast('Vault参照先を保存しました')
      onClose()
    } finally {
      setBusy(false)
    }
  }
  const add = async () => {
    const p = await window.facet.browseFolder()
    if (!p) return
    const name = await promptText('Workspace名', {
      label: '新規Vaultの場合の名前（既存Vaultは保存済みの名前を使用）',
      initial: p.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Workspace',
      okLabel: '追加',
    })
    if (name === null) return
    const r = await window.facet.addWorkspace(p, name)
    if (!r.ok) return toast(r.message, 'error')
    toast(r.message)
    setPaths((s) => ({ ...s, [r.workspace!.id]: r.workspace!.vaultPath }))
    useApp.setState({ workspaces: r.workspaces })
    if (!useApp.getState().activeId) await refreshWorkspaces(r.workspaces)
  }
  const remove = async (id: string, name: string) => {
    if (
      !(await confirmAction(
        '登録解除',
        `「${name}」を一覧から外します。Vaultのファイルは移動・削除されません。`,
        { okLabel: '登録解除' },
      ))
    )
      return
    if (id === useApp.getState().activeId && !(await ensureSaved())) return
    const list = await window.facet.removeWorkspace(id)
    setPaths((s) => {
      const n = { ...s }
      delete n[id]
      return n
    })
    await refreshWorkspaces(list)
  }

  return (
    <Modal title="⚙ Settings" onClose={onClose} testId="settings-dialog">
      <div className="settings-heading">Vault Locations</div>
      <div className="helper">
        WorkspaceごとのVault参照先ディレクトリ。変更しても元のVaultは移動・上書き・削除されません。
      </div>
      <div className="settings-workspaces">
        {workspaces.length === 0 && (
          <div className="empty">
            Workspaceが登録されていません。「Add workspace…」でフォルダーを選択してください。
          </div>
        )}
        {workspaces.map((w) => {
          const v = results[w.id]
          return (
            <div className="vault-row" key={w.id} data-testid="vault-row">
              <label htmlFor={`vault-${w.id}`}>
                {w.name}
                {w.status === 'error' && <span className="badge error">unavailable</span>}
              </label>
              <div className="row gap">
                <input
                  id={`vault-${w.id}`}
                  className="input grow mono"
                  data-testid="vault-path"
                  spellCheck={false}
                  value={paths[w.id] ?? ''}
                  onChange={(e) => setPaths((s) => ({ ...s, [w.id]: e.target.value }))}
                  onBlur={() => void validate(w.id)}
                />
                <button className="btn" data-testid="vault-browse" onClick={() => void browse(w.id)}>
                  Browse…
                </button>
                <button
                  className="btn"
                  title="一覧から外す（ファイルは削除しません）"
                  onClick={() => void remove(w.id, w.name)}
                >
                  Remove
                </button>
              </div>
              {v ? (
                <div className={v.ok ? 'helper ok' : 'field-error'} data-testid="vault-validation">
                  {v.message}
                </div>
              ) : (
                w.error && <div className="field-error">{w.error}</div>
              )}
            </div>
          )
        })}
      </div>
      <div className="row gap" style={{ marginTop: 10 }}>
        <button className="btn" data-testid="add-workspace" onClick={() => void add()}>
          ＋ Add workspace…
        </button>
        <span className="helper">
          空のフォルダーは新しいVaultとして初期化、既存のVaultはそのまま登録します。
        </span>
      </div>
      <div className="settings-hint helper">
        設定はWindowsユーザープロファイル下に保存され、ポータブルEXEを移動しても維持されます。 FACET v
        {version}
      </div>
      <div className="modal-actions">
        <button className="btn" data-testid="settings-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          data-testid="settings-save"
          disabled={busy}
          onClick={() => void save()}
        >
          Save settings
        </button>
      </div>
    </Modal>
  )
}
