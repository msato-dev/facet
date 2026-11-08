// One open workspace: the single writer for its vault (ADR-002).
import path from 'node:path'
import {
  applyCommand,
  commandLabel,
  isUndoable,
  type Command,
  type CommandContext,
} from '../../shared/domain/commands'
import { UndoStack, diffState } from '../../shared/domain/history'
import { newId } from '../../shared/domain/ids'
import type {
  BibliographyState,
  DomainState,
  NoteId,
  TrashEntry,
  VaultIssue,
  WorkspaceSnapshot,
} from '../../shared/domain/types'
import type { CommandResponse, WorkspaceEvent } from '../../shared/ipc/contract'
import { loadBibliography } from '../bib/bib'
import { VaultError, VaultRepository, FILES } from '../vault/VaultRepository'

const ctx: CommandContext = { newId, now: () => new Date().toISOString() }

export class WorkspaceSession {
  state!: DomainState
  bibliography: BibliographyState = { source: FILES.bibDefault, entries: [], issues: [], loadedAt: null }
  issues: VaultIssue[] = []
  trash: TrashEntry[] = []
  private undoStack = new UndoStack()
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(
    public readonly id: string,
    public name: string,
    public readonly vaultPath: string,
    public repo: VaultRepository,
    private emit: (e: WorkspaceEvent) => void,
    private onNotesChanged: (s: WorkspaceSession, patch: ReturnType<typeof diffState>['notes']) => void,
  ) {}

  static async open(
    vaultPath: string,
    emit: (e: WorkspaceEvent) => void,
    onNotesChanged: (s: WorkspaceSession, patch: ReturnType<typeof diffState>['notes']) => void,
  ): Promise<WorkspaceSession> {
    const { repo, loaded } = await VaultRepository.open(vaultPath)
    const s = new WorkspaceSession(
      loaded.project.workspaceId,
      loaded.project.name,
      repo.root,
      repo,
      emit,
      onNotesChanged,
    )
    s.state = loaded.state
    s.issues = loaded.issues
    s.trash = loaded.trash
    await s.loadBib()
    return s
  }

  /** Resolves when every queued mutation (and its file writes) has finished. */
  idle(): Promise<void> {
    return this.queue.then(() => undefined)
  }

  /** Serialize every mutation of this workspace. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  snapshot(): WorkspaceSnapshot {
    return {
      id: this.id,
      name: this.name,
      vaultPath: this.vaultPath,
      state: this.state,
      bibliography: this.bibliography,
      issues: this.issues,
      trash: this.trash,
      canUndo: this.undoStack.canUndo,
      canRedo: this.undoStack.canRedo,
    }
  }

  private async commit(next: DomainState, label: string | null): Promise<CommandResponse> {
    const prev = this.state
    try {
      await this.repo.persist(prev, next)
    } catch (e) {
      if (e instanceof VaultError && e.code === 'conflict') {
        await this.absorbExternalChanges(e.conflictFiles)
        return {
          ok: false,
          error: {
            code: 'conflict',
            message: `${e.message}。外部の変更を読み込みました。内容を確認してから再度保存してください`,
          },
        }
      }
      return { ok: false, error: { code: 'invalid', message: `保存に失敗しました: ${(e as Error).message}` } }
    }
    this.state = next
    if (label) this.undoStack.record(prev, next, label)
    this.trash = this.repo.trashEntries()
    const patch = diffState(prev, next)
    if (Object.keys(patch.notes).length) this.onNotesChanged(this, patch.notes)
    return {
      ok: true,
      patch,
      info: {},
      canUndo: this.undoStack.canUndo,
      canRedo: this.undoStack.canRedo,
      trash: this.trash,
    }
  }

  execute(cmd: Command): Promise<CommandResponse> {
    return this.enqueue(async () => {
      const r = applyCommand(this.state, cmd, ctx)
      if (!r.ok) return { ok: false, error: r.error }
      if (r.state === this.state)
        return {
          ok: true,
          patch: { notes: {} },
          info: r.info,
          canUndo: this.undoStack.canUndo,
          canRedo: this.undoStack.canRedo,
          trash: this.trash,
        }
      const res = await this.commit(r.state, isUndoable(cmd) ? commandLabel(cmd) : null)
      if (res.ok) res.info = r.info
      if (res.ok && cmd.type === 'note.restore') {
        await this.repo.purgeTrashFile(cmd.note.id).catch(() => undefined)
        res.trash = this.trash
      }
      return res
    })
  }

  undo(): Promise<CommandResponse> {
    return this.enqueue(async () => {
      const r = this.undoStack.undo(this.state)
      if (!r.ok) return { ok: false, error: { code: 'invalid', message: r.message } }
      return this.commitHistory(r.state, () => this.undoStack.redo(r.state))
    })
  }

  redo(): Promise<CommandResponse> {
    return this.enqueue(async () => {
      const r = this.undoStack.redo(this.state)
      if (!r.ok) return { ok: false, error: { code: 'invalid', message: r.message } }
      return this.commitHistory(r.state, () => this.undoStack.undo(r.state))
    })
  }

  private async commitHistory(next: DomainState, revert: () => unknown): Promise<CommandResponse> {
    const prev = this.state
    try {
      await this.repo.persist(prev, next)
    } catch (e) {
      revert()
      return {
        ok: false,
        error: { code: 'conflict', message: `保存に失敗しました: ${(e as Error).message}` },
      }
    }
    this.state = next
    this.trash = this.repo.trashEntries()
    const patch = diffState(prev, next)
    if (Object.keys(patch.notes).length) this.onNotesChanged(this, patch.notes)
    return {
      ok: true,
      patch,
      info: {},
      canUndo: this.undoStack.canUndo,
      canRedo: this.undoStack.canRedo,
      trash: this.trash,
    }
  }

  restoreFromTrash(noteId: NoteId): Promise<CommandResponse> {
    return this.repo.readTrashed(noteId).then((note) => {
      if (!note)
        return {
          ok: false,
          error: { code: 'not-found', message: 'ゴミ箱にメモが見つかりません' },
        } as CommandResponse
      return this.execute({ type: 'note.restore', note })
    })
  }

  async loadBib(): Promise<void> {
    const { source, abs } = this.repo.bibliographyPath()
    this.bibliography = await loadBibliography(abs, source)
  }

  bibAbsPath(): string {
    return this.repo.bibliographyPath().abs
  }

  async setBibliography(abs: string): Promise<void> {
    const rel = path.relative(this.vaultPath, abs)
    const source = !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : abs
    await this.enqueue(() => this.repo.writeProject({ ...this.repo.project, bibliography: source }))
    await this.loadBib()
  }

  /** Bring externally edited files into the in-memory state (never overwriting them). */
  private async absorbExternalChanges(rels: string[]): Promise<void> {
    const noteRels = rels.filter((r) => r.startsWith(`${FILES.notesDir}/`))
    if (noteRels.length !== rels.length) {
      await this.fullReload('外部でVaultのファイルが変更されたため再読込しました')
      return
    }
    const changed: NoteId[] = []
    let next = this.state
    for (const rel of noteRels) {
      const id = this.repo.noteIdOfFile(rel)
      if (!id) {
        // A Markdown file FACET does not know yet: reconcile like on open (import it with an id).
        await this.fullReload('外部で追加されたメモを取り込みました')
        return
      }
      const fresh = await this.repo.reloadNote(id)
      const cur = next.notes[id]
      if (!fresh || !cur) {
        await this.fullReload('外部でメモファイルが追加・削除されたため再読込しました')
        return
      }
      next = {
        ...next,
        notes: { ...next.notes, [id]: { ...cur, title: fresh.title, body: fresh.body, rev: cur.rev + 1 } },
      }
      changed.push(id)
    }
    if (!changed.length) return
    const patch = diffState(this.state, next)
    this.state = next
    this.onNotesChanged(this, patch.notes)
    this.emit({
      type: 'external-change',
      workspaceId: this.id,
      patch,
      changedNoteIds: changed,
      message: '外部で編集されたメモを読み込みました',
    })
  }

  private async fullReload(message: string): Promise<void> {
    const loaded = await this.repo.load()
    this.state = loaded.state
    this.issues = loaded.issues
    this.trash = loaded.trash
    this.name = loaded.project.name
    this.undoStack.clear()
    await this.loadBib()
    this.onNotesChanged(this, Object.fromEntries(Object.entries(this.state.notes)))
    this.emit({ type: 'reloaded', workspaceId: this.id, snapshot: this.snapshot(), message })
  }

  /** Called by the watcher for a vault-relative path. */
  handleFsChange(rel: string): Promise<void> {
    return this.enqueue(async () => {
      if (rel.endsWith('.bib') || path.resolve(this.vaultPath, rel) === path.resolve(this.bibAbsPath())) {
        await this.loadBib()
        this.emit({ type: 'bibliography', workspaceId: this.id, snapshot: this.snapshot() })
        return
      }
      const tracked = [FILES.project, FILES.index, FILES.structure, FILES.canvas] as string[]
      // Notes are the .md files directly under notes/ (the same set load() reads).
      const isNote =
        /^[^/]+\.md$/i.test(rel.slice(FILES.notesDir.length + 1)) && rel.startsWith(`${FILES.notesDir}/`)
      if (!isNote && !tracked.includes(rel)) return
      if (!(await this.repo.isExternallyChanged(rel).catch(() => true))) return
      await this.absorbExternalChanges([rel])
    })
  }

  async handleBibChange(): Promise<void> {
    await this.enqueue(async () => {
      await this.loadBib()
      this.emit({ type: 'bibliography', workspaceId: this.id, snapshot: this.snapshot() })
    })
  }
}
