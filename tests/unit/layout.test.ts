import { describe, expect, it } from 'vitest'
import { estimateGroupHeight, treeLayout } from '../../src/renderer/canvas/layout'
import { run, sampleWorkspace } from '../fixtures/builders'

/** Discussion row with its own group, then the Magma recharge row below it. */
function twoRows() {
  const { state, ids } = sampleWorkspace()
  const r = run(state, [
    { type: 'group.create', title: 'Discussion lead', sectionId: ids.discussion, noteIds: [ids.n9] },
  ])
  return { state: r.state, ids, lead: r.ids[0] }
}

describe('canvas tree layout (ADR-036)', () => {
  it('uses estimated heights when nothing is measured', () => {
    const { state, ids, lead } = twoRows()
    const out = treeLayout(state, ids.discussion)
    const g = out.groups.find((x) => x.id === `g:${lead}`)!
    const next = out.headers.find((h) => h.sectionId === ids.recharge)!
    expect(next.y).toBe(g.y + estimateGroupHeight(g.group, true) + 48)
  })

  it('moves later rows below a taller measured group, so rows never overlap', () => {
    const { state, ids, lead } = twoRows()
    const before = treeLayout(state, ids.discussion)
    const tall = treeLayout(state, ids.discussion, new Map([[`g:${lead}`, 900]]))
    const g = tall.groups.find((x) => x.id === `g:${lead}`)!
    const next = tall.headers.find((h) => h.sectionId === ids.recharge)!
    const p5 = tall.groups.find((x) => x.id === `g:${ids.p5}`)!
    expect(next.y).toBeGreaterThanOrEqual(g.y + 900)
    expect(p5.y).toBeGreaterThan(g.y + 900)
    expect(next.y).toBeGreaterThan(before.headers.find((h) => h.sectionId === ids.recharge)!.y)
    // Positions of the rows above do not change.
    expect(g.y).toBe(before.groups.find((x) => x.id === `g:${lead}`)!.y)
  })
})
