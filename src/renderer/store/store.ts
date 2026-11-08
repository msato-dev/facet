// Renderer state: a read-only copy of the workspace snapshot plus UI state. All mutations go to Main.
import { create } from 'zustand'
import type { Command, CommandInfo } from '../../shared/domain/commands'
import { applyPatch } from '../../shared/domain/history'
import type {
  GroupId,
  NoteId,
  SectionId,
  WorkspaceId,
  WorkspaceSnapshot,
  WorkspaceSummary,
} from '../../shared/domain/types'
import type { CommandResponse, WorkspaceEvent } from '../../shared/ipc/contract'

export type Tab = 'Canvas' | 'Outline' | 'Cards' | 'Reference'
export type Scope = 'all' | 'unassigned' | SectionId

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
  action?: { label: string; run: () => void }
}

export type DialogRequest =
  | {
      kind: 'prompt'
      title: string
      label?: string
      initial?: string
      okLabel?: string
      resolve: (v: string | null) => void
    }
  | {
      kind: 'confirm'
      title: string
      message: string
      okLabel?: string
      danger?: boolean
      resolve: (v: boolean) => void
    }
  | { kind: 'citation'; noteId: NoteId | null }
  | { kind: 'settings' }
  | { kind: 'trash' }
  | { kind: 'manuscript-fullscreen' }

export interface CardsOptions {
  query: string
  groupBy: 'tag' | 'outline' | 'none'
  sort: 'created' | 'newest' | 'title'
  showArchived: boolean
}

interface AppState {
  ready: boolean
  version: string
  e2e: boolean
  workspaces: WorkspaceSummary[]
  activeId: WorkspaceId | null
  snapshot: WorkspaceSnapshot | null
  loadError: string | null
  tab: Tab
  globalSearch: boolean
  scope: Scope
  selectedNoteId: NoteId | null
  selectedGroupId: GroupId | null
  multiSelect: boolean
  selectedNoteIds: NoteId[]
  clipboard: { workspaceId: WorkspaceId; noteId: NoteId } | null
  leftOpen: boolean
  rightOpen: boolean
  manuscriptSplit: boolean
  outlineCollapsed: string[]
  inlineNoteId: NoteId | null
  scrollToSection: { id: SectionId; nonce: number } | null
  cards: CardsOptions
  toasts: Toast[]
  dialogs: DialogRequest[]
  saving: number
}

export const useApp = create<AppState>(() => ({
  ready: false,
  version: '',
  e2e: false,
  workspaces: [],
  activeId: null,
  snapshot: null,
  loadError: null,
  tab: 'Canvas',
  globalSearch: false,
  scope: 'all',
  selectedNoteId: null,
  selectedGroupId: null,
  multiSelect: false,
  selectedNoteIds: [],
  clipboard: null,
  leftOpen: true,
  rightOpen: true,
  manuscriptSplit: false,
  outlineCollapsed: [],
  inlineNoteId: null,
  scrollToSection: null,
  cards: { query: '', groupBy: 'tag', sort: 'created', showArchived: false },
  toasts: [],
  dialogs: [],
  saving: 0,
}))

const set = useApp.setState
const get = useApp.getState

// ---------------------------------------------------------------------------
// Toasts and dialogs

let toastId = 0
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']): void {
  const id = ++toastId
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind, action }] }))
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), action ? 7000 : 3200)
}

export function dismissToast(id: number): void {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

export function openDialog(d: DialogRequest): void {
  set((s) => ({ dialogs: [...s.dialogs, d] }))
}

export function closeDialog(d: DialogRequest): void {
  set((s) => ({ dialogs: s.dialogs.filter((x) => x !== d) }))
}

export function promptText(
  title: string,
  opts: { label?: string; initial?: string; okLabel?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => openDialog({ kind: 'prompt', title, ...opts, resolve }))
}

export function confirmAction(
  title: string,
  message: string,
  opts: { okLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => openDialog({ kind: 'confirm', title, message, ...opts, resolve }))
}

// ---------------------------------------------------------------------------
// Editor flush hooks (registered by editors with pending saves)

const flushers = new Set<() => Promise<boolean>>()
/** An editor's flusher resolves true when nothing is left unsaved, false on a conflict or error. */
export function registerFlusher(fn: () => Promise<boolean>): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}
/** Save every open editor. Resolves false when some edit could not be saved. */
export async function flushAllEditors(): Promise<boolean> {
  const results = await Promise.all([...flushers].map((f) => f().catch(() => false)))
  return results.every(Boolean)
}

// Drafts: editor text that could not be saved yet (conflict or error) and must outlive its editor,
// e.g. when another note is selected. Kept per workspace and note until saved or discarded.
export interface Draft {
  body: string
  baseRev: number
}
const drafts = new Map<string, Draft>()
const draftKey = (workspaceId: WorkspaceId, noteId: NoteId) => `${workspaceId}\u0000${noteId}`
export function getDraft(workspaceId: WorkspaceId, noteId: NoteId): Draft | undefined {
  return drafts.get(draftKey(workspaceId, noteId))
}
export function setDraft(workspaceId: WorkspaceId, noteId: NoteId, draft: Draft): void {
  drafts.set(draftKey(workspaceId, noteId), draft)
}
export function clearDraft(workspaceId: WorkspaceId, noteId: NoteId): void {
  drafts.delete(draftKey(workspaceId, noteId))
}
export function hasDrafts(): boolean {
  return drafts.size > 0
}

export const UNSAVED_MESSAGE =
  '保存できていない変更があります。競合バナーで「最新を読み込む」か「自分の内容で上書き」を選んでください'

/** Flush before leaving the current workspace; tells the user and returns false when that failed. */
export async function ensureSaved(): Promise<boolean> {
  if (await flushAllEditors()) return true
  toast(UNSAVED_MESSAGE, 'error')
  return false
}

/** Main asks before the window closes: flush editors, and report whether anything is left unsaved. */
async function answerCloseRequest(requestId: number): Promise<void> {
  let ok = false
  try {
    ok = (await flushAllEditors()) && !hasDrafts()
  } finally {
    await window.facet.closeReady(requestId, ok)
  }
}

// ---------------------------------------------------------------------------
// Workspace lifecycle

let initStarted = false
export async function initApp(): Promise<void> {
  if (initStarted) return
  initStarted = true
  const init = await window.facet.getInitialState()
  set({
    workspaces: init.workspaces,
    leftOpen: init.panes.leftOpen,
    rightOpen: init.panes.rightOpen,
    version: init.version,
    e2e: init.e2e,
  })
  window.facet.onWorkspaceEvent(handleWorkspaceEvent)
  window.facet.onCloseRequest((id) => void answerCloseRequest(id))
  if (init.activeWorkspaceId) await switchWorkspace(init.activeWorkspaceId)
  set({ ready: true })
}

/** Returns false (and stays) when unsaved edits in the current workspace could not be saved. */
export async function switchWorkspace(id: WorkspaceId): Promise<boolean> {
  if (!(await ensureSaved())) return false
  const r = await window.facet.openWorkspace(id)
  if (!r.ok) {
    set({ activeId: id, snapshot: null, loadError: r.message })
    return true
  }
  const first = Object.values(r.snapshot.state.notes).find((n) => !n.archived)
  set({
    activeId: id,
    snapshot: r.snapshot,
    loadError: null,
    scope: 'all',
    selectedNoteId: first?.id ?? null,
    selectedGroupId: null,
    selectedNoteIds: [],
    multiSelect: false,
    manuscriptSplit: false,
    inlineNoteId: null,
    outlineCollapsed: [],
  })
  void window.facet.setActiveWorkspace(id)
  for (const issue of r.snapshot.issues.slice(0, 3)) toast(issue.message, 'info')
  return true
}

export async function refreshWorkspaces(list: WorkspaceSummary[]): Promise<void> {
  set({ workspaces: list })
  const { activeId } = get()
  const stillThere = list.find((w) => w.id === activeId)
  const target = stillThere ? activeId : (list.find((w) => w.status === 'ok')?.id ?? null)
  if (target) await switchWorkspace(target)
  else set({ activeId: null, snapshot: null })
}

function handleWorkspaceEvent(e: WorkspaceEvent): void {
  const { snapshot } = get()
  if (!snapshot || snapshot.id !== e.workspaceId) return
  if (e.type === 'external-change') {
    set({ snapshot: { ...snapshot, state: applyPatch(snapshot.state, e.patch) } })
    toast(e.message)
  } else if (e.type === 'reloaded') {
    set({ snapshot: e.snapshot })
    toast(e.message)
  } else if (e.type === 'bibliography') {
    set({ snapshot: { ...snapshot, bibliography: e.snapshot.bibliography } })
  } else toast(e.message, 'error')
}

function applyResponse(r: CommandResponse): void {
  if (!r.ok) return
  const { snapshot } = get()
  if (!snapshot) return
  set({
    snapshot: {
      ...snapshot,
      state: applyPatch(snapshot.state, r.patch),
      canUndo: r.canUndo,
      canRedo: r.canRedo,
      trash: r.trash,
    },
  })
}

/** Execute a domain command in Main. Errors are toasted unless `quiet`. */
export async function exec(
  cmd: Command,
  opts: { quiet?: boolean } = {},
): Promise<{ ok: true; info: CommandInfo } | { ok: false; code: string; message: string }> {
  const { activeId } = get()
  if (!activeId) return { ok: false, code: 'not-found', message: 'Workspaceがありません' }
  set((s) => ({ saving: s.saving + 1 }))
  try {
    const r = await window.facet.execute(activeId, cmd)
    if (get().activeId !== activeId)
      return { ok: false, code: 'stale', message: 'Workspaceが切り替わりました' }
    applyResponse(r)
    if (!r.ok) {
      if (!opts.quiet) toast(r.error.message, 'error')
      return { ok: false, code: r.error.code, message: r.error.message }
    }
    return { ok: true, info: r.info }
  } finally {
    set((s) => ({ saving: s.saving - 1 }))
  }
}

export async function undo(): Promise<void> {
  const { activeId } = get()
  if (!activeId) return
  const r = await window.facet.undo(activeId)
  applyResponse(r)
  toast(r.ok ? '元に戻しました' : r.error.message, r.ok ? 'info' : 'error')
}

export async function redo(): Promise<void> {
  const { activeId } = get()
  if (!activeId) return
  const r = await window.facet.redo(activeId)
  applyResponse(r)
  toast(r.ok ? 'やり直しました' : r.error.message, r.ok ? 'info' : 'error')
}

export async function restoreFromTrash(noteId: NoteId): Promise<void> {
  const { activeId } = get()
  if (!activeId) return
  const r = await window.facet.restoreFromTrash(activeId, noteId)
  applyResponse(r)
  if (r.ok) {
    set({ selectedNoteId: noteId })
    toast('メモを復元しました（未配置）')
  } else toast(r.error.message, 'error')
}

export async function reloadSnapshot(snap: WorkspaceSnapshot | null): Promise<void> {
  if (snap && get().activeId === snap.id) set({ snapshot: snap })
}

// ---------------------------------------------------------------------------
// UI helpers

export function selectNote(id: NoteId | null, groupId: GroupId | null = null): void {
  const s = get()
  if (s.multiSelect && id) {
    const has = s.selectedNoteIds.includes(id)
    set({
      selectedNoteIds: has ? s.selectedNoteIds.filter((x) => x !== id) : [...s.selectedNoteIds, id],
      selectedNoteId: id,
    })
    return
  }
  set({ selectedNoteId: id, selectedGroupId: groupId ?? s.selectedGroupId })
}

/** Notes targeted by Canvas Tools: multi-selection when active, otherwise the selected note. */
export function targetNoteIds(): NoteId[] {
  const s = get()
  if (s.multiSelect && s.selectedNoteIds.length) return s.selectedNoteIds
  return s.selectedNoteId ? [s.selectedNoteId] : []
}

export function setPanes(leftOpen: boolean, rightOpen: boolean): void {
  set({ leftOpen, rightOpen })
  void window.facet.setPanes({ leftOpen, rightOpen })
}

export function setTab(tab: Tab): void {
  set({ tab, globalSearch: false })
}
