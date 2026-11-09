// Cards: square responsive grid, search, sort, grouping, Outline filter (SPEC §5, UI-12).
import { Fragment, useMemo } from 'react'
import { computeNumbering, sectionBreadcrumb } from '../../shared/domain/numbering'
import {
  allSections,
  findNoteLocation,
  manuscriptNoteIds,
  sectionSubtreeIds,
} from '../../shared/domain/structure'
import type { Note } from '../../shared/domain/types'
import { matchesQuery } from '../../shared/search/tokenizer'
import { openContextMenu } from '../common/ContextMenu'
import { NoteBodyPanel } from '../editor/NoteBodyPanel'
import { copyNote, deleteNotes, toggleArchive } from '../store/actions'
import { openDialog, selectNote, useApp, type CardsOptions } from '../store/store'

export function excerpt(body: string, n = 160): string {
  const t = body
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b ?? a)
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

export function NoteCard({
  note,
  workspace,
  onOpen,
  extra,
  expanded,
}: {
  note: Note | { id: string; title: string; body: string; tags: string[]; archived?: boolean }
  workspace?: string
  /** `detail` is the click count (2 for the second click of a double click). */
  onOpen: (e?: { detail: number }) => void
  extra?: React.ReactNode
  /** Set when the card can expand: whether its full text is open below it. */
  expanded?: boolean
}) {
  const selected = useApp((s) => s.selectedNoteId === note.id)
  return (
    <div
      className={`memocard ${selected ? 'selected' : ''} ${note.archived ? 'archived' : ''} ${expanded ? 'expanded' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      data-testid="memo-card"
      data-note-id={note.id}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      onContextMenu={(e) =>
        !workspace &&
        openContextMenu(e, [
          { label: '⧉ Copy (for Paste / other workspace)', run: () => (selectNote(note.id), copyNote()) },
          { label: note.archived ? '▱ Unarchive' : '▱ Archive', run: () => void toggleArchive([note.id]) },
          { label: '⌫ Delete', danger: true, run: () => void deleteNotes([note.id]) },
        ])
      }
    >
      <h4>{note.title}</h4>
      {workspace && (
        <div className="helper ws-label" data-testid="card-workspace">
          {workspace}
        </div>
      )}
      <p>{excerpt(note.body)}</p>
      <div className="tags">
        {note.archived && <span className="tag archived-tag">Archived</span>}
        {note.tags.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </div>
      {extra}
    </div>
  )
}

export function CardsView() {
  const snapshot = useApp((s) => s.snapshot)!
  const scope = useApp((s) => s.scope)
  const opts = useApp((s) => s.cards)
  const setOpt = (patch: Partial<CardsOptions>) =>
    useApp.setState((s) => ({ cards: { ...s.cards, ...patch } }))
  const { structure, notes } = snapshot.state
  const numbering = useMemo(() => computeNumbering(structure), [structure])

  const expanded = useApp((s) => s.cardsExpanded)
  const expandedNoteId = expanded?.split('\u0000')[1] ?? null

  const groups = useMemo(() => {
    const inManuscript = manuscriptNoteIds(structure)
    const subtree = scope !== 'all' && scope !== 'unassigned' ? sectionSubtreeIds(structure, scope) : null
    const list = Object.values(notes).filter((n) => {
      if (n.archived && !opts.showArchived) return false
      if (scope === 'unassigned' && inManuscript.has(n.id)) return false
      if (subtree) {
        const loc = findNoteLocation(structure, n.id)
        const parent = loc?.groupLocation.parent
        if (!parent || parent.type !== 'section' || !subtree.has(parent.id)) return false
      }
      // A note open for editing stays until it is collapsed, even if its edited text stops matching.
      if (n.id === expandedNoteId) return true
      return matchesQuery(`${n.title}\n${n.body}\n${n.tags.join(' ')}`, opts.query)
    })
    list.sort((a, b) =>
      opts.sort === 'title'
        ? a.title.localeCompare(b.title, 'ja')
        : opts.sort === 'newest'
          ? b.createdAt.localeCompare(a.createdAt)
          : a.createdAt.localeCompare(b.createdAt),
    )
    const out = new Map<string, Note[]>()
    const push = (k: string, n: Note) => (out.get(k) ?? out.set(k, []).get(k)!).push(n)
    for (const n of list) {
      if (opts.groupBy === 'tag') (n.tags.length ? n.tags : ['Untagged']).forEach((t) => push(t, n))
      else if (opts.groupBy === 'outline') {
        const parent = findNoteLocation(structure, n.id)?.groupLocation.parent
        push(
          parent?.type === 'section' ? sectionBreadcrumb(structure, parent.id, numbering) : 'Unassigned',
          n,
        )
      } else push('All Notes', n)
    }
    return [...out.entries()]
  }, [notes, structure, scope, opts, numbering, expandedNoteId])

  // After regrouping, the expanded note stays open at its first place in the new grouping.
  const openKey = useMemo(() => {
    if (!expanded || !expandedNoteId) return null
    const keys = groups.flatMap(([k, ns]) =>
      ns.filter((n) => n.id === expandedNoteId).map(() => `${k}\u0000${expandedNoteId}`),
    )
    return keys.includes(expanded) ? expanded : (keys[0] ?? null)
  }, [groups, expanded, expandedNoteId])

  const toggle = (key: string, noteId: string, e?: { detail: number }) => {
    if (e && e.detail > 1) return // the second click of a double click
    selectNote(noteId)
    useApp.setState({ cardsExpanded: openKey === key ? null : key })
  }

  const total = new Set(groups.flatMap(([, ns]) => ns.map((n) => n.id))).size
  return (
    <div className="listview" data-testid="cards-view">
      <div className="view-header">
        <h1 className="heading">Cards</h1>
        <span className="helper">{total} notes</span>
      </div>
      <div className="searchline">
        <input
          className="input grow"
          data-testid="cards-search"
          placeholder="Search notes, tags, links…"
          value={opts.query}
          onChange={(e) => setOpt({ query: e.target.value })}
        />
        <select
          className="select"
          data-testid="cards-groupby"
          aria-label="Group by"
          value={opts.groupBy}
          onChange={(e) => setOpt({ groupBy: e.target.value as CardsOptions['groupBy'] })}
        >
          <option value="tag">Group: Tags</option>
          <option value="outline">Group: Outline</option>
          <option value="none">Group: None</option>
        </select>
        <select
          className="select"
          data-testid="cards-filter"
          aria-label="Outline filter"
          value={scope}
          onChange={(e) => useApp.setState({ scope: e.target.value })}
        >
          <option value="all">Outline: All</option>
          <option value="unassigned">Unassigned</option>
          {allSections(structure).map((s) => (
            <option key={s.id} value={s.id}>
              {'　'.repeat((numbering.depth.get(s.id) ?? 1) - 1)}
              {numbering.label.get(s.id)}
            </option>
          ))}
        </select>
        <select
          className="select"
          data-testid="cards-sort"
          aria-label="Sort"
          value={opts.sort}
          onChange={(e) => setOpt({ sort: e.target.value as CardsOptions['sort'] })}
        >
          <option value="created">Oldest first</option>
          <option value="newest">Newest first</option>
          <option value="title">Title</option>
        </select>
        <label className="check">
          <input
            type="checkbox"
            data-testid="cards-archived"
            checked={opts.showArchived}
            onChange={(e) => setOpt({ showArchived: e.target.checked })}
          />{' '}
          Archived
        </label>
        <button className="btn" data-testid="open-trash" onClick={() => openDialog({ kind: 'trash' })}>
          🗑 Trash ({snapshot.trash.length})
        </button>
      </div>
      {groups.length === 0 && <div className="empty">該当するメモはありません</div>}
      {groups.map(([k, ns]) => (
        <section key={k} data-testid="card-group">
          <h3 className="pgroup-title">
            {k} <span className="muted">{ns.length}</span>
          </h3>
          <div className="cardgrid">
            {ns.map((n) => {
              const key = `${k}\u0000${n.id}`
              const open = openKey === key
              return (
                <Fragment key={key}>
                  <NoteCard note={n} expanded={open} onOpen={(e) => toggle(key, n.id, e)} />
                  {open && (
                    <NoteBodyPanel
                      noteId={n.id}
                      testId="card-body"
                      className="card-expand"
                      onClose={() => useApp.setState({ cardsExpanded: null })}
                    />
                  )}
                </Fragment>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
