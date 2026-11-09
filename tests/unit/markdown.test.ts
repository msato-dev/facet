import { describe, expect, it } from 'vitest'
import { applyCommand } from '../../src/shared/domain/commands'
import { separatorBetween, joinFragments } from '../../src/shared/markdown/join'
import {
  generateManuscript,
  manuscriptToMarkdown,
  prepareNoteBody,
  stripHeadings,
} from '../../src/shared/markdown/manuscript'
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
    const r = applyCommand(
      state,
      { type: 'note.rename', id: ids.n4, title: 'Mush remobilization' },
      testContext(),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.notes[ids.n3].body).toContain('[[Mush remobilization]]')
    expect(r.info.updatedLinks).toBe(1)
    expect(linkInfo(r.state.notes, ids.n4).backlinks).toEqual([ids.n3])
    expect(brokenLinks(r.state.notes)).toEqual([])
    const broken = run(r.state, [
      { type: 'note.updateBody', id: ids.n6, body: 'See [[Nowhere]]', baseRev: null },
    ]).state
    expect(brokenLinks(broken.notes)).toEqual([{ noteId: ids.n6, target: 'Nowhere' }])
  })
})

describe('joining rules', () => {
  it('joins English with spaces and Japanese without', () => {
    expect(separatorBetween('Hello.', 'World')).toBe(' ')
    expect(separatorBetween('日本語の文', 'です')).toBe('')
    expect(separatorBetween('文です。', 'Next')).toBe('')
    expect(joinFragments(['マグマ溜まりの', '再活性化を示す。', 'This is it.'])).toBe(
      'マグマ溜まりの再活性化を示す。This is it.',
    )
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
    const moved = run(state, [
      { type: 'note.move', id: ids.n8, target: { kind: 'note', id: ids.n6, position: 'before' } },
    ]).state
    const md = manuscriptToMarkdown(generateManuscript(moved))
    expect(md.indexOf('Previous work')).toBeLessThan(md.indexOf('Constraining'))
  })
})

describe('manuscript headings (DAT-03, ADR-033)', () => {
  it('drops ATX headings H1–H6 and keeps the text under them', () => {
    for (let d = 1; d <= 6; d++) {
      expect(prepareNoteBody(`${'#'.repeat(d)} Heading\nBody text.`)).toEqual({
        kind: 'inline',
        text: 'Body text.',
      })
    }
    expect(prepareNoteBody('## Closed ##\n\nBody.')).toEqual({ kind: 'inline', text: 'Body.' })
    expect(prepareNoteBody('#\nBody.')).toEqual({ kind: 'inline', text: 'Body.' })
  })

  it('drops Setext headings', () => {
    expect(prepareNoteBody('Title\n=====\n\nBody.')).toEqual({ kind: 'inline', text: 'Body.' })
    expect(prepareNoteBody('Sub\n---\nBody.')).toEqual({ kind: 'inline', text: 'Body.' })
  })

  it('treats a heading-only note as empty', () => {
    expect(prepareNoteBody('# Only a heading\n\n## Another')).toEqual({ kind: 'empty' })
  })

  it('keeps paragraphs around a removed heading separate, without a heading warning', () => {
    expect(stripHeadings('Intro.\n## Details\nMore.')).toBe('Intro.\n\nMore.')
    expect(stripHeadings('Intro.\n\n## Details\n\nMore.')).toBe('Intro.\n\nMore.')
    const p = prepareNoteBody('Intro.\n\n## Details\n\nMore.')
    expect(p.kind).toBe('complex')
    if (p.kind === 'complex') {
      expect(p.reasons).toEqual(['複数段落'])
      expect(p.markdown).toBe('Intro.\n\nMore.')
    }
  })

  it('never touches # inside code, math, HTML, escapes or hashtags', () => {
    const md = [
      'Text.',
      '',
      '```',
      '# not a heading',
      '```',
      '',
      '~~~python',
      '## comment',
      '~~~',
      '',
      '    # indented code',
      '',
      '$$',
      '# x = 1',
      '$$',
      '',
      '<h2>html heading</h2>',
      '',
      '\\# escaped and #tag and `# inline`',
    ].join('\n')
    expect(stripHeadings(md)).toBe(md)
  })

  it('removes headings inside block quotes and keeps list structure', () => {
    expect(stripHeadings('> ## Quoted\n> body')).toBe('> body')
    expect(stripHeadings('- ## Item heading\n- plain')).toBe('- Item heading\n- plain')
    expect(stripHeadings('1. # One #\n2. two')).toBe('1. One\n2. two')
  })

  it('handles CRLF bodies and leaves the original string unchanged', () => {
    const body = '## Heading\r\nBody with [[Link]].\r\n'
    const copy = body.slice()
    expect(prepareNoteBody(body)).toEqual({ kind: 'inline', text: 'Body with Link.' })
    expect(body).toBe(copy)
  })

  it('joins a note with a heading into its paragraph in the manuscript', () => {
    const { state, ids } = sampleWorkspace()
    const st = run(state, [
      {
        type: 'note.updateBody',
        id: ids.n3,
        body: '## Aside\nConstraining the timescales matters.',
        baseRev: null,
      },
    ]).state
    const m = generateManuscript(st)
    const md = manuscriptToMarkdown(m)
    expect(md).not.toContain('Aside')
    expect(md).toContain('Constraining the timescales matters.')
    expect(m.warnings).toEqual([])
  })
})
