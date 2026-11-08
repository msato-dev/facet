import { defaultCanvasState } from '../../src/shared/domain/canvas'
import { applyCommand, type Command, type CommandContext } from '../../src/shared/domain/commands'
import { emptyStructure } from '../../src/shared/domain/structure'
import type { DomainState } from '../../src/shared/domain/types'

// Module-level counter keeps ids unique even when several contexts touch the same state.
let n = 0

export function testContext(): CommandContext {
  let t = Date.UTC(2026, 0, 1)
  return {
    newId: () => `id${String(++n).padStart(24, '0')}`,
    now: () => new Date((t += 1000)).toISOString(),
  }
}

export function emptyState(): DomainState {
  return { notes: {}, structure: emptyStructure(), canvas: defaultCanvasState() }
}

/** Apply commands, throwing on failure; returns the final state and created ids in order. */
export function run(
  state: DomainState,
  cmds: Command[],
  ctx = testContext(),
): { state: DomainState; ids: string[] } {
  const ids: string[] = []
  let st = state
  for (const c of cmds) {
    const r = applyCommand(st, c, ctx)
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`)
    st = r.state
    if (r.info.createdId) ids.push(r.info.createdId)
  }
  return { state: st, ids }
}

/**
 * Builds a small workspace resembling the mock's "Zao" paper:
 * 1. Introduction > 1.1 Background > [Research background: n6, n8]
 * 2. Methods > [Analytical methods: n7]
 * 3. Discussion > 3.1 Magma recharge > [Recharge interpretation: n3, n4]
 * plus an unassigned note "Unplaced insight".
 */
export function sampleWorkspace() {
  const ctx = testContext()
  let st = emptyState()
  const mk = (cmd: Command) => {
    const r = applyCommand(st, cmd, ctx)
    if (!r.ok) throw new Error(r.error.message)
    st = r.state
    return r.info.createdId!
  }
  const intro = mk({ type: 'section.create', title: 'Introduction', parentId: null })
  const background = mk({ type: 'section.create', title: 'Background', parentId: intro })
  const methods = mk({ type: 'section.create', title: 'Methods', parentId: null })
  const discussion = mk({ type: 'section.create', title: 'Discussion', parentId: null })
  const recharge = mk({ type: 'section.create', title: 'Magma recharge', parentId: discussion })
  const n6 = mk({
    type: 'note.create',
    title: 'Research motivation',
    body: 'Constraining the timescales of pre-eruptive processes improves our understanding of volcanic unrest.',
  })
  const n8 = mk({
    type: 'note.create',
    title: 'Previous work',
    body: 'Previous work has established a link between zoning and recharge [@Tanaka2022].',
  })
  const n7 = mk({
    type: 'note.create',
    title: 'Analytical procedure',
    body: 'Zoning profiles were examined using electron microprobe analyses.',
  })
  const n3 = mk({
    type: 'note.create',
    title: 'Recharge frequency',
    body: 'This pattern may indicate an increasing frequency of magma recharge. See also [[Mush reactivation]].',
  })
  const n4 = mk({
    type: 'note.create',
    title: 'Mush reactivation',
    body: 'Repeated thermal inputs can reactivate a crystal-rich mush [@Smith2024].',
  })
  const n9 = mk({
    type: 'note.create',
    title: 'Unplaced insight',
    body: 'A possible alternative interpretation to revisit before writing.',
  })
  const p1 = mk({
    type: 'group.create',
    title: 'Research background',
    sectionId: background,
    noteIds: [n6, n8],
  })
  const p2 = mk({ type: 'group.create', title: 'Analytical methods', sectionId: methods, noteIds: [n7] })
  const p5 = mk({
    type: 'group.create',
    title: 'Recharge interpretation',
    sectionId: recharge,
    noteIds: [n3, n4],
  })
  return {
    state: st,
    ctx,
    ids: { intro, background, methods, discussion, recharge, n3, n4, n6, n7, n8, n9, p1, p2, p5 },
  }
}
