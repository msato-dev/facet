// Vault I/O: load, reconcile, persist state diffs atomically, detect external edits.
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import YAML from 'yaml'
import { defaultCanvasState } from '../../shared/domain/canvas'
import { diffState } from '../../shared/domain/history'
import { isValidId, newId } from '../../shared/domain/ids'
import { sanitizeStructure } from '../../shared/domain/sanitize'
import { emptyStructure } from '../../shared/domain/structure'
import type {
  CanvasState,
  DomainState,
  Note,
  NoteId,
  Structure,
  TrashEntry,
  VaultIssue,
} from '../../shared/domain/types'
import { exists, sha256, stampOf, writeFileAtomic, type FileStamp } from './atomic'
import { recoverJournals, runTransaction, type PlannedOp } from './journal'
import { parseNoteFile, serializeNote } from './noteFile'
import { realRootOf, resolveInVault } from './pathGuard'
import {
  zCanvasState,
  zNotesIndex,
  zProject,
  zStructure,
  zTrashIndex,
  type NoteMetaFile,
  type NotesIndexFile,
  type ProjectFile,
  type TrashIndexFile,
} from './schemas'

export const FILES = {
  project: 'project.yml',
  index: 'notes-index.json',
  structure: 'structure.json',
  canvas: 'canvas-state.json',
  trashIndex: '.facet/trash/index.json',
  notesDir: 'notes',
  trashDir: '.facet/trash',
  bibDefault: 'references/library.bib',
} as const

export class VaultError extends Error {
  constructor(
    message: string,
    public code: 'not-a-vault' | 'invalid-file' | 'conflict' | 'io' = 'io',
    public conflictFiles: string[] = [],
  ) {
    super(message)
  }
}

export interface LoadedVault {
  project: ProjectFile
  state: DomainState
  issues: VaultIssue[]
  trash: TrashEntry[]
}

function json(data: unknown): string {
  return JSON.stringify(data, null, 2) + '\n'
}

function nowIso(): string {
  return new Date().toISOString()
}

export class VaultRepository {
  /** Last known on-disk stamp per vault-relative path (forward slashes). */
  private known = new Map<string, FileStamp>()
  /** Relative file path per note id. */
  private noteFiles = new Map<NoteId, string>()
  private trashIndex: TrashIndexFile = { schemaVersion: 1, entries: [] }
  project!: ProjectFile

  private constructor(public readonly root: string) {}

  static async isVault(dir: string): Promise<boolean> {
    return exists(path.join(dir, FILES.project))
  }

  /** Create the FACET files in `dir` without touching anything else that is already there. */
  static async init(dir: string, name: string): Promise<ProjectFile> {
    const root = await realRootOf(dir)
    for (const f of [FILES.project, FILES.index, FILES.structure, FILES.canvas]) {
      if (await exists(path.join(root, f))) throw new VaultError(`${f} が既に存在します`, 'invalid-file')
    }
    const project: ProjectFile = {
      schemaVersion: 1,
      workspaceId: newId(),
      name: name.trim() || path.basename(root),
      createdAt: nowIso(),
    }
    await mkdir(path.join(root, FILES.notesDir), { recursive: true })
    await mkdir(path.join(root, 'references'), { recursive: true })
    await writeFileAtomic(path.join(root, FILES.structure), json(emptyStructure()))
    await writeFileAtomic(path.join(root, FILES.canvas), json(defaultCanvasState()))
    await writeFileAtomic(path.join(root, FILES.index), json({ schemaVersion: 1, notes: {} }))
    await writeFileAtomic(path.join(root, FILES.project), YAML.stringify(project))
    return project
  }

  static async readProject(dir: string): Promise<ProjectFile> {
    const file = path.join(dir, FILES.project)
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      throw new VaultError('project.yml が見つかりません。FACET Vaultではありません', 'not-a-vault')
    }
    const parsed = zProject.safeParse(YAML.parse(text))
    if (!parsed.success) throw new VaultError('project.yml の形式が正しくありません', 'invalid-file')
    return parsed.data
  }

  static async open(dir: string): Promise<{ repo: VaultRepository; loaded: LoadedVault }> {
    const root = await realRootOf(dir)
    const repo = new VaultRepository(root)
    const loaded = await repo.load()
    return { repo, loaded }
  }

  private async abs(rel: string): Promise<string> {
    return resolveInVault(this.root, rel)
  }

  private async readText(rel: string): Promise<string | null> {
    const file = await this.abs(rel)
    try {
      const [buf, st] = await Promise.all([readFile(file), stat(file)])
      this.known.set(rel, { mtimeMs: st.mtimeMs, size: st.size, hash: sha256(buf) })
      return buf.toString('utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.known.delete(rel)
        return null
      }
      throw e
    }
  }

  private async readJson<T>(
    rel: string,
    schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  ): Promise<T | null> {
    const text = await this.readText(rel)
    if (text === null) return null
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new VaultError(`${rel} を読み込めません（JSONの構文エラー）`, 'invalid-file')
    }
    const r = schema.safeParse(data)
    if (!r.success) throw new VaultError(`${rel} の形式が正しくありません`, 'invalid-file')
    return r.data
  }

  async load(): Promise<LoadedVault> {
    const issues: VaultIssue[] = []
    const journals = await recoverJournals(this.root)
    if (journals.recovered)
      issues.push({
        kind: 'recovered-journal',
        message: `中断された書込み ${journals.recovered} 件をロールバックしました`,
      })
    for (const dir of journals.quarantined)
      issues.push({
        kind: 'quarantined-journal',
        message: `不正な書込みジャーナルを実行せず ${dir} へ移しました。内容を確認してください`,
      })
    this.known.clear()
    this.noteFiles.clear()
    const projectText = await this.readText(FILES.project)
    if (projectText === null)
      throw new VaultError('project.yml が見つかりません。FACET Vaultではありません', 'not-a-vault')
    const project = zProject.safeParse(YAML.parse(projectText))
    if (!project.success) throw new VaultError('project.yml の形式が正しくありません', 'invalid-file')
    this.project = project.data

    const index: NotesIndexFile = (await this.readJson(FILES.index, zNotesIndex)) ?? {
      schemaVersion: 1,
      notes: {},
    }
    const fileToId = new Map<string, NoteId>()
    for (const [id, meta] of Object.entries(index.notes)) fileToId.set(meta.file.replace(/\\/g, '/'), id)

    const notes: Record<NoteId, Note> = {}
    let mdFiles: string[] = []
    try {
      mdFiles = (await readdir(path.join(this.root, FILES.notesDir), { withFileTypes: true }))
        .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.md'))
        .map((d) => `${FILES.notesDir}/${d.name}`)
    } catch {
      await mkdir(path.join(this.root, FILES.notesDir), { recursive: true })
    }
    const seen = new Set<NoteId>()
    const contents = new Map<string, string | null>()
    const sorted = mdFiles.sort()
    for (let i = 0; i < sorted.length; i += 64) {
      const batch = sorted.slice(i, i + 64)
      const texts = await Promise.all(batch.map((rel) => this.readText(rel)))
      batch.forEach((rel, j) => contents.set(rel, texts[j]))
    }
    for (const rel of sorted) {
      const content = contents.get(rel) ?? null
      if (content === null) continue
      const stem = path.basename(rel, path.extname(rel))
      let id = fileToId.get(rel)
      let meta: NoteMetaFile | undefined = id ? index.notes[id] : undefined
      if (!id) {
        id = isValidId(stem) && !index.notes[stem] ? stem : newId()
        const st = this.known.get(rel)
        const t = st ? new Date(st.mtimeMs).toISOString() : nowIso()
        meta = { file: rel, tags: [], createdAt: t, updatedAt: t, archived: false, lastPlacement: null }
        issues.push({
          kind: 'imported-orphan',
          message: `インデックスにない ${rel} を取り込みました`,
          noteId: id,
        })
      }
      const parsed = parseNoteFile(content, stem)
      if (!parsed.hasTitle)
        issues.push({
          kind: 'missing-title',
          message: `${rel} の先頭に「# タイトル」がありません。ファイル名をタイトルとして扱います`,
          noteId: id,
        })
      notes[id] = {
        id,
        title: parsed.title,
        body: parsed.body,
        tags: meta!.tags,
        createdAt: meta!.createdAt,
        updatedAt: meta!.updatedAt,
        archived: meta!.archived,
        lastPlacement: meta!.lastPlacement,
        rev: 1,
      }
      this.noteFiles.set(id, rel)
      seen.add(id)
    }
    for (const [id, meta] of Object.entries(index.notes)) {
      if (!seen.has(id))
        issues.push({
          kind: 'missing-note-file',
          message: `メモファイル ${meta.file} が見つかりません`,
          noteId: id,
        })
    }

    const rawStructure = ((await this.readJson(FILES.structure, zStructure)) ?? emptyStructure()) as Structure
    const canvas = ((await this.readJson(FILES.canvas, zCanvasState)) ?? defaultCanvasState()) as CanvasState
    const sanitized = sanitizeStructure({ notes, structure: rawStructure, canvas })
    issues.push(...sanitized.issues)
    this.trashIndex = (await this.readJson(FILES.trashIndex, zTrashIndex)) ?? {
      schemaVersion: 1,
      entries: [],
    }

    const state: DomainState = { notes, structure: sanitized.structure, canvas }
    const needsIndexWrite = issues.some((i) => i.kind === 'imported-orphan' || i.kind === 'missing-note-file')
    if (needsIndexWrite) await this.writeSingle(FILES.index, json(this.buildIndex(state)))
    if (sanitized.issues.length) await this.writeSingle(FILES.structure, json(sanitized.structure))
    return { project: this.project, state, issues, trash: this.trashEntries() }
  }

  trashEntries(): TrashEntry[] {
    return this.trashIndex.entries.map((e) => ({ id: e.id, title: e.title, deletedAt: e.deletedAt }))
  }

  private buildIndex(state: DomainState): NotesIndexFile {
    const notes: NotesIndexFile['notes'] = {}
    for (const n of Object.values(state.notes).sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )) {
      notes[n.id] = {
        file: this.noteFiles.get(n.id) ?? `${FILES.notesDir}/${n.id}.md`,
        tags: n.tags,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        archived: n.archived,
        lastPlacement: n.lastPlacement,
      }
    }
    return { schemaVersion: 1, notes }
  }

  private async writeSingle(rel: string, content: string): Promise<void> {
    const file = await this.abs(rel)
    await this.assertUnchanged([rel])
    await writeFileAtomic(file, content)
    const st = await stampOf(file)
    if (st) this.known.set(rel, st)
  }

  /** Throw a conflict error if any of `rels` changed on disk since FACET last read or wrote it. */
  private async assertUnchanged(rels: string[]): Promise<void> {
    const conflicts: string[] = []
    for (const rel of rels) {
      const knownStamp = this.known.get(rel)
      const current = await stampOf(await this.abs(rel))
      if (!knownStamp && !current) continue // a new file
      // Created or deleted externally: never recreate or overwrite silently (DAT-05).
      if (!knownStamp || !current) conflicts.push(rel)
      // Always compare content: size and mtime can match after a timestamp-preserving replace.
      else if (current.hash !== knownStamp.hash) conflicts.push(rel)
    }
    if (conflicts.length)
      throw new VaultError(
        `外部で変更されたファイルがあります: ${conflicts.join(', ')}`,
        'conflict',
        conflicts,
      )
  }

  /** Persist the difference between two states. Nothing is written if any target changed externally. */
  async persist(prev: DomainState, next: DomainState): Promise<void> {
    const patch = diffState(prev, next)
    const writes = new Map<string, string>()
    const moves: Array<{ from: string; to: string }> = []
    let indexDirty = false
    let trashDirty = false
    const trash = { ...this.trashIndex, entries: [...this.trashIndex.entries] }
    const newNoteFiles = new Map(this.noteFiles)

    for (const [id, note] of Object.entries(patch.notes)) {
      const before = prev.notes[id]
      if (note) {
        indexDirty = true
        const rel = newNoteFiles.get(id) ?? `${FILES.notesDir}/${id}.md`
        newNoteFiles.set(id, rel)
        if (!before || before.title !== note.title || before.body !== note.body)
          writes.set(rel, serializeNote(note.title, note.body))
        const tIdx = trash.entries.findIndex((e) => e.id === id)
        if (tIdx >= 0) {
          trash.entries.splice(tIdx, 1)
          trashDirty = true
        }
      } else if (before) {
        indexDirty = true
        const rel = newNoteFiles.get(id) ?? `${FILES.notesDir}/${id}.md`
        const trashRel = `${FILES.trashDir}/${id}.md`
        if (await exists(await this.abs(rel))) moves.push({ from: rel, to: trashRel })
        else writes.set(trashRel, serializeNote(before.title, before.body))
        newNoteFiles.delete(id)
        trash.entries = trash.entries.filter((e) => e.id !== id)
        trash.entries.push({
          id,
          title: before.title,
          deletedAt: nowIso(),
          file: trashRel,
          meta: {
            file: rel,
            tags: before.tags,
            createdAt: before.createdAt,
            updatedAt: before.updatedAt,
            archived: before.archived,
            lastPlacement: null,
          },
        })
        trashDirty = true
      }
    }
    const savedFiles = this.noteFiles
    this.noteFiles = newNoteFiles
    try {
      if (indexDirty) writes.set(FILES.index, json(this.buildIndex(next)))
    } finally {
      this.noteFiles = savedFiles
    }
    if (patch.structure) writes.set(FILES.structure, json(next.structure))
    if (patch.canvas) writes.set(FILES.canvas, json(next.canvas))
    if (trashDirty) writes.set(FILES.trashIndex, json(trash))

    const touched = [...writes.keys(), ...moves.map((m) => m.from)]
    if (!touched.length) return
    await this.assertUnchanged(touched)

    if (writes.size === 1 && moves.length === 0) {
      const [[rel, content]] = [...writes]
      await writeFileAtomic(await this.abs(rel), content)
    } else {
      const ops: PlannedOp[] = []
      for (const m of moves) ops.push({ type: 'move', from: m.from, to: m.to })
      for (const [rel, content] of writes) ops.push({ type: 'write', rel, content })
      await runTransaction(this.root, ops)
    }
    this.noteFiles = newNoteFiles
    this.trashIndex = trash
    for (const m of moves) this.known.delete(m.from)
    for (const rel of [...writes.keys(), ...moves.map((m) => m.to)]) {
      const st = await stampOf(await this.abs(rel))
      if (st) this.known.set(rel, st)
    }
  }

  /** Read a trashed note back (for restore). */
  async readTrashed(id: NoteId): Promise<Omit<Note, 'rev'> | null> {
    const entry = this.trashIndex.entries.find((e) => e.id === id)
    if (!entry) return null
    const content = await readFile(await this.abs(entry.file), 'utf8').catch(() => null)
    if (content === null) return null
    const parsed = parseNoteFile(content, entry.title)
    return {
      id,
      title: parsed.title,
      body: parsed.body,
      tags: entry.meta.tags,
      createdAt: entry.meta.createdAt,
      updatedAt: nowIso(),
      archived: false,
      lastPlacement: null,
    }
  }

  /** After a note is restored, remove its copy from the trash folder. */
  async purgeTrashFile(id: NoteId): Promise<void> {
    await rm(await this.abs(`${FILES.trashDir}/${id}.md`), { force: true })
  }

  relOfNote(id: NoteId): string | undefined {
    return this.noteFiles.get(id)
  }

  noteIdOfFile(rel: string): NoteId | undefined {
    for (const [id, r] of this.noteFiles) if (r === rel) return id
    return undefined
  }

  /** True when the on-disk file differs from what FACET last read or wrote. */
  async isExternallyChanged(rel: string): Promise<boolean> {
    const knownStamp = this.known.get(rel)
    const current = await stampOf(await this.abs(rel)).catch(() => null)
    if (!knownStamp || !current) return !!knownStamp !== !!current
    return current.hash !== knownStamp.hash
  }

  /** Re-read one note file after an external edit. */
  async reloadNote(id: NoteId): Promise<{ title: string; body: string } | null> {
    const rel = this.noteFiles.get(id)
    if (!rel) return null
    const content = await this.readText(rel)
    if (content === null) return null
    const parsed = parseNoteFile(content, path.basename(rel, '.md'))
    return { title: parsed.title, body: parsed.body }
  }

  async writeProject(project: ProjectFile): Promise<void> {
    await this.writeSingle(FILES.project, YAML.stringify(project))
    this.project = project
  }

  bibliographyPath(): { source: string; abs: string } {
    const source = this.project.bibliography || FILES.bibDefault
    const abs = path.isAbsolute(source) ? source : path.join(this.root, source)
    return { source, abs }
  }
}
