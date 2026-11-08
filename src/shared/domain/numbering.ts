// Dynamic section numbering from tree order (SPEC §2.3). Numbers are never stored in titles.
import { findSection, walkSections } from './structure'
import type { SectionId, Structure } from './types'

export interface SectionNumbering {
  /** e.g. "4.1." */
  number: Map<SectionId, string>
  /** e.g. "4.1. Magma recharge" */
  label: Map<SectionId, string>
  depth: Map<SectionId, number>
}

export function computeNumbering(s: Structure): SectionNumbering {
  const number = new Map<SectionId, string>()
  const label = new Map<SectionId, string>()
  const depth = new Map<SectionId, number>()
  const counters: number[] = []
  walkSections(s, (sec, d) => {
    counters.length = d
    counters[d - 1] = (counters[d - 1] ?? 0) + 1
    const num = counters.slice(0, d).join('.') + '.'
    number.set(sec.id, num)
    label.set(sec.id, `${num} ${sec.title}`)
    depth.set(sec.id, d)
  })
  return { number, label, depth }
}

/** Breadcrumb of numbered labels for a section ("4. Discussion › 4.1. Magma recharge"). */
export function sectionBreadcrumb(s: Structure, sectionId: SectionId, numbering = computeNumbering(s)): string {
  const loc = findSection(s, sectionId)
  if (!loc) return 'Unassigned'
  return loc.path.map((p) => numbering.label.get(p.id) ?? p.title).join(' › ')
}
