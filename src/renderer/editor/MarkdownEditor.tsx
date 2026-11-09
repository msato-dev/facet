// CodeMirror 6 Markdown editor bound to one note: autosave, [[ completion, link navigation, conflicts.
import { useEffect, useRef, useState } from 'react'
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { autocompletion } from '@codemirror/autocomplete'
import { titleKey } from '../../shared/domain/titles'
import {
  clearDraft,
  exec,
  getDraft,
  registerFlusher,
  selectNote,
  setDraft,
  toast,
  useApp,
} from '../store/store'
import { markdownBase, wikiCompletion } from './markdownExtensions'
import {
  flushSiblings,
  loadLatestInSiblings,
  noteFocused,
  registerView,
  rememberCursor,
  siblingsBusy,
} from './registry'

const SAVE_DELAY = 500
const remoteAnnotation = Annotation.define<boolean>()

/** Follow a WikiLink with Ctrl/Cmd+click. */
function linkClick(selfId: string) {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!(e.ctrlKey || e.metaKey)) return false
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
      if (pos == null) return false
      const line = view.state.doc.lineAt(pos)
      for (const m of line.text.matchAll(/\[\[([^[\]\n|]+?)(?:\|[^[\]\n]+?)?\]\]/g)) {
        const start = line.from + m.index
        if (pos >= start && pos <= start + m[0].length) {
          const snap = useApp.getState().snapshot
          const target =
            snap && Object.values(snap.state.notes).find((n) => titleKey(n.title) === titleKey(m[1]))
          if (target && target.id !== selfId) selectNote(target.id)
          else if (!target) toast(`リンク先「${m[1]}」が見つかりません`, 'error')
          e.preventDefault()
          return true
        }
      }
      return false
    },
  })
}

interface Props {
  noteId: string
  autoFocus?: boolean
  minHeight?: number
  testId?: string
}

export function MarkdownEditor({ noteId, autoFocus, minHeight = 200, testId }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const note = useApp((s) => s.snapshot?.state.notes[noteId])
  // The workspace this editor belongs to (drafts are kept per workspace and note).
  const workspaceId = useRef(useApp.getState().activeId)
  const sync = useRef({
    baseRev: note?.rev ?? 0,
    dirty: false,
    lastSent: null as string | null,
    timer: 0 as unknown as ReturnType<typeof setTimeout>,
    inflight: null as Promise<boolean> | null,
  })
  // Typing held back while another editor of this note finishes saving (see takeOver).
  const held = useRef({ active: false, texts: [] as string[] })
  const [conflict, setConflict] = useState(false)
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving'>('saved')

  const keepDraft = (body: string) => {
    if (workspaceId.current) setDraft(workspaceId.current, noteId, { body, baseRev: sync.current.baseRev })
  }
  const dropDraft = () => {
    if (workspaceId.current) clearDraft(workspaceId.current, noteId)
  }

  /** Resolves true when this editor has nothing left unsaved, false on a conflict or error. */
  const save = async (force = false): Promise<boolean> => {
    const s = sync.current
    clearTimeout(s.timer)
    // Capture the view now: this also runs from the unmount cleanup, after which the ref is cleared.
    const view = viewRef.current
    while (s.inflight) await s.inflight // never race two saves with the same baseRev
    if (!s.dirty) return true
    if (!view) return false
    const body = view.state.doc.toString()
    const current = useApp.getState().snapshot?.state.notes[noteId]
    if (!current) {
      keepDraft(body)
      return false
    }
    s.lastSent = body
    setStatus('saving')
    const run = (async () => {
      const r = await exec(
        { type: 'note.updateBody', id: noteId, body, baseRev: force ? current.rev : s.baseRev },
        { quiet: true },
      )
      if (!r.ok) {
        setStatus('pending')
        if (r.code === 'conflict') setConflict(true)
        else toast(r.message, 'error')
        keepDraft(view.state.doc.toString())
        return false
      }
      if (view.state.doc.toString() === body) {
        s.dirty = false
        setStatus('saved')
        dropDraft()
      }
      setConflict(false)
      return true
    })()
    s.inflight = run
    try {
      return await run
    } finally {
      s.inflight = null
    }
  }
  /** Save until nothing is pending (typing can continue while a save is in flight). */
  const flush = async (): Promise<boolean> => {
    for (let i = 0; i < 5; i++) {
      if (!(await saveRef.current())) return false
      if (!sync.current.dirty) return true
    }
    return !sync.current.dirty
  }
  const saveRef = useRef(save)
  saveRef.current = save

  /**
   * Another editor of this note may still hold unsaved text (typed there just before focus moved here).
   * Until it is saved and this editor shows the result, typing here is held back and replayed on top,
   * so this editor never edits an older revision and conflicts with ourselves (ADR-035).
   */
  const takeOver = async (view: EditorView) => {
    try {
      await flushSiblings(noteId, view)
      const latest = useApp.getState().snapshot?.state.notes[noteId]
      if (viewRef.current === view && latest && !sync.current.dirty) {
        if (view.state.doc.toString() !== latest.body) replaceDoc(view, latest.body)
        sync.current.baseRev = latest.rev
      }
    } finally {
      const texts = held.current.texts
      held.current = { active: false, texts: [] }
      if (viewRef.current === view && texts.length)
        view.dispatch(view.state.replaceSelection(texts.join('')), {
          userEvent: 'input.type',
          scrollIntoView: true,
        })
    }
  }
  const takeOverRef = useRef(takeOver)
  takeOverRef.current = takeOver

  useEffect(() => {
    if (!host.current) return
    const initial = useApp.getState().snapshot?.state.notes[noteId]
    workspaceId.current = useApp.getState().activeId
    // Text that could not be saved earlier comes back instead of the stored body.
    const draft = workspaceId.current ? getDraft(workspaceId.current, noteId) : undefined
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: draft?.body ?? initial?.body ?? '',
        extensions: [
          // Completion first so its Enter/arrow bindings take precedence over the default keymap.
          autocompletion({ override: [wikiCompletion(noteId)], icons: false }),
          history(),
          keymap.of([
            { key: 'Mod-s', run: () => (void saveRef.current(), true) },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          ...markdownBase(),
          EditorState.transactionFilter.of((tr) => {
            if (!held.current.active || !tr.docChanged || tr.annotation(remoteAnnotation)) return tr
            if (tr.isUserEvent('input'))
              tr.changes.iterChanges((_a, _b, _c, _d, inserted) =>
                held.current.texts.push(inserted.toString()),
              )
            return []
          }),
          linkClick(noteId),
          EditorView.contentAttributes.of({
            'aria-label': 'Note body',
            'data-testid': testId ?? 'note-body',
          }),
          EditorView.updateListener.of((u) => {
            if (u.focusChanged && u.view.hasFocus) {
              noteFocused(noteId, u.view)
              if (siblingsBusy(noteId, u.view)) {
                held.current.active = true // from this keystroke on, before any await
                void takeOverRef.current(u.view)
              }
            }
            if (u.selectionSet) rememberCursor(noteId, u.state.selection.main.head)
            if (u.focusChanged && !u.view.hasFocus) void saveRef.current()
            if (!u.docChanged) return
            const isRemote = u.transactions.some((t) => t.annotation(remoteAnnotation))
            if (isRemote) return
            sync.current.dirty = true
            setStatus('pending')
            clearTimeout(sync.current.timer)
            sync.current.timer = setTimeout(() => void saveRef.current(), SAVE_DELAY)
          }),
        ],
      }),
    })
    viewRef.current = view
    sync.current = {
      baseRev: draft?.baseRev ?? initial?.rev ?? 0,
      dirty: !!draft,
      lastSent: null,
      timer: sync.current.timer,
      inflight: null,
    }
    if (draft) {
      setStatus('pending')
      if (initial && initial.rev !== draft.baseRev) setConflict(true)
      else sync.current.timer = setTimeout(() => void saveRef.current(), SAVE_DELAY)
    }
    const unregister = registerView(noteId, view, {
      flush,
      busy: () => sync.current.dirty || !!sync.current.inflight,
      loadLatest: () => loadLatestRef.current(false),
    })
    const unflush = registerFlusher(flush)
    if (autoFocus) view.focus()
    return () => {
      // Keep unsaved text until the save below succeeds (it clears the draft) or fails.
      if (sync.current.dirty) keepDraft(view.state.doc.toString())
      void saveRef.current()
      unflush()
      unregister()
      view.destroy()
      viewRef.current = null
    }
  }, [noteId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reconcile with the store when the note changes elsewhere (other editor, rename cascade, external edit).
  useEffect(() => {
    const view = viewRef.current
    if (!view || !note) return
    const s = sync.current
    const doc = view.state.doc.toString()
    if (note.body === doc) {
      s.baseRev = note.rev
      if (s.dirty) {
        s.dirty = false
        setStatus('saved')
        dropDraft()
      }
      setConflict(false)
      return
    }
    if (s.lastSent !== null && note.body === s.lastSent) {
      s.baseRev = note.rev // ack of our own save; newer local typing is still pending
      return
    }
    if (!s.dirty) {
      replaceDoc(view, note.body)
      s.baseRev = note.rev
      return
    }
    if (note.rev !== s.baseRev) setConflict(true)
  }, [note?.rev, note?.body]) // eslint-disable-line react-hooks/exhaustive-deps

  /** `all`: the user chose it here, so the other editors of this note (which may hold the same
   *  unsaved draft) drop their text as well, instead of keeping the conflict alive. */
  const loadLatest = (all = true) => {
    const view = viewRef.current
    const latest = useApp.getState().snapshot?.state.notes[noteId]
    if (!view || !latest) return
    if (all) loadLatestInSiblings(noteId, view)
    replaceDoc(view, latest.body)
    sync.current.dirty = false
    sync.current.baseRev = latest.rev
    dropDraft()
    setConflict(false)
    setStatus('saved')
  }

  const loadLatestRef = useRef(loadLatest)
  loadLatestRef.current = loadLatest

  return (
    <div className="md-editor" data-status={status}>
      {conflict && (
        <div className="conflict-banner" role="alert">
          <span>このメモは別の場所（外部エディター等）で変更されました。</span>
          <button className="btn small" onClick={() => loadLatest()}>
            最新を読み込む
          </button>
          <button className="btn small" onClick={() => void save(true)}>
            自分の内容で上書き
          </button>
        </div>
      )}
      <div ref={host} className="md-editor-host" style={{ minHeight }} />
      <div className="md-editor-status helper" aria-live="polite">
        {status === 'saved' ? '保存済み' : status === 'saving' ? '保存中…' : '未保存の変更'}
      </div>
    </div>
  )
}

/**
 * Show text that changed elsewhere. Only the differing middle is replaced, so the cursor keeps its
 * place; a cursor at the very end stays at the end (text appended elsewhere goes before it).
 */
function replaceDoc(view: EditorView, text: string) {
  const old = view.state.doc.toString()
  let from = 0
  while (from < old.length && from < text.length && old[from] === text[from]) from++
  let end = 0
  while (end < old.length - from && end < text.length - from && old.at(-1 - end) === text.at(-1 - end)) end++
  const atEnd = view.state.selection.main.empty && view.state.selection.main.head === old.length
  view.dispatch({
    changes: { from, to: old.length - end, insert: text.slice(from, text.length - end) },
    ...(atEnd ? { selection: { anchor: text.length } } : {}),
    annotations: remoteAnnotation.of(true),
  })
}
