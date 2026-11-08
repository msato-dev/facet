// CodeMirror 6 Markdown editor bound to one note: autosave, [[ completion, link navigation, conflicts.
import { useEffect, useRef, useState } from 'react'
import { Annotation, EditorState } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  keymap,
  placeholder,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { titleKey } from '../../shared/domain/titles'
import { exec, registerFlusher, selectNote, toast, useApp } from '../store/store'
import { noteFocused, registerView, rememberCursor } from './registry'

const SAVE_DELAY = 500
const remoteAnnotation = Annotation.define<boolean>()

const wikiDecorator = new MatchDecorator({
  regexp: /\[\[[^[\]\n]+?\]\]/g,
  decoration: () => Decoration.mark({ class: 'cm-wikilink' }),
})
const wikiHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = wikiDecorator.createDeco(view)
    }
    update(u: ViewUpdate) {
      this.decorations = wikiDecorator.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations },
)

const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--input-bg)',
      color: 'var(--ink)',
      fontSize: '12.5px',
      border: '1px solid var(--line-strong)',
      borderRadius: '5px',
    },
    '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
    '.cm-content': {
      fontFamily: 'var(--font)',
      lineHeight: '1.6',
      padding: '8px 2px',
      caretColor: 'var(--accent)',
    },
    '.cm-scroller': { fontFamily: 'var(--font)' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: '#4a3b66 !important',
    },
    '.cm-wikilink': {
      color: 'var(--link)',
      textDecoration: 'underline',
      textDecorationColor: '#6b5a8c',
      cursor: 'pointer',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--panel-hi)',
      border: '1px solid var(--line-strong)',
      color: 'var(--ink)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--accent-bg)',
      color: 'var(--ink)',
    },
    '.cm-placeholder': { color: 'var(--muted)' },
  },
  { dark: true },
)

function wikiCompletion(selfId: string) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^[\]\n|]*/)
    if (!m) return null
    const snap = useApp.getState().snapshot
    if (!snap) return null
    const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2)
    return {
      from: m.from + 2,
      options: Object.values(snap.state.notes)
        .filter((n) => n.id !== selfId && !n.archived)
        .map((n) => ({ label: n.title, type: 'text', apply: after === ']]' ? n.title : `${n.title}]]` })),
      validFor: /^[^[\]\n|]*$/,
    }
  }
}

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
  const sync = useRef({
    baseRev: note?.rev ?? 0,
    dirty: false,
    lastSent: null as string | null,
    timer: 0 as unknown as ReturnType<typeof setTimeout>,
  })
  const [conflict, setConflict] = useState(false)
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving'>('saved')

  const save = async (force = false) => {
    const view = viewRef.current
    const s = sync.current
    clearTimeout(s.timer)
    if (!view || !s.dirty) return
    const body = view.state.doc.toString()
    const current = useApp.getState().snapshot?.state.notes[noteId]
    if (!current) return
    s.lastSent = body
    setStatus('saving')
    const r = await exec(
      { type: 'note.updateBody', id: noteId, body, baseRev: force ? current.rev : s.baseRev },
      { quiet: true },
    )
    if (!r.ok) {
      setStatus('pending')
      if (r.code === 'conflict') setConflict(true)
      else toast(r.message, 'error')
      return
    }
    if (view.state.doc.toString() === body) {
      s.dirty = false
      setStatus('saved')
    }
    setConflict(false)
  }
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    if (!host.current) return
    const initial = useApp.getState().snapshot?.state.notes[noteId]
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial?.body ?? '',
        extensions: [
          // Completion first so its Enter/arrow bindings take precedence over the default keymap.
          autocompletion({ override: [wikiCompletion(noteId)], icons: false }),
          history(),
          keymap.of([
            { key: 'Mod-s', run: () => (void saveRef.current(), true) },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown(),
          EditorView.lineWrapping,
          placeholder('Markdown本文… [[ でWikiLink、引用は [@Key]'),
          wikiHighlight,
          linkClick(noteId),
          editorTheme,
          EditorView.contentAttributes.of({
            'aria-label': 'Note body',
            'data-testid': testId ?? 'note-body',
          }),
          EditorView.updateListener.of((u) => {
            if (u.focusChanged && u.view.hasFocus) noteFocused(noteId, u.view)
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
    sync.current = { baseRev: initial?.rev ?? 0, dirty: false, lastSent: null, timer: sync.current.timer }
    const unregister = registerView(noteId, view)
    const unflush = registerFlusher(() => saveRef.current())
    if (autoFocus) view.focus()
    return () => {
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

  const loadLatest = () => {
    const view = viewRef.current
    const latest = useApp.getState().snapshot?.state.notes[noteId]
    if (!view || !latest) return
    replaceDoc(view, latest.body)
    sync.current.dirty = false
    sync.current.baseRev = latest.rev
    setConflict(false)
    setStatus('saved')
  }

  return (
    <div className="md-editor" data-status={status}>
      {conflict && (
        <div className="conflict-banner" role="alert">
          <span>このメモは別の場所（外部エディター等）で変更されました。</span>
          <button className="btn small" onClick={loadLatest}>
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

function replaceDoc(view: EditorView, text: string) {
  const head = Math.min(view.state.selection.main.head, text.length)
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: head },
    annotations: remoteAnnotation.of(true),
  })
}
