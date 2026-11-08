// Tracks open CodeMirror views so citations can be inserted at the cursor of the selected note.
import type { EditorView } from '@codemirror/view'
import type { NoteId } from '../../shared/domain/types'

const views = new Map<NoteId, Set<EditorView>>()
const lastCursor = new Map<NoteId, number>()
let lastFocused: { noteId: NoteId; view: EditorView } | null = null

export function registerView(noteId: NoteId, view: EditorView): () => void {
  if (!views.has(noteId)) views.set(noteId, new Set())
  views.get(noteId)!.add(view)
  return () => {
    views.get(noteId)?.delete(view)
    lastCursor.set(noteId, view.state.selection.main.head)
    if (lastFocused?.view === view) lastFocused = null
  }
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
