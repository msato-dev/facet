import { describe, expect, it } from 'vitest'
import { applyCommand } from '../../src/shared/domain/commands'
import { UndoStack, applyPatch, diffState } from '../../src/shared/domain/history'
import { findNoteLocation } from '../../src/shared/domain/structure'
import { tokenize, matchesQuery } from '../../src/shared/search/tokenizer'
import { sampleWorkspace } from '../fixtures/builders'

describe('undo/redo', () => {
  it('undoes and redoes a structural move', () => {
    const { state, ctx, ids } = sampleWorkspace()
    const stack = new UndoStack()
    const r = applyCommand(state, { type: 'note.move', id: ids.n6, target: { kind: 'group', id: ids.p5, position: 'inside' } }, ctx)
    if (!r.ok) throw new Error()
    stack.record(state, r.state, 'move')
    const u = stack.undo(r.state)
    if (!u.ok) throw new Error(u.message)
    expect(findNoteLocation(u.state.structure, ids.n6)?.group.id).toBe(ids.p1)
    const re = stack.redo(u.state)
    if (!re.ok) throw new Error(re.message)
    expect(findNoteLocation(re.state.structure, ids.n6)?.group.id).toBe(ids.p5)
  })

  it('refuses to undo a rename when an affected note was edited afterwards', () => {
    const { state, ctx, ids } = sampleWorkspace()
    const stack = new UndoStack()
    const r = applyCommand(state, { type: 'note.rename', id: ids.n4, title: 'Renamed' }, ctx)
    if (!r.ok) throw new Error()
    stack.record(state, r.state, 'rename')
    const edit = applyCommand(r.state, { type: 'note.updateBody', id: ids.n3, body: 'changed', baseRev: null }, ctx)
    if (!edit.ok) throw new Error()
    expect(stack.undo(edit.state).ok).toBe(false)
    expect(edit.state.notes[ids.n3].body).toBe('changed')
  })

  it('restored notes get a higher revision than any previous one', () => {
    const { state, ctx, ids } = sampleWorkspace()
    const stack = new UndoStack()
    const r = applyCommand(state, { type: 'note.trash', ids: [ids.n9] }, ctx)
    if (!r.ok) throw new Error()
    stack.record(state, r.state, 'trash')
    const u = stack.undo(r.state)
    if (!u.ok) throw new Error()
    expect(u.state.notes[ids.n9].rev).toBeGreaterThan(state.notes[ids.n9].rev)
  })

  it('patches round-trip', () => {
    const { state, ctx, ids } = sampleWorkspace()
    const r = applyCommand(state, { type: 'note.trash', ids: [ids.n9] }, ctx)
    if (!r.ok) throw new Error()
    const patch = diffState(state, r.state)
    expect(patch.notes[ids.n9]).toBeNull()
    expect(applyPatch(state, patch)).toEqual(r.state)
  })
})

describe('search tokenizer', () => {
  it('splits Latin words and CJK bigrams', () => {
    expect(tokenize('Magma recharge マグマ溜まり')).toEqual(['magma', 'recharge', 'マグ', 'グマ', 'マ溜', '溜ま', 'まり'])
    expect(tokenize('Ｍａｇｍａ')).toEqual(['magma'])
  })
  it('matches substrings for in-workspace filtering', () => {
    expect(matchesQuery('結晶マッシュの再活性化', '再活性')).toBe(true)
    expect(matchesQuery('Mush reactivation', 'mush REACT')).toBe(true)
    expect(matchesQuery('Mush', 'x')).toBe(false)
  })
})
