// Tracks open CodeMirror views: citations go to the cursor of the selected note, and editors of the
// same note hand over to each other (ADR-035).
import type { EditorView } from '@codemirror/view'
import type { NoteId } from '../../shared/domain/types'

/** What an editor exposes to the other editors of the same note. */
export interface ViewHandle {
  /** Saves pending text; resolves false on a conflict or error. */
  flush: () => Promise<boolean>
  /** True while the editor has unsaved text or a save in flight. */
  busy: () => boolean
  /** Drop local text and show the stored body (the conflict banner's "load latest"). */
  loadLatest: () => void
}

const views = new Map<NoteId, Set<EditorView>>()
const handles = new Map<EditorView, ViewHandle>()
const lastCursor = new Map<NoteId, number>()
let lastFocused: { noteId: NoteId; view: EditorView } | null = null

export function registerView(noteId: NoteId, view: EditorView, handle?: ViewHandle): () => void {
  if (!views.has(noteId)) views.set(noteId, new Set())
  views.get(noteId)!.add(view)
  if (handle) handles.set(view, handle)
  return () => {
    views.get(noteId)?.delete(view)
    handles.delete(view)
    lastCursor.set(noteId, view.state.selection.main.head)
    if (lastFocused?.view === view) lastFocused = null
  }
}

function siblings(noteId: NoteId, view: EditorView): ViewHandle[] {
  return [...(views.get(noteId) ?? [])].filter((v) => v !== view).flatMap((v) => handles.get(v) ?? [])
}

/** True when another editor of the same note has unsaved text or a save in flight. */
export function siblingsBusy(noteId: NoteId, view: EditorView): boolean {
  return siblings(noteId, view).some((h) => h.busy())
}

/** Save the other editors of the same note. Resolves false when one of them could not save. */
export async function flushSiblings(noteId: NoteId, view: EditorView): Promise<boolean> {
  const results = await Promise.all(siblings(noteId, view).map((h) => h.flush().catch(() => false)))
  return results.every(Boolean)
}

/** "Load latest" applies to the note: every other open editor of it drops its local text too. */
export function loadLatestInSiblings(noteId: NoteId, view: EditorView): void {
  for (const h of siblings(noteId, view)) h.loadLatest()
}

export function noteFocused(noteId: NoteId, view: EditorView): void {
  lastFocused = { noteId, view }
}

export function rememberCursor(noteId: NoteId, pos: number): void {
  lastCursor.set(noteId, pos)
}

/** Insert text at the cursor of the most relevant open editor. Returns false if none is open. */
export function insertAtCursor(noteId: NoteId, text: string): boolean {
  let view: EditorView | undefined
  if (lastFocused?.noteId === noteId && views.get(noteId)?.has(lastFocused.view)) view = lastFocused.view
  else view = [...(views.get(noteId) ?? [])][0]
  if (!view) return false
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  })
  view.focus()
  return true
}

/** Insert into raw text at the last known cursor (editor closed). */
export function insertIntoText(noteId: NoteId, body: string, text: string): string {
  const pos = Math.min(lastCursor.get(noteId) ?? body.length, body.length)
  return body.slice(0, pos) + text + body.slice(pos)
}
