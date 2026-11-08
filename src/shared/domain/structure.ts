// Immutable queries and updates on the manuscript structure (SPEC §8.2).
import type { GroupId, GroupNode, NoteId, SectionId, SectionNode, Structure } from './types'

export function emptyStructure(): Structure {
  return { schemaVersion: 1, root: { children: [] }, unplacedGroups: [] }
}

export type ParentRef = { type: 'root' } | { type: 'section'; id: SectionId } | { type: 'unplaced' }

export interface SectionLocation {
  section: SectionNode
  parent: ParentRef
  index: number
  depth: number
  path: SectionNode[]
}

export interface GroupLocation {
  group: GroupNode
  parent: ParentRef
  index: number
  /** Section chain from the chapter down to the direct parent; empty when unplaced. */
  path: SectionNode[]
}

export function walkSections(
  s: Structure,
  visit: (section: SectionNode, depth: number, path: SectionNode[]) => void,
): void {
  const rec = (nodes: Array<SectionNode | GroupNode>, depth: number, path: SectionNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'section') {
        const p = [...path, n]
        visit(n, depth, p)
        rec(n.children, depth + 1, p)
      }
    }
  }
  rec(s.root.children, 1, [])
}

export function allSections(s: Structure): SectionNode[] {
  const out: SectionNode[] = []
  walkSections(s, (sec) => out.push(sec))
  return out
}

export function findSection(s: Structure, id: SectionId): SectionLocation | null {
  let found: SectionLocation | null = null
  const rec = (nodes: Array<SectionNode | GroupNode>, parent: ParentRef, depth: number, path: SectionNode[]) => {
    nodes.forEach((n, index) => {
      if (found || n.kind !== 'section') return
      const p = [...path, n]
      if (n.id === id) found = { section: n, parent, index, depth, path: p }
      else rec(n.children, { type: 'section', id: n.id }, depth + 1, p)
    })
  }
  rec(s.root.children, { type: 'root' }, 1, [])
  return found
}

/** All groups in manuscript order followed by unplaced groups. */
export function allGroups(s: Structure): GroupLocation[] {
  const out: GroupLocation[] = []
  const rec = (nodes: Array<SectionNode | GroupNode>, parent: ParentRef, path: SectionNode[]) => {
    nodes.forEach((n, index) => {
      if (n.kind === 'group') out.push({ group: n, parent, index, path })
      else rec(n.children, { type: 'section', id: n.id }, [...path, n])
    })
  }
  rec(s.root.children, { type: 'root' }, [])
  s.unplacedGroups.forEach((g, index) => out.push({ group: g, parent: { type: 'unplaced' }, index, path: [] }))
  return out
}

export function findGroup(s: Structure, id: GroupId): GroupLocation | null {
  return allGroups(s).find((g) => g.group.id === id) ?? null
}

export interface NoteLocation {
  group: GroupNode
  index: number
  groupLocation: GroupLocation
}

export function findNoteLocation(s: Structure, noteId: NoteId): NoteLocation | null {
  for (const gl of allGroups(s)) {
    const index = gl.group.noteIds.indexOf(noteId)
    if (index >= 0) return { group: gl.group, index, groupLocation: gl }
  }
  return null
}

/** Note ids that appear in any group (placed or unplaced groups). */
export function groupedNoteIds(s: Structure): Set<NoteId> {
  const ids = new Set<NoteId>()
  for (const gl of allGroups(s)) for (const id of gl.group.noteIds) ids.add(id)
  return ids
}

/** Note ids that will appear in the manuscript (inside groups that live in sections). */
export function manuscriptNoteIds(s: Structure): Set<NoteId> {
  const ids = new Set<NoteId>()
  for (const gl of allGroups(s)) if (gl.parent.type !== 'unplaced') for (const id of gl.group.noteIds) ids.add(id)
  return ids
}

/** Section id plus every descendant section id. */
export function sectionSubtreeIds(s: Structure, id: SectionId): Set<SectionId> {
  const loc = findSection(s, id)
  const out = new Set<SectionId>()
  if (!loc) return out
  const rec = (sec: SectionNode) => {
    out.add(sec.id)
    for (const c of sec.children) if (c.kind === 'section') rec(c)
  }
  rec(loc.section)
  return out
}

export function isSectionDescendant(s: Structure, ancestorId: SectionId, candidateId: SectionId): boolean {
  return sectionSubtreeIds(s, ancestorId).has(candidateId)
}

// ---------------------------------------------------------------------------
// Immutable tree surgery helpers

type Child = SectionNode | GroupNode

function mapChildren(nodes: Child[], fn: (n: Child) => Child): Child[] {
  let changed = false
  const next = nodes.map((n) => {
    const m = fn(n)
    if (m !== n) changed = true
    return m
  })
  return changed ? next : nodes
}

/** Replace the children list of a parent. Returns a new Structure. */
export function updateChildren(s: Structure, parent: ParentRef, fn: (children: Child[]) => Child[]): Structure {
  if (parent.type === 'root') {
    const next = fn(s.root.children) as SectionNode[]
    return { ...s, root: { children: next } }
  }
  if (parent.type === 'unplaced') {
    return { ...s, unplacedGroups: fn(s.unplacedGroups) as GroupNode[] }
  }
  const rec = (nodes: Child[]): Child[] =>
    mapChildren(nodes, (n) => {
      if (n.kind !== 'section') return n
      if (n.id === parent.id) return { ...n, children: fn(n.children) }
      const children = rec(n.children)
      return children === n.children ? n : { ...n, children }
    })
  return { ...s, root: { children: rec(s.root.children) as SectionNode[] } }
}

export function childrenOf(s: Structure, parent: ParentRef): Child[] {
  if (parent.type === 'root') return s.root.children
  if (parent.type === 'unplaced') return s.unplacedGroups
  return findSection(s, parent.id)?.section.children ?? []
}

export function updateGroup(s: Structure, groupId: GroupId, fn: (g: GroupNode) => GroupNode): Structure {
  const loc = findGroup(s, groupId)
  if (!loc) return s
  return updateChildren(s, loc.parent, (children) => children.map((c) => (c.kind === 'group' && c.id === groupId ? fn(c) : c)))
}

export function updateSection(s: Structure, sectionId: SectionId, fn: (sec: SectionNode) => SectionNode): Structure {
  const loc = findSection(s, sectionId)
  if (!loc) return s
  return updateChildren(s, loc.parent, (children) =>
    children.map((c) => (c.kind === 'section' && c.id === sectionId ? fn(c) : c)),
  )
}

/** Remove a node (section or group) from wherever it is. Returns [structure, removedNode]. */
export function detachNode(s: Structure, kind: 'section' | 'group', id: string): [Structure, Child | null] {
  const parent = kind === 'section' ? findSection(s, id)?.parent : findGroup(s, id)?.parent
  if (!parent) return [s, null]
  let removed: Child | null = null
  const next = updateChildren(s, parent, (children) =>
    children.filter((c) => {
      if (c.kind === kind && c.id === id) {
        removed = c
        return false
      }
      return true
    }),
  )
  return [next, removed]
}

export function insertNode(s: Structure, parent: ParentRef, index: number, node: Child): Structure {
  return updateChildren(s, parent, (children) => {
    const next = [...children]
    const i = Math.max(0, Math.min(index, next.length))
    next.splice(i, 0, node)
    return next
  })
}

/** Remove a note from whichever group holds it. */
export function removeNoteFromGroups(s: Structure, noteId: NoteId): Structure {
  const loc = findNoteLocation(s, noteId)
  if (!loc) return s
  return updateGroup(s, loc.group.id, (g) => ({ ...g, noteIds: g.noteIds.filter((id) => id !== noteId) }))
}

export function insertNoteInGroup(s: Structure, groupId: GroupId, index: number, noteId: NoteId): Structure {
  return updateGroup(s, groupId, (g) => {
    const ids = g.noteIds.filter((id) => id !== noteId)
    const i = Math.max(0, Math.min(index, ids.length))
    ids.splice(i, 0, noteId)
    return { ...g, noteIds: ids }
  })
}
