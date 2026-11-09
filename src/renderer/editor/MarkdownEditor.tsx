// CodeMirror 6 Markdown editor bound to one note: autosave, [[ completion, link navigation, conflicts.
import { useEffect, useRef, useState } from 'react'
import { Annotation, EditorState, StateEffect, StateField } from '@codemirror/state'
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
/**
 * Hand-over between editors of one note (ADR-035). Typing done while another editor still has
 * unsaved text is held in a segment and replayed once that text is saved and shown here. Each focus
 * starts a new segment with a higher sequence number; a segment only ever waits for lower numbers
 * (its predecessor here, and earlier segments of the other editors), so waits can never cycle.
 */
let holdSeq = 0
interface Segment {
  seq: number
  texts: string[]
  /** Settles once the segment's text is replayed. */
  done: Promise<void> | null
}

/** Where each segment's typing started, mapped through every later change (so other editors' text
 *  arriving at that spot goes before it). */
const anchorEffect = StateEffect.define<{ seq: number; pos: number | null }>()
const heldAnchors = StateField.define<ReadonlyMap<number, number>>({
  create: () => new Map(),
  update(value, tr) {
    let next = value
    if (tr.docChanged && value.size)
      next = new Map([...value].map(([seq, pos]) => [seq, tr.changes.mapPos(pos, 1)]))
    for (const e of tr.effects) {
      if (!e.is(anchorEffect)) continue
      const m = new Map(next)
      if (e.value.pos === null) m.delete(e.value.seq)
      else m.set(e.value.seq, e.value.pos)
      next = m
    }
    return next
  },
})
/** Marks the replay of held text, which must pass the hold filter. */
const replayAnnotation = Annotation.define<boolean>()
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
  const held = useRef<Segment[]>([])
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
  /**
   * Save until nothing is pending (typing can continue while a save is in flight). Text held back by
   * an earlier hand-over is replayed first, so it is saved here, in order (`after`: the sequence of
   * the hand-over asking; without it, every hold is waited for).
   */
  const flush = async ({ after }: { after?: number } = {}): Promise<boolean> => {
    await Promise.all(held.current.filter((h) => after === undefined || h.seq < after).map((h) => h.done))
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
  const takeOver = async (view: EditorView, seg: Segment, previous: Promise<void> | null) => {
    try {
      await previous
      await flushSiblings(noteId, view, seg.seq)
      const latest = useApp.getState().snapshot?.state.notes[noteId]
      if (viewRef.current === view && latest && !sync.current.dirty) {
        if (view.state.doc.toString() !== latest.body) replaceDoc(view, latest.body)
        sync.current.baseRev = latest.rev
      }
    } finally {
      if (viewRef.current === view) replay(view, seg)
    }
  }
  /** Type a segment's held text where it was typed (it becomes ordinary unsaved text, autosaved). */
  const replay = (view: EditorView, seg: Segment) => {
    held.current = held.current.filter((h) => h !== seg)
    const text = seg.texts.join('')
    const sel = view.state.selection.main
    const at = view.state.field(heldAnchors).get(seg.seq) ?? sel.head
    view.dispatch({
      ...(text ? { changes: { from: at, insert: text } } : {}),
      // The cursor follows the text if it is still where the typing started.
      ...(text && sel.empty && sel.head === at ? { selection: { anchor: at + text.length } } : {}),
      effects: anchorEffect.of({ seq: seg.seq, pos: null }),
      annotations: replayAnnotation.of(true),
      userEvent: 'input.type',
      scrollIntoView: !!text,
    })
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
          heldAnchors,
          EditorState.transactionFilter.of((tr) => {
            const segs = held.current
            if (!segs.length || !tr.docChanged) return tr
            if (tr.annotation(remoteAnnotation) || tr.annotation(replayAnnotation)) return tr
            // While held: typed text is kept for the replay (deletions are dropped).
            if (!tr.isUserEvent('input')) return []
            const seg = segs[segs.length - 1]
            tr.changes.iterChanges((_a, _b, _c, _d, inserted) => seg.texts.push(inserted.toString()))
            if (tr.startState.field(heldAnchors).has(seg.seq)) return []
            return { effects: anchorEffect.of({ seq: seg.seq, pos: tr.startState.selection.main.from }) }
          }),
          linkClick(noteId),
          EditorView.contentAttributes.of({
            'aria-label': 'Note body',
            'data-testid': testId ?? 'note-body',
          }),
          EditorView.updateListener.of((u) => {
            if (u.focusChanged && u.view.hasFocus) {
              noteFocused(noteId, u.view)
              if (held.current.length || siblingsBusy(noteId, u.view)) {
                // Hold from the next keystroke on, before any await.
                const previous = held.current.at(-1)?.done ?? null
                const seg: Segment = { seq: ++holdSeq, texts: [], done: null }
                held.current = [...held.current, seg]
                seg.done = takeOverRef.current(u.view, seg, previous)
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
      busy: () => sync.current.dirty || !!sync.current.inflight || held.current.length > 0,
      loadLatest: () => loadLatestRef.current(false),
    })
    const unflush = registerFlusher(flush)
    if (autoFocus) view.focus()
    return () => {
      // Text still held back goes in now, so closing the editor never drops it.
      for (const seg of [...held.current]) replay(view, seg)
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
