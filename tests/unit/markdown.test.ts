import { describe, expect, it } from 'vitest'
import { applyCommand } from '../../src/shared/domain/commands'
import { separatorBetween, joinFragments } from '../../src/shared/markdown/join'
import { generateManuscript, manuscriptToMarkdown, prepareNoteBody } from '../../src/shared/markdown/manuscript'
import { brokenLinks, findWikiLinks, linkInfo, renameWikiLinks } from '../../src/shared/markdown/wikilink'
import { run, sampleWorkspace, testContext } from '../fixtures/builders'

describe('WikiLinks (DAT-02)', () => {
  it('finds links outside code, math and escapes', () => {
    const md = [
      'See [[Alpha]] and [[Beta|the beta]].',
      'Inline `[[NotALink]]` and escaped \\[[Nope]].',
      '```',
      '[[InFence]]',
      '```',
      '$$',
      '[[InMath]]',
      '$$',
    ].join('\n')
    expect(findWikiLinks(md).map((l) => [l.target, l.alias])).toEqual([
      ['Alpha', null],
      ['Beta', 'the beta'],
    ])
  })

  it('renames only real links, preserving aliases', () => {
    const md = 'A [[Old]] b [[old|alias]] `[[Old]]`\n```\n[[Old]]\n```'
    const r = renameWikiLinks(md, 'Old', 'New')
    expect(r.count).toBe(2)
    expect(r.text).toBe('A [[New]] b [[New|alias]] `[[Old]]`\n```\n[[Old]]\n```')
  })

  it('updates referring notes on rename and detects broken links', () => {
    const { state, ids } = sampleWorkspace()
    const r = applyCommand(state, { type: 'note.rename', id: ids.n4, title: 'Mush remobilization' }, testContext())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.notes[ids.n3].body).toContain('[[Mush remobilization]]')
    expect(r.info.updatedLinks).toBe(1)
    expect(linkInfo(r.state.notes, ids.n4).backlinks).toEqual([ids.n3])
    expect(brokenLinks(r.state.notes)).toEqual([])
    const broken = run(r.state, [{ type: 'note.updateBody', id: ids.n6, body: 'See [[Nowhere]]', baseRev: null }]).state
    expect(brokenLinks(broken.notes)).toEqual([{ noteId: ids.n6, target: 'Nowhere' }])
  })
})

describe('joining rules', () => {
  it('joins English with spaces and Japanese without', () => {
    expect(separatorBetween('Hello.', 'World')).toBe(' ')
    expect(separatorBetween('日本語の文', 'です')).toBe('')
    expect(separatorBetween('文です。', 'Next')).toBe('')
    expect(joinFragments(['マグマ溜まりの', '再活性化を示す。', 'This is it.'])).toBe('マグマ溜まりの再活性化を示す。This is it.')
  })
})

describe('manuscript (DAT-03)', () => {
  it('joins group notes into one paragraph, without H1 or group titles, keeping citations', () => {
    const { state } = sampleWorkspace()
    const md = manuscriptToMarkdown(generateManuscript(state))
    expect(md).toBe(
      [
        '# 1. Introduction',
        '## 1.1. Background',
        'Constraining the timescales of pre-eruptive processes improves our understanding of volcanic unrest. Previous work has established a link between zoning and recharge [@Tanaka2022].',
        '# 2. Methods',
        'Zoning profiles were examined using electron microprobe analyses.',
        '# 3. Discussion',
        '## 3.1. Magma recharge',
        'This pattern may indicate an increasing frequency of magma recharge. See also Mush reactivation. Repeated thermal inputs can reactivate a crystal-rich mush [@Smith2024].',
      ].join('\n\n') + '\n',
    )
    expect(md).not.toContain('Research background')
    expect(md).not.toContain('Unplaced insight')
  })

  it('removes WikiLink-only lines and skips empty notes', () => {
    expect(prepareNoteBody('Text here.\n[[Other]]\n')).toEqual({ kind: 'inline', text: 'Text here.' })
    expect(prepareNoteBody('[[Only]]')).toEqual({ kind: 'empty' })
    expect(prepareNoteBody('   ')).toEqual({ kind: 'empty' })
  })

  it('keeps complex notes intact and warns', () => {
    const p = prepareNoteBody('First paragraph.\n\nSecond paragraph.\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    expect(p.kind).toBe('complex')
    if (p.kind === 'complex') {
      expect(p.reasons).toContain('複数段落')
      expect(p.reasons).toContain('表')
      expect(p.markdown).toContain('| 1 | 2 |')
    }
  })

  it('does not convert WikiLinks inside code', () => {
    const p = prepareNoteBody('Use `[[x]]` literally and [[Y]].')
    expect(p).toEqual({ kind: 'inline', text: 'Use `[[x]]` literally and Y.' })
  })

  it('follows outline order changes', () => {
    const { state, ids } = sampleWorkspace()
    const moved = run(state, [{ type: 'note.move', id: ids.n8, target: { kind: 'note', id: ids.n6, position: 'before' } }]).state
    const md = manuscriptToMarkdown(generateManuscript(moved))
    expect(md.indexOf('Previous work')).toBeLessThan(md.indexOf('Constraining'))
  })
})
