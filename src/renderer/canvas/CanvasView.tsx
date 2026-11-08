// Canvas tab: Canvas Tools at the top of the centre pane, free layout (All) or section tree (SPEC §3).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { sectionBreadcrumb } from '../../shared/domain/numbering'
import { findSection } from '../../shared/domain/structure'
import type { GroupNode as GroupData } from '../../shared/domain/types'
import { openContextMenu } from '../common/ContextMenu'
import {
  copyNote,
  createGroup,
  createNote,
  deleteNotes,
  openCitation,
  pasteNote,
  toggleArchive,
} from '../store/actions'
import { confirmAction, exec, promptText, selectNote, toast, useApp } from '../store/store'
import { freeLayout, treeLayout, GROUP_WIDTH, LOOSE_WIDTH } from './layout'

const NOTE_MIME = 'application/x-facet-note'

function preview(body: string): string {
  return body.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t, a) => a ?? t)
}

function NoteChip({ noteId, index, groupId }: { noteId: string; index: number; groupId: string }) {
  const note = useApp((s) => s.snapshot?.state.notes[noteId])
  const selected = useApp((s) =>
    s.multiSelect ? s.selectedNoteIds.includes(noteId) : s.selectedNoteId === noteId,
  )
  const [zone, setZone] = useState<'before' | 'after' | null>(null)
  if (!note) return null
  return (
    <div
      className={`note-chip nodrag nopan ${selected ? 'selected' : ''} ${zone ? `drop-${zone}` : ''}`}
      draggable
      data-testid="canvas-note"
      data-note-id={noteId}
      onDragStart={(e) => {
        e.stopPropagation()
        e.dataTransfer.setData(NOTE_MIME, noteId)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(NOTE_MIME)) return
        e.preventDefault()
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        setZone(e.clientY < r.top + r.height / 2 ? 'before' : 'after')
      }}
      onDragLeave={() => setZone(null)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setZone(null)
        const id = e.dataTransfer.getData(NOTE_MIME)
        const r = e.currentTarget.getBoundingClientRect()
        if (id && id !== noteId)
          void exec({
            type: 'note.move',
            id,
            target: {
              kind: 'note',
              id: noteId,
              position: e.clientY < r.top + r.height / 2 ? 'before' : 'after',
            },
          })
      }}
      onClick={(e) => {
        e.stopPropagation()
        selectNote(noteId, groupId)
      }}
      onDoubleClick={() => useApp.setState({ rightOpen: true, selectedNoteId: noteId })}
      title="クリックで選択、ダブルクリックで右ペインで全文編集"
    >
      <b>
        <span className="chip-index">{index + 1}.</span> {note.title}
      </b>
      <span className="chip-body">{preview(note.body) || <i className="helper">（本文なし）</i>}</span>
    </div>
  )
}

type GroupNodeData = { group: GroupData; crumb: string; expanded: boolean; tree: boolean }

const GroupNodeView = memo(function GroupNodeView({ data }: NodeProps<Node<GroupNodeData>>) {
  const { group, crumb, expanded, tree } = data
  const selected = useApp((s) => s.selectedGroupId === group.id)
  const notes = useApp((s) => s.snapshot?.state.notes)
  const [over, setOver] = useState(false)
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    void exec({ type: 'canvas.setGroupExpanded', ids: [group.id], expanded: !expanded })
  }
  const menu = (e: React.MouseEvent) =>
    openContextMenu(e, [
      { label: '＋ New note in this group', run: () => void createNote({ groupId: group.id }) },
      {
        label: '✎ Rename group',
        run: async () => {
          const t = await promptText('Paragraph Groupの名前', { initial: group.title })
          if (t) await exec({ type: 'group.rename', id: group.id, title: t })
        },
      },
      {
        label: '⌫ Delete group (notes become Unassigned)',
        danger: true,
        run: async () => {
          if (
            await confirmAction(
              'Paragraph Groupを削除',
              `「${group.title}」を削除します。中のメモは未配置になります。`,
              { okLabel: '削除', danger: true },
            )
          )
            await exec({ type: 'group.delete', id: group.id })
        },
      },
    ])
  return (
    <div
      className={`para ${selected ? 'selected' : ''} ${over ? 'drop-inside' : ''}`}
      style={{ width: GROUP_WIDTH }}
      data-testid="canvas-group"
      data-group-id={group.id}
      onClick={() => useApp.setState({ selectedGroupId: group.id })}
      onContextMenu={menu}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(NOTE_MIME)) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as globalThis.Node) && setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        const id = e.dataTransfer.getData(NOTE_MIME)
        if (id)
          void exec({ type: 'note.move', id, target: { kind: 'group', id: group.id, position: 'inside' } })
      }}
    >
      <Handle type="target" position={Position.Top} className="hidden-handle" isConnectable={false} />
      <div className="para-head" data-testid="group-head">
        <div className="crumb" data-testid="group-crumb">
          {crumb}
        </div>
        <strong>¶ {group.title}</strong>
        <button
          className="expand nodrag"
          aria-label={expanded ? '折りたたむ' : '展開'}
          data-testid="group-expand"
          onClick={toggle}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>
      <div className="notes">
        {expanded ? (
          group.noteIds.length ? (
            group.noteIds.map((id, i) => <NoteChip key={id} noteId={id} index={i} groupId={group.id} />)
          ) : (
            <div className="helper">メモなし（ここへドラッグ）</div>
          )
        ) : (
          <div className="helper clamp2">
            {group.noteIds.length} notes · {group.noteIds.map((id) => notes?.[id]?.title).join(' / ')}
          </div>
        )}
      </div>
      <div className="para-footer">
        {group.noteIds.length} notes · {tree ? 'Auto layout' : 'Drag header to move'}
      </div>
    </div>
  )
})

const LooseNoteView = memo(function LooseNoteView({ data }: NodeProps<Node<{ noteId: string }>>) {
  const note = useApp((s) => s.snapshot?.state.notes[data.noteId])
  const selected = useApp((s) =>
    s.multiSelect ? s.selectedNoteIds.includes(data.noteId) : s.selectedNoteId === data.noteId,
  )
  if (!note) return null
  return (
    <div
      className={`unassigned-note ${selected ? 'selected' : ''}`}
      style={{ width: LOOSE_WIDTH }}
      data-testid="canvas-unassigned"
      data-note-id={note.id}
      onClick={() => selectNote(note.id)}
      onDoubleClick={() => useApp.setState({ rightOpen: true, selectedNoteId: note.id })}
    >
      <div className="crumb">Unassigned · No Outline</div>
      <strong>{note.title}</strong>
      <p className="chip-body">{preview(note.body) || <i className="helper">（本文なし）</i>}</p>
      <div
        className="drag-to-group nodrag"
        draggable
        title="Paragraph Groupへドラッグして配置"
        onDragStart={(e) => {
          e.stopPropagation()
          e.dataTransfer.setData(NOTE_MIME, note.id)
        }}
      >
        ⠿ Groupへ配置
      </div>
    </div>
  )
})

function HeaderNodeView({ data }: NodeProps<Node<{ label: string }>>) {
  return (
    <div className="tree-node" data-testid="tree-header">
      <Handle type="target" position={Position.Left} className="hidden-handle" isConnectable={false} />
      {data.label}
      <Handle type="source" position={Position.Bottom} className="hidden-handle" isConnectable={false} />
    </div>
  )
}

const nodeTypes = { group: GroupNodeView, loose: LooseNoteView, header: HeaderNodeView }

function CanvasTools({ center }: { center: () => { x: number; y: number } }) {
  const multi = useApp((s) => s.multiSelect)
  const tools: Array<[string, string, string, () => void]> = [
    ['plus', '＋', 'New', () => void createNote({ canvasPos: center() })],
    ['copy', '⧉', 'Copy', copyNote],
    ['paste', '▤', 'Paste', () => void pasteNote(center())],
    [
      'group',
      '▣',
      'Group',
      () => {
        const s = useApp.getState()
        const noteIds = s.multiSelect ? s.selectedNoteIds : []
        void createGroup({ canvasPos: center(), noteIds })
      },
    ],
    [
      'multi',
      '◫',
      'Select',
      () => {
        const next = !useApp.getState().multiSelect
        useApp.setState({
          multiSelect: next,
          selectedNoteIds:
            next && useApp.getState().selectedNoteId ? [useApp.getState().selectedNoteId!] : [],
        })
        toast(`複数選択モード: ${next ? 'ON' : 'OFF'}`)
      },
    ],
    ['delete', '⌫', 'Delete', () => void deleteNotes()],
    ['archive', '▱', 'Archive', () => void toggleArchive()],
  ]
  return (
    <div className="canvas-tools" data-testid="canvas-tools" role="toolbar" aria-label="Canvas Tools">
      <span className="canvas-tools-label">CANVAS TOOLS</span>
      {tools.map(([k, icon, label, run]) => (
        <button
          key={k}
          className={`btn tool ${k === 'multi' && multi ? 'active' : ''}`}
          data-testid={`tool-${label.toLowerCase()}`}
          title={label}
          onClick={run}
        >
          {icon} <span>{label}</span>
        </button>
      ))}
      <span className="grow" />
      <button className="btn tool" data-testid="tool-citation" onClick={() => openCitation()}>
        ❞ <span>Citation</span>
      </button>
    </div>
  )
}

function CanvasInner() {
  const snapshot = useApp((s) => s.snapshot)!
  const scope = useApp((s) => s.scope)
  const state = snapshot.state
  const rf = useReactFlow()
  const viewport = useViewport()
  const wrapper = useRef<HTMLDivElement>(null)
  const treeSection =
    scope !== 'all' && scope !== 'unassigned' && findSection(state.structure, scope) ? scope : null
  const layout = useMemo(
    () => (treeSection ? treeLayout(state, treeSection) : freeLayout(state)),
    [state, treeSection],
  )
  const tree = layout.mode === 'tree'

  const derivedNodes = useMemo<Node[]>(() => {
    const nodes: Node[] = []
    for (const h of layout.headers)
      nodes.push({
        id: h.id,
        type: 'header',
        position: { x: h.x, y: h.y },
        data: { label: h.label },
        draggable: false,
        selectable: false,
      })
    for (const g of layout.groups)
      nodes.push({
        id: g.id,
        type: 'group',
        position: { x: g.x, y: g.y },
        data: { group: g.group, crumb: g.crumb, expanded: g.expanded, tree },
        dragHandle: '.para-head',
        draggable: !tree,
      })
    for (const l of layout.loose)
      nodes.push({
        id: l.id,
        type: 'loose',
        position: { x: l.x, y: l.y },
        data: { noteId: l.noteId },
        draggable: true,
      })
    return nodes
  }, [layout, tree])
  const [nodes, setNodes] = useState<Node[]>(derivedNodes)
  useEffect(() => setNodes(derivedNodes), [derivedNodes])
  const edges = useMemo<Edge[]>(
    () => layout.edges.map((e) => ({ ...e, type: 'smoothstep', selectable: false, className: 'tree-edge' })),
    [layout],
  )
  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((ns) =>
        applyNodeChanges(
          changes.filter((c) => c.type !== 'select' && c.type !== 'remove'),
          ns,
        ),
      ),
    [],
  )

  // Initial viewport: saved one for All, fit for the tree view.
  const initialised = useRef<string | null>(null)
  useEffect(() => {
    const key = `${snapshot.id}:${treeSection ?? 'all'}`
    if (initialised.current === key) return
    initialised.current = key
    const saved = state.canvas.canvases[0].viewport
    requestAnimationFrame(() => {
      if (!treeSection && saved) void rf.setViewport(saved)
      else void rf.fitView({ padding: 0.12, maxZoom: 1 })
    })
  }, [snapshot.id, treeSection]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveViewport = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onMoveEnd = useCallback(
    (_: unknown, vp: { x: number; y: number; zoom: number }) => {
      if (treeSection) return
      clearTimeout(saveViewport.current)
      saveViewport.current = setTimeout(
        () => void exec({ type: 'canvas.setViewport', viewport: vp }, { quiet: true }),
        600,
      )
    },
    [treeSection],
  )

  const center = () => {
    const r = wrapper.current?.getBoundingClientRect()
    if (!r) return { x: 100, y: 100 }
    return rf.screenToFlowPosition({ x: r.left + r.width / 2 - 110, y: r.top + r.height / 2 - 50 })
  }

  const fitAll = () => void rf.fitView({ padding: 0.1, duration: 200 })
  const zoom100 = () => {
    const r = wrapper.current?.getBoundingClientRect()
    if (!r) return
    const vp = rf.getViewport()
    const cx = (r.width / 2 - vp.x) / vp.zoom
    const cy = (r.height / 2 - vp.y) / vp.zoom
    void rf.setViewport({ x: r.width / 2 - cx, y: r.height / 2 - cy, zoom: 1 }, { duration: 150 })
  }
  const fitGroup = () => {
    const sel = useApp.getState().selectedGroupId
    const target = (sel && nodes.find((n) => n.id === `g:${sel}`)) || nodes.find((n) => n.type === 'group')
    if (!target) return toast('表示中のParagraph Groupがありません', 'error')
    useApp.setState({ selectedGroupId: target.id.slice(2) })
    void rf.fitView({ nodes: [{ id: target.id }], padding: 0.15, duration: 200, maxZoom: 2 })
  }

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === 'group')
        void exec({ type: 'canvas.setGroupPos', id: node.id.slice(2), pos: node.position }, { quiet: true })
      if (node.type === 'loose') {
        const noteId = node.id.slice(2)
        const hit = rf.getIntersectingNodes(node).find((n) => n.type === 'group')
        if (hit)
          void exec({
            type: 'batch',
            label: 'place note',
            commands: [
              {
                type: 'note.move',
                id: noteId,
                target: { kind: 'group', id: hit.id.slice(2), position: 'inside' },
              },
            ],
          })
        else void exec({ type: 'canvas.setNotePos', id: noteId, pos: node.position }, { quiet: true })
      }
    },
    [rf],
  )

  const onDropPane = (e: DragEvent) => {
    const id = e.dataTransfer.getData(NOTE_MIME)
    if (!id || tree) return
    e.preventDefault()
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    void exec({
      type: 'batch',
      label: 'unplace note',
      commands: [
        { type: 'note.move', id, target: { kind: 'unassigned' } },
        { type: 'canvas.setNotePos', id, pos },
      ],
    })
  }

  const scopeLabel = treeSection ? sectionBreadcrumb(state.structure, treeSection) : 'All'
  return (
    <div className="canvas-view" data-testid="canvas-view">
      <CanvasTools center={center} />
      <div className="canvas-controls">
        <strong>▧ Main Canvas</strong>
        <span className="muted">/</span>
        <span className="muted" data-testid="canvas-scope">
          {scopeLabel}
        </span>
        <span className="grow" />
        <span className="helper">Drag background to pan · Scroll to zoom</span>
        <button className="btn" data-testid="fit-all" onClick={fitAll}>
          Fit all
        </button>
        <button className="btn" data-testid="zoom-100" onClick={zoom100}>
          100%
        </button>
        <button className="btn" data-testid="fit-group" onClick={fitGroup}>
          Fit group
        </button>
      </div>
      <div
        className="stage"
        ref={wrapper}
        data-testid="canvas-stage"
        onDragOver={(e) => e.dataTransfer.types.includes(NOTE_MIME) && !tree && e.preventDefault()}
        onDrop={onDropPane}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onMoveEnd={onMoveEnd}
          onPaneClick={() => !useApp.getState().multiSelect && useApp.setState({ selectedGroupId: null })}
          onPaneContextMenu={(e) => {
            const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
            openContextMenu(e, [
              { label: '＋ New Note', run: () => void createNote({ canvasPos: pos }) },
              { label: '▣ Paragraph Group', run: () => void createGroup({ canvasPos: pos }) },
              { label: '❞ Insert Citation', run: () => openCitation() },
              { label: '⤢ Fit View', run: fitAll },
            ])
          }}
          minZoom={0.1}
          maxZoom={4}
          zoomOnDoubleClick={false}
          selectionOnDrag={false}
          panOnDrag
          nodesConnectable={false}
          elementsSelectable={false}
          onlyRenderVisibleElements
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
        />
        <div className="stage-bottom">
          <div className="zoom-pill">
            <button
              aria-label="Zoom out"
              data-testid="zoom-out"
              onClick={() => void rf.zoomOut({ duration: 120 })}
            >
              −
            </button>
            <span data-testid="zoom-text">{Math.round(viewport.zoom * 100)}%</span>
            <button
              aria-label="Zoom in"
              data-testid="zoom-in"
              onClick={() => void rf.zoomIn({ duration: 120 })}
            >
              ＋
            </button>
          </div>
          <span className="grow" />
          <div className="status" data-testid="canvas-status">
            {tree ? 'Auto tree layout' : 'Free layout'} · {layout.groups.length} groups
            {tree ? '' : ` · ${layout.loose.length} unassigned`}
          </div>
        </div>
      </div>
    </div>
  )
}

export function CanvasView() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
