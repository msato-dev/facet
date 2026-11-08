import type { CanvasData, CanvasState, DomainState, GroupId, NoteId, Point } from './types'

export function defaultCanvasState(): CanvasState {
  return {
    schemaVersion: 1,
    canvases: [
      { id: 'main', name: 'Main Canvas', viewport: null, groups: {}, collapsed: [], looseNotes: {} },
    ],
  }
}

export function mainCanvas(state: DomainState): CanvasData {
  return state.canvas.canvases[0]
}

export function updateMainCanvas(state: DomainState, fn: (c: CanvasData) => CanvasData): DomainState {
  const [first, ...rest] = state.canvas.canvases
  const next = fn(first)
  if (next === first) return state
  return { ...state, canvas: { ...state.canvas, canvases: [next, ...rest] } }
}

export function setGroupPos(state: DomainState, id: GroupId, pos: Point): DomainState {
  return updateMainCanvas(state, (c) => {
    return { ...c, groups: { ...c.groups, [id]: { x: pos.x, y: pos.y } } }
  })
}

export function setNotePos(state: DomainState, id: NoteId, pos: Point): DomainState {
  return updateMainCanvas(state, (c) => ({
    ...c,
    looseNotes: { ...c.looseNotes, [id]: { x: pos.x, y: pos.y } },
  }))
}

/** Remove canvas entries that point at nodes which no longer exist. */
export function pruneCanvas(state: DomainState, groupIds: Set<GroupId>): DomainState {
  return updateMainCanvas(state, (c) => {
    let changed = false
    const groups: CanvasData['groups'] = {}
    for (const [k, v] of Object.entries(c.groups)) {
      if (groupIds.has(k)) groups[k] = v
      else changed = true
    }
    const looseNotes: CanvasData['looseNotes'] = {}
    for (const [k, v] of Object.entries(c.looseNotes)) {
      if (state.notes[k]) looseNotes[k] = v
      else changed = true
    }
    const collapsed = c.collapsed.filter((id) => groupIds.has(id))
    if (collapsed.length !== c.collapsed.length) changed = true
    return changed ? { ...c, groups, collapsed, looseNotes } : c
  })
}
