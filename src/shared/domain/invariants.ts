// Structural invariants checked after every command (SPEC §4, §8.2; DAT-04).
import type { DomainState, GroupNode, SectionNode } from './types'

export interface InvariantViolation {
  code: 'duplicate-id' | 'duplicate-placement' | 'unknown-note' | 'archived-placed' | 'group-at-root' | 'bad-kind'
  message: string
}

export function checkInvariants(state: DomainState): InvariantViolation[] {
  const out: InvariantViolation[] = []
  const seenNodeIds = new Set<string>()
  const placed = new Map<string, string>()

  const visitGroup = (g: GroupNode) => {
    if (g.kind !== 'group') out.push({ code: 'bad-kind', message: `Expected group: ${g.id}` })
    if (seenNodeIds.has(g.id)) out.push({ code: 'duplicate-id', message: `Duplicate node id ${g.id}` })
    seenNodeIds.add(g.id)
    for (const nid of g.noteIds) {
      const prev = placed.get(nid)
      if (prev) out.push({ code: 'duplicate-placement', message: `Note ${nid} placed in ${prev} and ${g.id}` })
      placed.set(nid, g.id)
      const note = state.notes[nid]
      if (!note) out.push({ code: 'unknown-note', message: `Group ${g.id} references missing note ${nid}` })
      else if (note.archived) out.push({ code: 'archived-placed', message: `Archived note ${nid} is placed` })
    }
  }
  // A real tree cannot contain cycles; repeated ids are what a cycle would look like after serialization.
  const visitSection = (s: SectionNode) => {
    if (s.kind !== 'section') out.push({ code: 'bad-kind', message: `Expected section: ${(s as { id: string }).id}` })
    if (seenNodeIds.has(s.id)) out.push({ code: 'duplicate-id', message: `Duplicate node id ${s.id}` })
    seenNodeIds.add(s.id)
    for (const c of s.children) {
      if (c.kind === 'section') visitSection(c)
      else if (c.kind === 'group') visitGroup(c)
      else out.push({ code: 'bad-kind', message: 'Unknown child kind' })
    }
  }
  for (const c of state.structure.root.children) {
    if ((c as { kind: string }).kind === 'group') {
      out.push({ code: 'group-at-root', message: `Group ${c.id} cannot be a direct child of the document` })
      visitGroup(c as unknown as GroupNode)
    } else visitSection(c)
  }
  for (const g of state.structure.unplacedGroups) visitGroup(g)
  return out
}
