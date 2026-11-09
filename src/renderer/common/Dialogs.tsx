// Modal host: prompt / confirm / citation / settings / trash / manuscript fullscreen, plus toasts.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  closeDialog,
  confirmAction,
  dismissToast,
  exec,
  restoreFromTrash,
  toast,
  useApp,
  type DialogRequest,
} from '../store/store'
import { insertAtCursor, insertIntoText } from '../editor/registry'
import { MarkdownInput } from '../editor/MarkdownInput'
import { TITLE_ERROR_MESSAGES, normalizeTitle, validateTitle } from '../../shared/domain/titles'
import { SettingsDialog } from '../settings/SettingsDialog'
import { ManuscriptDocument } from '../outline/ManuscriptPane'
import { matchesQuery } from '../../shared/search/tokenizer'

export function Modal({
  title,
  onClose,
  children,
  wide,
  testId,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  testId?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first =
      ref.current?.querySelector<HTMLElement>(
        '[autofocus], input, textarea, select, button:not(.modal-close)',
      ) ?? ref.current?.querySelector<HTMLElement>('.modal-close')
    first?.focus()
    // Escape closes only the top-most dialog, wherever focus is.
    const onKey = (e: KeyboardEvent) => {
      // Escape already handled inside (e.g. closing a completion list) does not close the dialog.
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const all = document.querySelectorAll('.modal')
      if (all[all.length - 1] !== ref.current) return
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [])
  return (
    <div
      className="modal-back"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Tab' && ref.current) {
          const els = [
            ...ref.current.querySelectorAll<HTMLElement>(
              'button, input, select, textarea, [tabindex="0"], [contenteditable="true"]',
            ),
          ].filter((x) => !x.hasAttribute('disabled'))
          if (!els.length) return
          const i = els.indexOf(document.activeElement as HTMLElement)
          if (e.shiftKey && i <= 0) {
            e.preventDefault()
            els.at(-1)!.focus()
          } else if (!e.shiftKey && i === els.length - 1) {
            e.preventDefault()
            els[0].focus()
          }
        }
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        data-testid={testId}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <button className="btn icon modal-close" aria-label="閉じる" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function PromptDialog({ d }: { d: Extract<DialogRequest, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(d.initial ?? '')
  const done = (v: string | null) => {
    closeDialog(d)
    d.resolve(v)
  }
  return (
    <Modal title={d.title} onClose={() => done(null)} testId="prompt-dialog">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) done(value.trim())
        }}
      >
        {d.label && <label className="field-label">{d.label}</label>}
        <input
          className="input full"
          autoFocus
          data-testid="prompt-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => done(null)}>
            Cancel
          </button>
          <button type="submit" className="btn primary" data-testid="prompt-ok" disabled={!value.trim()}>
            {d.okLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Body text as stored: no leading blank lines (the file format puts one after the H1), no trailing space. */
function normalizeNewBody(body: string): string {
  return body.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')
}

function NewNoteDialog({ d }: { d: Extract<DialogRequest, { kind: 'note-create' }> }) {
  const notes = useApp((s) => s.snapshot?.state.notes)
  const [title, setTitle] = useState('')
  const body = useRef('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const closing = useRef(false)
  const titleError = useMemo(() => {
    if (!title.trim() || !notes) return null
    const e = validateTitle(notes, normalizeTitle(title))
    return e ? TITLE_ERROR_MESSAGES[e] : null
  }, [title, notes])
  const error = titleError ?? serverError
  const done = (id: string | null) => {
    closeDialog(d)
    d.resolve(id)
  }
  // Closing with something typed asks first, so a stray Escape or click does not lose the body.
  const requestClose = async () => {
    if (closing.current || busy) return
    if (title.trim() || body.current.trim()) {
      closing.current = true
      const ok = await confirmAction('新規メモを破棄', '入力したタイトルと本文を破棄します。', {
        okLabel: '破棄',
        danger: true,
      })
      closing.current = false
      if (!ok) return
    }
    done(null)
  }
  const submit = async () => {
    if (busy || !title.trim() || titleError) return
    setBusy(true)
    const r = await exec(
      {
        type: 'note.create',
        title: title.trim(),
        body: normalizeNewBody(body.current),
        groupId: d.groupId,
        canvasPos: d.canvasPos,
      },
      { quiet: true },
    )
    setBusy(false)
    if (!r.ok || !r.info.createdId) {
      setServerError(r.ok ? 'メモを作成できませんでした' : r.message)
      return
    }
    done(r.info.createdId)
  }
  return (
    <Modal title="新規メモ" onClose={() => void requestClose()} testId="new-note-dialog">
      <form
        className="new-note-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="field-label" htmlFor="new-note-title">
          タイトル（保存時に先頭の H1 になります）
        </label>
        <input
          id="new-note-title"
          className="input full title-input"
          autoFocus
          data-testid="new-note-title"
          aria-invalid={!!error}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setServerError(null)
          }}
        />
        {error && (
          <div className="field-error" role="alert" data-testid="new-note-error">
            {error}
          </div>
        )}
        <label className="field-label">本文 · Markdown</label>
        <MarkdownInput
          ariaLabel="New note body"
          testId="new-note-body"
          onChange={(v) => (body.current = v)}
          onSubmit={() => void submit()}
        />
        <div className="helper">[[ でWikiLink、Ctrl+Enter で作成</div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            data-testid="new-note-cancel"
            onClick={() => void requestClose()}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn primary"
            data-testid="new-note-ok"
            disabled={busy || !title.trim() || !!titleError}
          >
            作成
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ConfirmDialog({ d }: { d: Extract<DialogRequest, { kind: 'confirm' }> }) {
  const done = (v: boolean) => {
    closeDialog(d)
    d.resolve(v)
  }
  return (
    <Modal title={d.title} onClose={() => done(false)} testId="confirm-dialog">
      <p className="dialog-message">{d.message}</p>
      <div className="modal-actions">
        <button className="btn" onClick={() => done(false)}>
          Cancel
        </button>
        <button
          className={`btn ${d.danger ? 'danger' : 'primary'}`}
          data-testid="confirm-ok"
          autoFocus
          onClick={() => done(true)}
        >
          {d.okLabel ?? 'OK'}
        </button>
      </div>
    </Modal>
  )
}

export async function insertCitation(noteId: string, key: string): Promise<void> {
  const text = `[@${key}]`
  if (insertAtCursor(noteId, text)) {
    toast(`引用 ${text} を挿入しました`)
    return
  }
  const note = useApp.getState().snapshot?.state.notes[noteId]
  if (!note) return
  const r = await exec({
    type: 'note.updateBody',
    id: noteId,
    body: insertIntoText(noteId, note.body, text),
    baseRev: note.rev,
  })
  if (r.ok) toast(`引用 ${text} を挿入しました`)
}

function CitationDialog({ d }: { d: Extract<DialogRequest, { kind: 'citation' }> }) {
  const refs = useApp((s) => s.snapshot?.bibliography.entries ?? [])
  const note = useApp((s) => (d.noteId ? s.snapshot?.state.notes[d.noteId] : undefined))
  const [q, setQ] = useState('')
  const list = useMemo(
    () =>
      refs.filter((r) =>
        matchesQuery(`${r.key} ${r.author} ${r.year} ${r.title} ${r.container} ${r.doi}`, q),
      ),
    [refs, q],
  )
  const choose = (key: string) => {
    closeDialog(d)
    if (d.noteId) void insertCitation(d.noteId, key)
  }
  return (
    <Modal title="Insert Citation" onClose={() => closeDialog(d)} testId="citation-dialog">
      <div className="helper">挿入先: {note ? `「${note.title}」のカーソル位置` : '—'}</div>
      <input
        className="input full"
        autoFocus
        data-testid="citation-search"
        placeholder="著者 / 年 / タイトル / Citation key / DOI"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && list[0] && choose(list[0].key)}
      />
      <div className="choices">
        {list.map((r) => (
          <button
            key={r.key}
            className="ref-choice"
            data-testid="citation-choice"
            onClick={() => choose(r.key)}
          >
            <b>
              {r.author || '—'} ({r.year || 'n.d.'})
            </b>{' '}
            {r.title}
            <br />
            <small>@{r.key}</small>
          </button>
        ))}
        {list.length === 0 && (
          <div className="empty">
            {refs.length ? '該当する文献がありません' : 'BibTeXが読み込まれていません（Referenceタブを参照）'}
          </div>
        )}
      </div>
    </Modal>
  )
}

function TrashDialog({ d }: { d: DialogRequest }) {
  const trash = useApp((s) => s.snapshot?.trash ?? [])
  return (
    <Modal title="Trash" onClose={() => closeDialog(d)} testId="trash-dialog">
      <p className="helper">
        削除したメモはVault内の .facet/trash に保存されています。復元すると未配置メモとして戻ります。
      </p>
      <div className="choices">
        {trash.length === 0 && <div className="empty">ゴミ箱は空です</div>}
        {[...trash].reverse().map((t) => (
          <div key={t.id} className="trash-row">
            <span>
              <b>{t.title}</b> <small className="helper">{new Date(t.deletedAt).toLocaleString()}</small>
            </span>
            <button
              className="btn small"
              data-testid="trash-restore"
              onClick={() => void restoreFromTrash(t.id)}
            >
              Restore
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

export function DialogHost() {
  const dialogs = useApp((s) => s.dialogs)
  return (
    <>
      {dialogs.map((d, i) => {
        switch (d.kind) {
          case 'prompt':
            return <PromptDialog key={i} d={d} />
          case 'confirm':
            return <ConfirmDialog key={i} d={d} />
          case 'note-create':
            return <NewNoteDialog key={i} d={d} />
          case 'citation':
            return <CitationDialog key={i} d={d} />
          case 'settings':
            return <SettingsDialog key={i} onClose={() => closeDialog(d)} />
          case 'trash':
            return <TrashDialog key={i} d={d} />
          case 'manuscript-fullscreen':
            return (
              <Modal
                key={i}
                title="Manuscript"
                wide
                onClose={() => closeDialog(d)}
                testId="manuscript-fullscreen"
              >
                <ManuscriptDocument />
              </Modal>
            )
        }
      })}
    </>
  )
}

export function ToastHost() {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
          data-testid="toast"
        >
          <span>{t.text}</span>
          {t.action && (
            <button
              className="btn small"
              onClick={() => {
                dismissToast(t.id)
                t.action!.run()
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
