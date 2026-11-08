// Outline: full hierarchy, collapse, drag & drop, inline editing, Unassigned, manuscript split (SPEC §4).
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { DropPosition, DropTarget } from '../../shared/domain/commands'
import { computeNumbering } from '../../shared/domain/numbering'
import { allGroups, childrenOf, findGroup, findNoteLocation, findSection, groupedNoteIds, type ParentRef } from '../../shared/domain/structure'
import type { GroupNode, SectionNode } from '../../shared/domain/types'
import { openContextMenu } from '../common/ContextMenu'
import { MarkdownEditor } from '../editor/MarkdownEditor'
import { TitleField } from '../editor/NoteEditor'
import { createGroup, createNote, createSection, deleteNotes, toggleArchive, unplaceNote } from '../store/actions'
import { confirmAction, exec, openDialog, promptText, selectNote, toast, useApp } from '../store/store'
import { ManuscriptPane } from './ManuscriptPane'

type Kind = 'section' | 'group' | 'note'
const DRAG_MIME = 'application/x-facet-outline'
let dragging: { kind: Kind; id: string } | null = null

function zoneOf(e: DragEvent, el: HTMLElement, container: boolean): DropPosition {
  const r = el.getBoundingClientRect()
  const v = (e.clientY - r.top) / r.height
  if (container && v > 0.25 && v < 0.75) return 'inside'
  return v < 0.5 ? 'before' : 'after'
}

async function performMove(from: { kind: Kind; id: string }, target: DropTarget) {
  const type = from.kind === 'section' ? 'section.move' : from.kind === 'group' ? 'group.move' : 'note.move'
  const r = await exec({ type, id: from.id, target } as never, { quiet: true })
  if (r.ok) toast('Outlineの構造を更新しました')
  else toast(r.code === 'invalid-move' || r.code === 'not-found' ? `この位置には移動できません: ${r.message}` : r.message, 'error')
}

function useDropRow(kind: Kind, id: string, container: boolean) {
  const [zone, setZone] = useState<DropPosition | null>(null)
  return {
    zone,
    handlers: {
      draggable: true,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        e.stopPropagation()
        dragging = { kind, id }
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragging))
        e.dataTransfer.setData('application/x-facet-note', kind === 'note' ? id : '')
        e.dataTransfer.effectAllowed = 'move'
        ;(e.currentTarget as HTMLElement).classList.add('dragging')
      },
      onDragEnd: (e: DragEvent<HTMLElement>) => {
        dragging = null
        ;(e.currentTarget as HTMLElement).classList.remove('dragging')
      },
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!dragging || (dragging.kind === kind && dragging.id === id)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        setZone(zoneOf(e, e.currentTarget, container))
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null)
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setZone(null)
        const from = dragging
        dragging = null
        if (!from) return
        void performMove(from, { kind, id, position: zoneOf(e, e.currentTarget, container) })
      },
    },
  }
}

/** Keyboard alternative to drag & drop: Alt+↑ / Alt+↓ swaps with the neighbouring item. */
function keyboardMove(e: KeyboardEvent, kind: Kind, id: string) {
  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
  e.preventDefault()
  const s = useApp.getState().snapshot?.state.structure
  if (!s) return
  const up = e.key === 'ArrowUp'
  if (kind === 'note') {
    const loc = findNoteLocation(s, id)
    if (!loc) return
    const other = loc.group.noteIds[loc.index + (up ? -1 : 1)]
    if (other) void performMove({ kind, id }, { kind: 'note', id: other, position: up ? 'before' : 'after' })
    return
  }
  const parent: ParentRef | undefined = kind === 'section' ? findSection(s, id)?.parent : findGroup(s, id)?.parent
  if (!parent) return
  const list = childrenOf(s, parent)
  const i = list.findIndex((c) => c.id === id)
  const other = list[i + (up ? -1 : 1)]
  if (other) void performMove({ kind, id }, { kind: other.kind, id: other.id, position: up ? 'before' : 'after' })
}

function Row({ kind, id, className, children, onClick, onDoubleClick, onContextMenu, testId }: {
  kind: Kind
  id: string
  className: string
  children: ReactNode
  onClick?: () => void
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  testId: string
}) {
  const { zone, handlers } = useDropRow(kind, id, kind !== 'note')
  const selected = useApp((s) => (kind === 'note' ? s.selectedNoteId === id : kind === 'group' ? s.selectedGroupId === id : false))
  return (
    <div
      {...handlers}
      tabIndex={0}
      role="treeitem"
      aria-selected={selected}
      className={`outline-node ${className} ${zone ? `drop-${zone}` : ''} ${selected ? 'selected' : ''}`}
      data-testid={testId}
      data-kind={kind}
      data-id={id}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        keyboardMove(e, kind, id)
        if (e.key === 'Enter') (onDoubleClick ?? onClick)?.()
      }}
    >
      <span className="drag-handle" aria-hidden>
        ⠿
      </span>
      {children}
    </div>
  )
}

function CollapseToggle({ k }: { k: string }) {
  const collapsed = useApp((s) => s.outlineCollapsed.includes(k))
  return (
    <button
      className="collapse-toggle"
      aria-label={collapsed ? '展開' : '折りたたむ'}
      aria-expanded={!collapsed}
      data-testid="collapse-toggle"
      onClick={(e) => {
        e.stopPropagation()
        useApp.setState((s) => ({ outlineCollapsed: collapsed ? s.outlineCollapsed.filter((x) => x !== k) : [...s.outlineCollapsed, k] }))
      }}
    >
      {collapsed ? '▸' : '▾'}
    </button>
  )
}

function InlineNote({ noteId }: { noteId: string }) {
  return (
    <div className="inline-editor" data-testid="inline-editor">
      <div className="row">
        <span className="helper">Outline内で直接編集 · Markdown（自動保存）</span>
        <span className="grow" />
        <button className="btn small" data-testid="inline-close" onClick={() => useApp.setState({ inlineNoteId: null })}>
          Close
        </button>
      </div>
      <TitleField noteId={noteId} testId="inline-title" />
      <MarkdownEditor noteId={noteId} autoFocus minHeight={110} testId="inline-body" />
    </div>
  )
}

function NoteRow({ noteId, index }: { noteId: string; index?: number }) {
  const note = useApp((s) => s.snapshot?.state.notes[noteId])
  const inline = useApp((s) => s.inlineNoteId === noteId)
  if (!note) return null
  const openInline = () => {
    selectNote(noteId)
    useApp.setState({ inlineNoteId: inline ? null : noteId })
  }
  return (
    <>
      <Row
        kind="note"
        id={noteId}
        className="outline-note"
        testId="outline-note"
        onClick={() => selectNote(noteId)}
        onDoubleClick={openInline}
        onContextMenu={(e) =>
          openContextMenu(e, [
            { label: '✎ Outline内で編集', run: openInline },
            { label: '⇱ 未配置へ戻す', run: () => void unplaceNote(noteId), disabled: index === undefined },
            { label: '▱ Archive', run: () => void toggleArchive([noteId]) },
            { label: '⌫ Delete', danger: true, run: () => void deleteNotes([noteId]) },
          ])
        }
      >
        <span className="outline-icon">▤</span>
        <span className="outline-label">{note.title}</span>
        {index !== undefined && <span className="outline-meta">{index + 1}</span>}
        <button className="btn tiny ghost" title="Outline内で編集" data-testid="edit-inline" onClick={(e) => (e.stopPropagation(), openInline())}>
          ✎
        </button>
      </Row>
      {inline && <InlineNote noteId={noteId} />}
    </>
  )
}

function GroupBlock({ g }: { g: GroupNode }) {
  const collapsed = useApp((s) => s.outlineCollapsed.includes(`g:${g.id}`))
  const menu = (e: React.MouseEvent) =>
    openContextMenu(e, [
      { label: '＋ New note in this group', run: () => void createNote({ groupId: g.id }) },
      {
        label: '✎ Rename group',
        run: async () => {
          const t = await promptText('Paragraph Groupの名前', { initial: g.title })
          if (t) await exec({ type: 'group.rename', id: g.id, title: t })
        },
      },
      {
        label: '⌫ Delete group (notes become Unassigned)',
        danger: true,
        run: async () => {
          if (await confirmAction('Paragraph Groupを削除', `「${g.title}」を削除します。中のメモは削除されず未配置になります。`, { okLabel: '削除', danger: true }))
            await exec({ type: 'group.delete', id: g.id })
        },
      },
    ])
  return (
    <div className="outline-group-block">
      <Row kind="group" id={g.id} className="outline-group" testId="outline-group" onClick={() => useApp.setState({ selectedGroupId: g.id })} onContextMenu={menu}>
        <CollapseToggle k={`g:${g.id}`} />
        <span className="outline-icon">¶</span>
        <span className="outline-label">{g.title}</span>
        <span className="outline-meta">{g.noteIds.length} notes</span>
        <button className="btn tiny ghost" title="メニュー" onClick={(e) => menu(e)}>
          ⋯
        </button>
      </Row>
      {!collapsed && (
        <div className="outline-notes">
          {g.noteIds.map((id, i) => (
            <NoteRow key={id} noteId={id} index={i} />
          ))}
          {g.noteIds.length === 0 && <div className="helper empty-row">メモをここへドラッグ</div>}
        </div>
      )}
    </div>
  )
}

function SectionBlock({ s, depth, labels }: { s: SectionNode; depth: number; labels: Map<string, string> }) {
  const collapsed = useApp((st) => st.outlineCollapsed.includes(`s:${s.id}`))
  const ref = useRef<HTMLDivElement>(null)
  const scrollTo = useApp((st) => st.scrollToSection)
  useEffect(() => {
    if (scrollTo?.id === s.id) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [scrollTo, s.id])
  const groupCount = useMemo(() => {
    let n = 0
    const rec = (x: SectionNode) => x.children.forEach((c) => (c.kind === 'group' ? n++ : rec(c)))
    rec(s)
    return n
  }, [s])
  const menu = (e: React.MouseEvent) =>
    openContextMenu(e, [
      { label: '＋ Subsection', run: () => void createSection(s.id) },
      { label: '＋ Paragraph Group', run: () => void createGroup({ sectionId: s.id }) },
      {
        label: '✎ Rename',
        run: async () => {
          const t = await promptText('章節タイトル（番号は自動）', { initial: s.title })
          if (t) await exec({ type: 'section.rename', id: s.id, title: t })
        },
      },
      {
        label: '⌫ Delete section (contents are kept)',
        danger: true,
        run: async () => {
          if (await confirmAction('章節を削除', `「${labels.get(s.id)}」を削除します。子の章節やParagraph Group、メモは削除されず親へ移動します。`, { okLabel: '削除', danger: true }))
            await exec({ type: 'section.delete', id: s.id })
        },
      },
    ])
  return (
    <div className={`outline-section-block depth-${depth}`} ref={ref} data-section-block={s.id}>
      <Row kind="section" id={s.id} className={depth === 1 ? 'outline-section' : 'outline-subsection'} testId="outline-section" onClick={() => useApp.setState({ scope: s.id })} onContextMenu={menu}>
        <CollapseToggle k={`s:${s.id}`} />
        <strong className="outline-label">{labels.get(s.id)}</strong>
        <span className="outline-meta">{groupCount} paragraphs</span>
        <button className="btn tiny ghost" title="メニュー" data-testid="section-menu" onClick={(e) => menu(e)}>
          ⋯
        </button>
      </Row>
      {!collapsed && (
        <div className="outline-section-content">
          {s.children.map((c) => (c.kind === 'group' ? <GroupBlock key={c.id} g={c} /> : <SectionBlock key={c.id} s={c} depth={depth + 1} labels={labels} />))}
        </div>
      )}
    </div>
  )
}

function UnassignedBlock() {
  const snapshot = useApp((s) => s.snapshot)!
  const [over, setOver] = useState(false)
  const grouped = groupedNoteIds(snapshot.state.structure)
  const loose = Object.values(snapshot.state.notes)
    .filter((n) => !n.archived && !grouped.has(n.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const groups = snapshot.state.structure.unplacedGroups
  return (
    <div
      className={`outline-unassigned ${over ? 'drop-inside' : ''}`}
      data-testid="outline-unassigned"
      onDragOver={(e) => {
        if (!dragging || dragging.kind === 'section') return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const from = dragging
        dragging = null
        if (from && from.kind !== 'section') void performMove(from, { kind: 'unassigned' })
      }}
    >
      <div className="outline-unassigned-title">
        Unassigned <span className="outline-meta">{loose.length} notes · {groups.length} groups · 原稿に含まれません</span>
      </div>
      {groups.map((g) => (
        <GroupBlock key={g.id} g={g} />
      ))}
      {loose.map((n) => (
        <NoteRow key={n.id} noteId={n.id} />
      ))}
      {loose.length === 0 && groups.length === 0 && <div className="helper empty-row">未配置のメモはありません</div>}
    </div>
  )
}

export function OutlineView() {
  const snapshot = useApp((s) => s.snapshot)
  const split = useApp((s) => s.manuscriptSplit)
  const structure = snapshot?.state.structure
  const labels = useMemo(() => (structure ? computeNumbering(structure).label : new Map<string, string>()), [structure])
  if (!snapshot || !structure) return null
  const expandAll = () => useApp.setState({ outlineCollapsed: [] })
  const collapseAll = () =>
    useApp.setState({
      outlineCollapsed: [...[...labels.keys()].map((id) => `s:${id}`), ...allGroups(structure).map((g) => `g:${g.group.id}`)],
    })
  const scope = useApp.getState().scope
  const sectionForNewGroup = scope !== 'all' && scope !== 'unassigned' ? scope : (structure.root.children[0]?.id ?? null)
  return (
    <div className={`outline-workspace ${split ? 'split' : ''}`} data-testid="outline-view">
      <section className="outline-primary" data-testid="outline-primary">
        <div className="outline-sticky" data-testid="outline-toolbar">
          <button className="btn" data-testid="expand-all" onClick={expandAll}>
            Expand all
          </button>
          <button className="btn" data-testid="collapse-all" onClick={collapseAll}>
            Collapse all
          </button>
          <button className="btn" data-testid="add-section" onClick={() => void createSection(null)}>
            ＋ Section
          </button>
          <button className="btn" data-testid="add-paragraph" onClick={() => void createGroup({ sectionId: sectionForNewGroup })}>
            ＋ Paragraph
          </button>
          <span className="grow" />
          <button className={`btn ${split ? 'active' : ''}`} data-testid="open-manuscript" onClick={() => useApp.setState({ manuscriptSplit: !split })}>
            {split ? '✕ Close preview' : '◧ Open Manuscript'}
          </button>
          <button className="btn" data-testid="manuscript-fullscreen-button" onClick={() => openDialog({ kind: 'manuscript-fullscreen' })}>
            ⤢ Fullscreen
          </button>
        </div>
        <p className="subheading">ドラッグで章節・Paragraph・メモを並び替え（Alt+↑↓でも移動）。メモをダブルクリックでOutline内編集。</p>
        <div role="tree" aria-label="Outline" className="outline-tree">
          {structure.root.children.map((s) => (
            <SectionBlock key={s.id} s={s} depth={1} labels={labels} />
          ))}
          <RootDropZone />
          <UnassignedBlock />
        </div>
      </section>
      {split && <ManuscriptPane onClose={() => useApp.setState({ manuscriptSplit: false })} />}
    </div>
  )
}

function RootDropZone() {
  const [over, setOver] = useState(false)
  return (
    <div
      className={`root-drop ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        if (dragging?.kind !== 'section') return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const from = dragging
        dragging = null
        if (from?.kind === 'section') void performMove(from, { kind: 'root' })
      }}
    >
      章をここへドロップすると末尾へ移動
    </div>
  )
}
