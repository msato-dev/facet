// State diffs used for persistence, IPC patches and the app-level undo stack.
import type { CanvasState, DomainState, Note, NoteId, Structure } from './types'

export interface StatePatch {
  /** Changed or added notes; null means removed. */
  notes: Record<NoteId, Note | null>
  structure?: Structure
  canvas?: CanvasState
}

export function diffState(prev: DomainState, next: DomainState): StatePatch {
  const notes: Record<NoteId, Note | null> = {}
  if (prev.notes !== next.notes) {
    for (const [id, n] of Object.entries(next.notes)) if (prev.notes[id] !== n) notes[id] = n
    for (const id of Object.keys(prev.notes)) if (!(id in next.notes)) notes[id] = null
  }
  const patch: StatePatch = { notes }
  if (prev.structure !== next.structure) patch.structure = next.structure
  if (prev.canvas !== next.canvas) patch.canvas = next.canvas
  return patch
}

export function isEmptyPatch(p: StatePatch): boolean {
  return !p.structure && !p.canvas && Object.keys(p.notes).length === 0
}

export function applyPatch(state: DomainState, patch: StatePatch): DomainState {
  let notes = state.notes
  const entries = Object.entries(patch.notes)
  if (entries.length) {
    notes = { ...notes }
    for (const [id, n] of entries) {
      if (n) notes[id] = n
      else delete notes[id]
    }
  }
  return {
    notes,
    structure: patch.structure ?? state.structure,
    canvas: patch.canvas ?? state.canvas,
  }
}

/** The values a patch overwrote, taken from the previous state (the inverse patch). */
export function inversePatch(prev: DomainState, patch: StatePatch): StatePatch {
  const notes: Record<NoteId, Note | null> = {}
  for (const id of Object.keys(patch.notes)) notes[id] = prev.notes[id] ?? null
  const inv: StatePatch = { notes }
  if (patch.structure) inv.structure = prev.structure
  if (patch.canvas) inv.canvas = prev.canvas
  return inv
}

/** True when every value covered by `expected` is still identical (by reference) in `state`. */
export function matchesPatch(state: DomainState, expected: StatePatch): boolean {
  for (const [id, n] of Object.entries(expected.notes)) if ((state.notes[id] ?? null) !== n) return false
  if (expected.structure && state.structure !== expected.structure) return false
  if (expected.canvas && state.canvas !== expected.canvas) return false
  return true
}

/**
 * Apply `target` (values to restore), bumping note revisions so editors holding an older
 * revision can never silently overwrite restored content. Returns the patch actually applied.
 */
export function restorePatch(state: DomainState, target: StatePatch): { state: DomainState; applied: StatePatch } {
  const notes: Record<NoteId, Note | null> = {}
  for (const [id, n] of Object.entries(target.notes)) {
    const current = state.notes[id]
    notes[id] = n ? { ...n, rev: Math.max(n.rev, current?.rev ?? 0) + 1 } : null
  }
  const applied: StatePatch = { notes }
  if (target.structure) applied.structure = target.structure
  if (target.canvas) applied.canvas = target.canvas
  return { state: applyPatch(state, applied), applied }
}

export interface UndoEntry {
  label: string
  /** Values to restore on undo. */
  before: StatePatch
  /** Values that must still be present for the undo to be safe. */
  after: StatePatch
}

export class UndoStack {
  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []
  constructor(private limit = 200) {}

  record(prev: DomainState, next: DomainState, label: string): void {
    const after = diffState(prev, next)
    if (isEmptyPatch(after)) return
    this.undoStack.push({ label, before: inversePatch(prev, after), after })
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  undo(state: DomainState): { ok: true; state: DomainState; label: string } | { ok: false; message: string } {
    const e = this.undoStack.at(-1)
    if (!e) return { ok: false, message: '取り消せる操作がありません' }
    if (!matchesPatch(state, e.after)) {
      this.undoStack = []
      return { ok: false, message: 'その後に内容が変更されたため、取り消せません' }
    }
    this.undoStack.pop()
    const r = restorePatch(state, e.before)
    this.redoStack.push({ label: e.label, before: r.applied, after: e.after })
    return { ok: true, state: r.state, label: e.label }
  }

  redo(state: DomainState): { ok: true; state: DomainState; label: string } | { ok: false; message: string } {
    const e = this.redoStack.at(-1)
    if (!e) return { ok: false, message: 'やり直せる操作がありません' }
    if (!matchesPatch(state, e.before)) {
      this.redoStack = []
      return { ok: false, message: 'その後に内容が変更されたため、やり直せません' }
    }
    this.redoStack.pop()
    const r = restorePatch(state, e.after)
    this.undoStack.push({ label: e.label, before: e.before, after: r.applied })
    return { ok: true, state: r.state, label: e.label }
  }

  /** Drop history (e.g. after an external reload). */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
