// Canvas layouts: free layout positions (All) and the computed section tree (SPEC §3.2).
import { computeNumbering, sectionBreadcrumb } from '../../shared/domain/numbering'
import { allGroups, findSection, groupedNoteIds } from '../../shared/domain/structure'
import type { DomainState, GroupNode, SectionNode } from '../../shared/domain/types'

export const GROUP_WIDTH = 328
export const LOOSE_WIDTH = 236

export interface LayoutGroup {
  kind: 'group'
  id: string
  group: GroupNode
  x: number
  y: number
  crumb: string
  expanded: boolean
}
export interface LayoutLoose {
  kind: 'loose'
  id: string
  noteId: string
  x: number
  y: number
}
export interface LayoutHeader {
  kind: 'header'
  id: string
  sectionId: string
  label: string
  x: number
  y: number
}
export interface LayoutEdge {
  id: string
  source: string
  target: string
}

export interface CanvasLayout {
  mode: 'free' | 'tree'
  groups: LayoutGroup[]
  loose: LayoutLoose[]
  headers: LayoutHeader[]
  edges: LayoutEdge[]
}

export function estimateGroupHeight(g: GroupNode, expanded: boolean): number {
  return expanded ? 64 + Math.max(1, g.noteIds.length) * 122 : 112
}

export function freeLayout(state: DomainState): CanvasLayout {
  const canvas = state.canvas.canvases[0]
  const collapsed = new Set(canvas.collapsed)
  const groups: LayoutGroup[] = []
  let maxBottom = 0
  allGroups(state.structure).forEach((gl, i) => {
    const pos = canvas.groups[gl.group.id] ?? { x: 80 + (i % 3) * 380, y: 80 + Math.floor(i / 3) * 460 }
    const parent = gl.parent
    const crumb = parent.type === 'section' ? sectionBreadcrumb(state.structure, parent.id) : 'Unassigned · 章節未配置'
    const expanded = !collapsed.has(gl.group.id)
    groups.push({ kind: 'group', id: `g:${gl.group.id}`, group: gl.group, x: pos.x, y: pos.y, crumb, expanded })
    maxBottom = Math.max(maxBottom, pos.y + estimateGroupHeight(gl.group, expanded))
  })
  const grouped = groupedNoteIds(state.structure)
  const loose: LayoutLoose[] = []
  Object.values(state.notes)
    .filter((n) => !n.archived && !grouped.has(n.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .forEach((n, i) => {
      const pos = canvas.looseNotes[n.id] ?? { x: 80 + (i % 5) * 262, y: maxBottom + 60 + Math.floor(i / 5) * 200 }
      loose.push({ kind: 'loose', id: `n:${n.id}`, noteId: n.id, x: pos.x, y: pos.y })
    })
  return { mode: 'free', groups, loose, headers: [], edges: [] }
}

/** Auto tree of a section and its descendants: one row per section, its groups laid out to the right. */
export function treeLayout(state: DomainState, sectionId: string): CanvasLayout {
  const loc = findSection(state.structure, sectionId)
  const out: CanvasLayout = { mode: 'tree', groups: [], loose: [], headers: [], edges: [] }
  if (!loc) return out
  const labels = computeNumbering(state.structure).label
  const collapsed = new Set(state.canvas.canvases[0].collapsed)
  let y = 40
  const rec = (s: SectionNode, depth: number, parentHeader: string | null) => {
    const hid = `h:${s.id}`
    const x = 40 + depth * 56
    out.headers.push({ kind: 'header', id: hid, sectionId: s.id, label: labels.get(s.id) ?? s.title, x, y })
    if (parentHeader) out.edges.push({ id: `e:${parentHeader}-${hid}`, source: parentHeader, target: hid })
    const groups = s.children.filter((c): c is GroupNode => c.kind === 'group')
    let rowHeight = 60
    groups.forEach((g, j) => {
      const expanded = !collapsed.has(g.id)
      const gid = `g:${g.id}`
      out.groups.push({ kind: 'group', id: gid, group: g, x: x + 40 + j * (GROUP_WIDTH + 36), y: y + 74, crumb: sectionBreadcrumb(state.structure, s.id), expanded })
      out.edges.push({ id: `e:${hid}-${gid}`, source: hid, target: gid })
      rowHeight = Math.max(rowHeight, 74 + estimateGroupHeight(g, expanded))
    })
    y += rowHeight + 48
    for (const c of s.children) if (c.kind === 'section') rec(c, depth + 1, hid)
  }
  rec(loc.section, 0, null)
  return out
}
