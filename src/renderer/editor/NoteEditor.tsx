// Right pane: Note Editor only (SPEC §2.1, UI-03).
import { useEffect, useMemo, useState } from 'react'
import { sectionBreadcrumb } from '../../shared/domain/numbering'
import { findNoteLocation } from '../../shared/domain/structure'
import { linkInfo } from '../../shared/markdown/wikilink'
import { openCitation, toggleArchive } from '../store/actions'
import { exec, selectNote, toast, useApp } from '../store/store'
import { MarkdownEditor } from './MarkdownEditor'

export function TitleField({ noteId, testId }: { noteId: string; testId?: string }) {
  const title = useApp((s) => s.snapshot?.state.notes[noteId]?.title ?? '')
  const [value, setValue] = useState(title)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setValue(title), [title, noteId])
  const commit = async () => {
    const next = value.trim()
    if (next === title) return setError(null)
    const r = await exec({ type: 'note.rename', id: noteId, title: next }, { quiet: true })
    if (!r.ok) {
      setError(r.message)
      return
    }
    setError(null)
    if (r.info.updatedLinks) toast(`タイトルを変更し、${r.info.updatedLinks}件のWikiLinkを更新しました`)
  }
  return (
    <>
      <input
        className="input title-input"
        aria-label="Note title"
        data-testid={testId ?? 'note-title'}
        value={value}
        aria-invalid={!!error}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setValue(title)
            setError(null)
          }
        }}
      />
      {error && (
        <div className="field-error" role="alert">
          {error}
        </div>
      )}
    </>
  )
}

function TagsField({ noteId }: { noteId: string }) {
  const tags = useApp((s) => s.snapshot?.state.notes[noteId]?.tags)
  const joined = (tags ?? []).join(', ')
  const [value, setValue] = useState(joined)
  useEffect(() => setValue(joined), [joined, noteId])
  const commit = () => {
    const next = value
      .split(/[,、]/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (next.join(', ') !== joined) void exec({ type: 'note.setTags', id: noteId, tags: next })
  }
  return (
    <input
      className="input"
      aria-label="Tags"
      data-testid="note-tags"
      placeholder="カンマ区切り"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

export function NoteEditor() {
  const noteId = useApp((s) => s.selectedNoteId)
  const snapshot = useApp((s) => s.snapshot)
  const note = noteId ? snapshot?.state.notes[noteId] : undefined
  const info = useMemo(
    () => (note && snapshot ? linkInfo(snapshot.state.notes, note.id) : null),
    [note, snapshot],
  )

  if (!snapshot || !note || !info) {
    return (
      <div className="empty-pane" data-testid="note-editor-empty">
        <h3>✎ Note Editor</h3>
        <p className="helper">メモを選択すると、ここで本文を編集できます。</p>
      </div>
    )
  }
  const loc = findNoteLocation(snapshot.state.structure, note.id)
  const parent = loc?.groupLocation.parent
  const placement = loc
    ? parent?.type === 'section'
      ? `${sectionBreadcrumb(snapshot.state.structure, parent.id)} › ¶ ${loc.group.title}`
      : `未配置グループ › ¶ ${loc.group.title}`
    : 'Unassigned'

  return (
    <div className="note-editor" data-testid="note-editor">
      <div className="pane-heading">
        <h3>✎ Note Editor</h3>
        {note.archived && <span className="badge">Archived</span>}
      </div>
      <label className="field-label">Title</label>
      <TitleField noteId={note.id} />
      <label className="field-label">Body · Markdown</label>
      <MarkdownEditor key={note.id} noteId={note.id} minHeight={220} />
      <div className="row gap">
        <button className="btn" data-testid="editor-citation" onClick={() => openCitation(note.id)}>
          ❞ Citation
        </button>
        <button className="btn" onClick={() => void toggleArchive([note.id])}>
          {note.archived ? '▱ Unarchive' : '▱ Archive'}
        </button>
      </div>
      <label className="field-label">Tags</label>
      <TagsField noteId={note.id} />
      <label className="field-label">Outline</label>
      <div className="helper" data-testid="note-placement">
        {placement}
      </div>
      <label className="field-label">WikiLinks ({info.outgoing.length})</label>
      <div className="link-list">
        {info.outgoing.length === 0 && <span className="helper">リンクなし</span>}
        {info.outgoing.map((l) => (
          <button
            key={l.target}
            className={`link-chip ${l.noteId ? '' : 'broken'}`}
            title={l.noteId ? 'クリックで移動' : 'リンク切れ'}
            onClick={() =>
              l.noteId ? selectNote(l.noteId) : toast(`リンク先「${l.target}」が見つかりません`, 'error')
            }
          >
            {l.noteId ? '↗' : '⚠'} {l.target}
          </button>
        ))}
      </div>
      <label className="field-label">Backlinks ({info.backlinks.length})</label>
      <div className="link-list" data-testid="backlinks">
        {info.backlinks.length === 0 && <span className="helper">被リンクなし</span>}
        {info.backlinks.map((id) => (
          <button key={id} className="link-chip" onClick={() => selectNote(id)}>
            ↙ {snapshot.state.notes[id]?.title}
          </button>
        ))}
      </div>
      <p className="helper hint">WikiLink: [[メモタイトル]]（Ctrl+クリックで移動）· Citation: [@Key]</p>
    </div>
  )
}
