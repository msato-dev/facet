// Registry of workspaces: settings, open sessions, watchers and the global search index.
// Electron-free so it can be exercised by integration tests.
import type { NoteId, WorkspaceId, WorkspaceSummary } from '../../shared/domain/types'
import type {
  AddWorkspaceResult,
  CommandResponse,
  GlobalSearchHit,
  SaveLocationsResult,
  VaultValidation,
  WorkspaceEvent,
} from '../../shared/ipc/contract'
import { SearchIndex } from '../search/SearchIndex'
import { SettingsStore } from '../settings/SettingsStore'
import { inspectNewWorkspaceFolder, validateVaultForWorkspace } from '../settings/vaultValidation'
import { VaultRepository } from '../vault/VaultRepository'
import { VaultWatcher } from '../watch/Watcher'
import { WorkspaceSession } from './WorkspaceSession'

export class WorkspaceManager {
  private sessions = new Map<WorkspaceId, WorkspaceSession>()
  private errors = new Map<WorkspaceId, string>()
  private watchers = new Map<WorkspaceId, VaultWatcher>()
  readonly search = new SearchIndex()

  constructor(
    readonly settings: SettingsStore,
    private emit: (e: WorkspaceEvent) => void,
    private options: { watch: boolean } = { watch: true },
  ) {}

  async init(): Promise<void> {
    await this.settings.load()
    for (const w of this.settings.data.workspaces) await this.openSession(w.id, w.vaultPath)
  }

  /** Open a vault as workspace `id` without registering it anywhere. Throws when it cannot be used. */
  private async startSession(id: WorkspaceId, vaultPath: string): Promise<WorkspaceSession> {
    const s = await WorkspaceSession.open(vaultPath, this.emit, (sess, notes) =>
      this.search.updateNotes(sess.id, notes),
    )
    if (s.id !== id) throw new Error('Vault の Workspace ID が登録内容と一致しません')
    return s
  }

  /** Make an opened session live: registry, search index and file watcher. */
  private attachSession(id: WorkspaceId, s: WorkspaceSession): void {
    this.sessions.set(id, s)
    this.errors.delete(id)
    this.search.setWorkspace(id, s.name, s.state.notes)
    if (this.options.watch) {
      const w = new VaultWatcher(
        s.vaultPath,
        (rel) => void s.handleFsChange(rel),
        () => void s.handleBibChange(),
      )
      w.start(s.bibAbsPath())
      this.watchers.set(id, w)
    }
  }

  private async openSession(id: WorkspaceId, vaultPath: string): Promise<WorkspaceSession | null> {
    try {
      const s = await this.startSession(id, vaultPath)
      this.attachSession(id, s)
      return s
    } catch (e) {
      this.errors.set(id, (e as Error).message)
      return null
    }
  }

  private async closeSession(id: WorkspaceId): Promise<void> {
    await this.watchers.get(id)?.stop()
    this.watchers.delete(id)
    this.sessions.delete(id)
    this.search.removeWorkspace(id)
  }

  summaries(): WorkspaceSummary[] {
    return this.settings.data.workspaces.map((w) => {
      const s = this.sessions.get(w.id)
      return s
        ? { id: w.id, name: s.name, vaultPath: w.vaultPath, status: 'ok' as const }
        : {
            id: w.id,
            name: w.name,
            vaultPath: w.vaultPath,
            status: 'error' as const,
            error: this.errors.get(w.id) ?? 'Vaultを開けません',
          }
    })
  }

  session(id: WorkspaceId): WorkspaceSession | undefined {
    return this.sessions.get(id)
  }

  async execute(
    id: WorkspaceId,
    fn: (s: WorkspaceSession) => Promise<CommandResponse>,
  ): Promise<CommandResponse> {
    const s = this.sessions.get(id)
    if (!s) return { ok: false, error: { code: 'not-found', message: 'Workspaceが開かれていません' } }
    return fn(s)
  }

  searchAll(query: string): GlobalSearchHit[] {
    return this.search.search(query)
  }

  async copyNote(
    from: WorkspaceId,
    noteId: NoteId,
    to: WorkspaceId,
  ): Promise<{ ok: boolean; message: string; noteId?: NoteId }> {
    const src = this.sessions.get(from)?.state.notes[noteId]
    const dst = this.sessions.get(to)
    if (!src || !dst) return { ok: false, message: 'コピー元またはコピー先が見つかりません' }
    const r = await dst.execute({ type: 'note.import', title: src.title, body: src.body, tags: src.tags })
    if (!r.ok) return { ok: false, message: r.error.message }
    const created = r.info.createdId
    const title = created ? dst.state.notes[created]?.title : src.title
    return { ok: true, message: `「${title}」を独立したコピーとして作成しました`, noteId: created }
  }

  async validateLocation(id: WorkspaceId, p: string): Promise<VaultValidation> {
    return validateVaultForWorkspace(id, p)
  }

  /**
   * Apply all location changes only if every new vault validates and actually opens; otherwise keep
   * the old settings and the old sessions untouched (SPEC §7, DAT-06).
   */
  async saveLocations(paths: Record<WorkspaceId, string>): Promise<SaveLocationsResult> {
    const results: Record<WorkspaceId, VaultValidation> = {}
    const changes: Array<[WorkspaceId, string]> = []
    for (const w of this.settings.data.workspaces) {
      const next = paths[w.id]
      if (next === undefined || next.trim() === w.vaultPath) continue
      const v = await validateVaultForWorkspace(w.id, next.trim())
      results[w.id] = v
      if (v.ok && v.path !== w.vaultPath) changes.push([w.id, v.path])
    }
    const refuse = () => ({ ok: false, results, workspaces: this.summaries() })
    if (Object.values(results).some((r) => !r.ok)) return refuse()
    if (!changes.length) return { ok: true, results, workspaces: this.summaries() }

    // Open every new vault first. Any failure discards them and keeps the old locations.
    const opened = new Map<WorkspaceId, WorkspaceSession>()
    for (const [id, p] of changes) {
      try {
        opened.set(id, await this.startSession(id, p))
      } catch (e) {
        results[id] = { ok: false, path: p, message: `Vaultを開けません: ${(e as Error).message}` }
      }
    }
    if (opened.size !== changes.length) return refuse()
    try {
      await this.settings.update((d) => ({
        ...d,
        workspaces: d.workspaces.map((w) => {
          const s = opened.get(w.id)
          return s ? { ...w, vaultPath: s.vaultPath } : w
        }),
      }))
    } catch (e) {
      for (const [id, s] of opened)
        results[id] = {
          ok: false,
          path: s.vaultPath,
          message: `設定を保存できません: ${(e as Error).message}`,
        }
      return refuse()
    }
    for (const [id, s] of opened) {
      await this.closeSession(id)
      this.attachSession(id, s)
    }
    return { ok: true, results, workspaces: this.summaries() }
  }

  async addWorkspace(p: string, name: string): Promise<AddWorkspaceResult> {
    const inspect = await inspectNewWorkspaceFolder(p)
    if (!inspect.ok) return { ok: false, message: inspect.message, workspaces: this.summaries() }
    try {
      const project =
        inspect.mode === 'init' ? await VaultRepository.init(p, name) : await VaultRepository.readProject(p)
      if (this.settings.data.workspaces.some((w) => w.id === project.workspaceId))
        return { ok: false, message: 'このVaultは既に登録されています', workspaces: this.summaries() }
      const s = await this.openSession(project.workspaceId, p)
      if (!s)
        return {
          ok: false,
          message: this.errors.get(project.workspaceId) ?? 'Vaultを開けません',
          workspaces: this.summaries(),
        }
      await this.settings.update((d) => ({
        ...d,
        workspaces: [
          ...d.workspaces,
          { id: project.workspaceId, name: project.name, vaultPath: s.vaultPath },
        ],
        lastWorkspaceId: d.lastWorkspaceId ?? project.workspaceId,
      }))
      const ws = this.summaries().find((w) => w.id === project.workspaceId)
      return { ok: true, message: inspect.message, workspace: ws, workspaces: this.summaries() }
    } catch (e) {
      return { ok: false, message: (e as Error).message, workspaces: this.summaries() }
    }
  }

  /** Unregister only; vault files are left untouched. */
  async removeWorkspace(id: WorkspaceId): Promise<WorkspaceSummary[]> {
    await this.closeSession(id)
    await this.settings.update((d) => ({
      ...d,
      workspaces: d.workspaces.filter((w) => w.id !== id),
      lastWorkspaceId:
        d.lastWorkspaceId === id ? (d.workspaces.find((w) => w.id !== id)?.id ?? null) : d.lastWorkspaceId,
    }))
    return this.summaries()
  }

  async setBibliography(id: WorkspaceId, abs: string): Promise<void> {
    const s = this.sessions.get(id)
    if (!s) return
    await s.setBibliography(abs)
    this.watchers.get(id)?.watchBib(s.bibAbsPath())
  }

  /** Wait for every workspace's queued writes and for pending settings writes. */
  async idle(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.idle()))
    await this.settings.idle()
  }

  async dispose(): Promise<void> {
    await this.idle()
    for (const id of [...this.sessions.keys()]) await this.closeSession(id)
    await this.settings.idle()
  }
}
