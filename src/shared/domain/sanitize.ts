// Repair a structure loaded from disk so the invariants hold, reporting what was changed.
import type { DomainState, GroupNode, SectionNode, Structure, VaultIssue } from './types'

export function sanitizeStructure(state: DomainState): { structure: Structure; issues: VaultIssue[] } {
  const issues: VaultIssue[] = []
  const seenNodes = new Set<string>()
  const placed = new Set<string>()

  const cleanGroup = (g: GroupNode): GroupNode | null => {
    if (seenNodes.has(g.id)) {
      issues.push({
        kind: 'invalid-structure-ref',
        message: `重複したParagraph Group ID ${g.id} を除外しました`,
      })
      return null
    }
    seenNodes.add(g.id)
    const noteIds = g.noteIds.filter((id) => {
      const n = state.notes[id]
      if (!n) {
        issues.push({
          kind: 'invalid-structure-ref',
          message: `存在しないメモ ${id} への参照を Outline から外しました`,
          noteId: id,
        })
        return false
      }
      if (n.archived || placed.has(id)) {
        issues.push({
          kind: 'invalid-structure-ref',
          message: `メモ「${n.title}」の重複配置またはアーカイブ済み配置を解除しました`,
          noteId: id,
        })
        return false
      }
      placed.add(id)
      return true
    })
    return noteIds.length === g.noteIds.length ? g : { ...g, noteIds }
  }

  const cleanSection = (s: SectionNode): SectionNode | null => {
    if (seenNodes.has(s.id)) {
      issues.push({ kind: 'invalid-structure-ref', message: `重複した章節 ID ${s.id} を除外しました` })
      return null
    }
    seenNodes.add(s.id)
    const children: Array<SectionNode | GroupNode> = []
    for (const c of s.children) {
      const cleaned = c.kind === 'section' ? cleanSection(c) : cleanGroup(c)
      if (cleaned) children.push(cleaned)
    }
    return { ...s, children }
  }

  const root: SectionNode[] = []
  const unplaced: GroupNode[] = []
  for (const c of state.structure.root.children as Array<SectionNode | GroupNode>) {
    if (c.kind === 'group') {
      issues.push({
        kind: 'invalid-structure-ref',
        message: `章の外にあったParagraph Group「${c.title}」を未配置へ移しました`,
      })
      const g = cleanGroup(c)
      if (g) unplaced.push(g)
    } else {
      const s = cleanSection(c)
      if (s) root.push(s)
    }
  }
  for (const g of state.structure.unplacedGroups) {
    const cg = cleanGroup(g)
    if (cg) unplaced.push(cg)
  }
  return { structure: { schemaVersion: 1, root: { children: root }, unplacedGroups: unplaced }, issues }
}
