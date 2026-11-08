import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { applyCommand, type Command, type DropTarget } from '../../src/shared/domain/commands'
import { checkInvariants } from '../../src/shared/domain/invariants'
import { computeNumbering, sectionBreadcrumb } from '../../src/shared/domain/numbering'
import { allGroups, allSections, findNoteLocation, groupedNoteIds, manuscriptNoteIds } from '../../src/shared/domain/structure'
import { titleKey, validateTitle } from '../../src/shared/domain/titles'
import { emptyState, run, sampleWorkspace, testContext } from '../fixtures/builders'

describe('titles (DAT-01)', () => {
  it('rejects duplicate titles within a workspace, case-insensitively and NFC-normalized', () => {
    const { state } = run(emptyState(), [{ type: 'note.create', title: 'Reverse zoning' }])
    const r = applyCommand(state, { type: 'note.create', title: '  reverse ZONING ' }, testContext())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('title')
    expect(titleKey('Café')).toBe(titleKey('Café'))
  })

  it('allows the same title in a different workspace (independent state)', () => {
    const a = run(emptyState(), [{ type: 'note.create', title: 'Recharge frequency' }])
    const b = run(emptyState(), [{ type: 'note.create', title: 'Recharge frequency' }])
    expect(Object.keys(a.state.notes)).toHaveLength(1)
    expect(Object.keys(b.state.notes)).toHaveLength(1)
  })

  it('rejects rename to an existing title but allows renaming to itself with different case', () => {
    const { state, ids } = run(emptyState(), [
      { type: 'note.create', title: 'A' },
      { type: 'note.create', title: 'B' },
    ])
    expect(applyCommand(state, { type: 'note.rename', id: ids[1], title: 'a' }, testContext()).ok).toBe(false)
    expect(applyCommand(state, { type: 'note.rename', id: ids[0], title: 'a' }, testContext()).ok).toBe(true)
  })

  it('rejects empty titles and WikiLink syntax characters', () => {
    expect(validateTitle({}, '   ')).toBe('empty')
    expect(validateTitle({}, 'a [[b]]')).toBe('invalid-chars')
    expect(validateTitle({}, 'a|b')).toBe('invalid-chars')
    expect(validateTitle({}, 'line\nbreak')).toBe('invalid-chars')
  })
})

describe('numbering', () => {
  it('numbers sections dynamically from tree order, including single sections', () => {
    const { state, ids } = sampleWorkspace()
    const n = computeNumbering(state.structure)
    expect(n.label.get(ids.intro)).toBe('1. Introduction')
    expect(n.label.get(ids.background)).toBe('1.1. Background')
    expect(n.label.get(ids.recharge)).toBe('3.1. Magma recharge')
    expect(sectionBreadcrumb(state.structure, ids.recharge)).toBe('3. Discussion › 3.1. Magma recharge')
    // Reorder: move Discussion before Introduction → numbers follow.
    const moved = run(state, [{ type: 'section.move', id: ids.discussion, target: { kind: 'section', id: ids.intro, position: 'before' } }]).state
    const m = computeNumbering(moved.structure)
    expect(m.label.get(ids.discussion)).toBe('1. Discussion')
    expect(m.label.get(ids.intro)).toBe('2. Introduction')
    // Titles never contain numbers.
    expect(allSections(moved.structure).every((s) => !/^\d/.test(s.title))).toBe(true)
  })

  it('supports three levels', () => {
    const { state, ids } = sampleWorkspace()
    const r = run(state, [{ type: 'section.create', title: 'Detail', parentId: ids.recharge }])
    expect(computeNumbering(r.state.structure).label.get(r.ids[0])).toBe('3.1.1. Detail')
  })
})

describe('moves (UI-09, DAT-04)', () => {
  it('moves a note from paragraph A to B without duplicating it', () => {
    const { state, ids } = sampleWorkspace()
    const r = run(state, [{ type: 'note.move', id: ids.n6, target: { kind: 'group', id: ids.p5, position: 'inside' } }])
    const all = allGroups(r.state.structure).flatMap((g) => g.group.noteIds)
    expect(all.filter((x) => x === ids.n6)).toHaveLength(1)
    expect(findNoteLocation(r.state.structure, ids.n6)?.group.id).toBe(ids.p5)
  })

  it('reorders notes within a paragraph before/after', () => {
    const { state, ids } = sampleWorkspace()
    const r = run(state, [{ type: 'note.move', id: ids.n4, target: { kind: 'note', id: ids.n3, position: 'before' } }])
    expect(findNoteLocation(r.state.structure, ids.n3)?.group.noteIds).toEqual([ids.n4, ids.n3])
  })

  it('places an unassigned note and unplaces it again', () => {
    const { state, ids } = sampleWorkspace()
    const placed = run(state, [{ type: 'note.move', id: ids.n9, target: { kind: 'note', id: ids.n7, position: 'after' } }]).state
    expect(findNoteLocation(placed.structure, ids.n9)?.group.id).toBe(ids.p2)
    const back = run(placed, [{ type: 'note.move', id: ids.n9, target: { kind: 'unassigned' } }]).state
    expect(findNoteLocation(back.structure, ids.n9)).toBeNull()
    expect(manuscriptNoteIds(back.structure).has(ids.n9)).toBe(false)
  })

  it('moves a subsection to another parent section, with descendants', () => {
    const { state, ids } = sampleWorkspace()
    const r = run(state, [{ type: 'section.move', id: ids.background, target: { kind: 'section', id: ids.methods, position: 'inside' } }])
    expect(computeNumbering(r.state.structure).label.get(ids.background)).toBe('2.1. Background')
    expect(findNoteLocation(r.state.structure, ids.n6)?.groupLocation.path.map((s) => s.id)).toEqual([ids.methods, ids.background])
  })

  it('refuses to move a section into its own descendant (cycle)', () => {
    const { state, ids } = sampleWorkspace()
    const r = applyCommand(state, { type: 'section.move', id: ids.discussion, target: { kind: 'section', id: ids.recharge, position: 'inside' } }, testContext())
    expect(r.ok).toBe(false)
    const self = applyCommand(state, { type: 'section.move', id: ids.discussion, target: { kind: 'section', id: ids.discussion, position: 'inside' } }, testContext())
    expect(self.ok).toBe(false)
  })

  it('moves a paragraph group to another section with its notes', () => {
    const { state, ids } = sampleWorkspace()
    const r = run(state, [{ type: 'group.move', id: ids.p1, target: { kind: 'section', id: ids.discussion, position: 'inside' } }])
    const loc = findNoteLocation(r.state.structure, ids.n8)!
    expect(loc.group.id).toBe(ids.p1)
    expect(loc.groupLocation.path.map((s) => s.id)).toEqual([ids.discussion])
  })

  it('refuses groups at the document root', () => {
    const { state, ids } = sampleWorkspace()
    const r = applyCommand(state, { type: 'group.move', id: ids.p1, target: { kind: 'section', id: ids.intro, position: 'before' } }, testContext())
    expect(r.ok).toBe(false)
  })

  it('deleting a section keeps its notes and lifts children', () => {
    const { state, ids } = sampleWorkspace()
    const r = run(state, [{ type: 'section.delete', id: ids.discussion }]).state
    expect(allSections(r.structure).map((s) => s.title)).toEqual(['Introduction', 'Background', 'Methods', 'Magma recharge'])
    expect(Object.keys(r.notes)).toHaveLength(6)
    const r2 = run(state, [{ type: 'section.delete', id: ids.methods }]).state
    expect(r2.structure.unplacedGroups.map((g) => g.id)).toEqual([ids.p2])
  })
})

describe('archive / trash', () => {
  it('archiving a placed note removes it from the structure and can restore placement', () => {
    const { state, ids } = sampleWorkspace()
    const a = run(state, [{ type: 'note.archive', ids: [ids.n3] }]).state
    expect(groupedNoteIds(a.structure).has(ids.n3)).toBe(false)
    expect(a.notes[ids.n3].lastPlacement).toEqual({ groupId: ids.p5, index: 0 })
    const u = run(a, [{ type: 'note.unarchive', ids: [ids.n3], restorePlacement: true }]).state
    expect(findNoteLocation(u.structure, ids.n3)?.group.noteIds).toEqual([ids.n3, ids.n4])
  })

  it('trash removes the note everywhere', () => {
    const { state, ids } = sampleWorkspace()
    const t = run(state, [{ type: 'note.trash', ids: [ids.n4] }]).state
    expect(t.notes[ids.n4]).toBeUndefined()
    expect(groupedNoteIds(t.structure).has(ids.n4)).toBe(false)
  })
})

describe('conflicts', () => {
  it('rejects body updates based on a stale revision', () => {
    const { state, ids } = sampleWorkspace()
    const rev = state.notes[ids.n3].rev
    const ok = applyCommand(state, { type: 'note.updateBody', id: ids.n3, body: 'x', baseRev: rev }, testContext())
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    const stale = applyCommand(ok.state, { type: 'note.updateBody', id: ids.n3, body: 'y', baseRev: rev }, testContext())
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error.code).toBe('conflict')
  })
})

describe('property: random operation sequences keep invariants', () => {
  it('never produces cycles, duplicate placements or dangling ids', () => {
    const { state: base, ids } = sampleWorkspace()
    const noteIds = [ids.n3, ids.n4, ids.n6, ids.n7, ids.n8, ids.n9]
    const groupIds = [ids.p1, ids.p2, ids.p5]
    const sectionIds = [ids.intro, ids.background, ids.methods, ids.discussion, ids.recharge]
    const pos = fc.constantFrom('before', 'after', 'inside') as fc.Arbitrary<'before' | 'after' | 'inside'>
    const target: fc.Arbitrary<DropTarget> = fc.oneof(
      fc.record({ kind: fc.constant('section' as const), id: fc.constantFrom(...sectionIds), position: pos }),
      fc.record({ kind: fc.constant('group' as const), id: fc.constantFrom(...groupIds), position: pos }),
      fc.record({ kind: fc.constant('note' as const), id: fc.constantFrom(...noteIds), position: pos }),
      fc.constant({ kind: 'unassigned' as const }),
      fc.constant({ kind: 'root' as const }),
    )
    const cmd: fc.Arbitrary<Command> = fc.oneof(
      fc.record({ type: fc.constant('note.move' as const), id: fc.constantFrom(...noteIds), target }),
      fc.record({ type: fc.constant('group.move' as const), id: fc.constantFrom(...groupIds), target }),
      fc.record({ type: fc.constant('section.move' as const), id: fc.constantFrom(...sectionIds), target }),
      fc.record({ type: fc.constant('note.archive' as const), ids: fc.constantFrom(...noteIds).map((x) => [x]) }),
      fc.record({ type: fc.constant('note.unarchive' as const), ids: fc.constantFrom(...noteIds).map((x) => [x]), restorePlacement: fc.boolean() }),
    )
    fc.assert(
      fc.property(fc.array(cmd, { maxLength: 40 }), (cmds) => {
        let st = base
        const ctx = testContext()
        for (const c of cmds) {
          const r = applyCommand(st, c, ctx)
          if (r.ok) st = r.state
        }
        expect(checkInvariants(st)).toEqual([])
        expect(allSections(st.structure)).toHaveLength(5)
        expect(Object.keys(st.notes)).toHaveLength(6)
        const placed = allGroups(st.structure).flatMap((g) => g.group.noteIds)
        expect(new Set(placed).size).toBe(placed.length)
      }),
      { numRuns: 300 },
    )
  })
})
