// Manuscript generation from the structure (SPEC §8.3, DAT-03).
import { computeNumbering } from '../domain/numbering'
import type { DomainState, GroupId, GroupNode, NoteId, SectionId, SectionNode } from '../domain/types'
import { joinFragments, joinSoftLines } from './join'
import { parseMarkdown, protectedRanges } from './parse'
import { displayText, scanWikiLinks } from './wikilink'

export type ManuscriptBlock =
  | { type: 'heading'; depth: number; text: string; sectionId: SectionId }
  | { type: 'paragraph'; text: string; groupId: GroupId; noteIds: NoteId[] }
  | { type: 'raw'; markdown: string; groupId: GroupId; noteId: NoteId }

export interface ManuscriptWarning {
  noteId: NoteId
  groupId: GroupId
  noteTitle: string
  reasons: string[]
}

export interface Manuscript {
  blocks: ManuscriptBlock[]
  warnings: ManuscriptWarning[]
}

const WIKILINK_ONLY_LINE = /^\s*(?:\[\[[^[\]\n]+\]\]\s*)+$/

/** Replace `[[Title]]` / `[[Title|Alias]]` by plain text, outside code/math. */
export function wikiLinksToText(md: string): string {
  if (!md.includes('[[')) return md
  const links = scanWikiLinks(md, protectedRanges(md))
  let out = ''
  let last = 0
  for (const l of links) {
    out += md.slice(last, l.start) + displayText(l)
    last = l.end
  }
  return out + md.slice(last)
}

/** Drop lines that consist only of WikiLinks (outside code blocks). */
export function dropWikiLinkOnlyLines(md: string): string {
  if (!md.includes('[[')) return md
  const ranges = protectedRanges(md)
  const lines = md.split('\n')
  const kept: string[] = []
  let offset = 0
  for (const line of lines) {
    const start = offset
    const end = offset + line.length
    offset = end + 1
    const inProtected = ranges.some(([a, b]) => start < b && end > a)
    if (!inProtected && WIKILINK_ONLY_LINE.test(line) && scanWikiLinks(line, []).length > 0) continue
    kept.push(line)
  }
  return kept.join('\n')
}

const BLOCK_REASON: Record<string, string> = {
  table: '表',
  math: 'ブロック数式',
  code: 'コードブロック',
  list: 'リスト',
  heading: '見出し',
  blockquote: '引用ブロック',
  thematicBreak: '区切り線',
  html: 'HTML',
}

export type PreparedNote =
  | { kind: 'empty' }
  | { kind: 'inline'; text: string }
  | { kind: 'complex'; markdown: string; reasons: string[] }

const prepareCache = new Map<string, PreparedNote>()

/** Memoized: manuscript previews regenerate on every edit, but most note bodies are unchanged. */
export function prepareNoteBody(body: string): PreparedNote {
  const hit = prepareCache.get(body)
  if (hit) return hit
  const result = prepareNoteBodyUncached(body)
  if (prepareCache.size > 5000) prepareCache.clear()
  prepareCache.set(body, result)
  return result
}

function prepareNoteBodyUncached(body: string): PreparedNote {
  const cleaned = dropWikiLinkOnlyLines(body.replace(/\r\n?/g, '\n')).trim()
  if (!cleaned) return { kind: 'empty' }
  const tree = parseMarkdown(cleaned)
  const blocks = tree.children.filter((c) => c.type !== 'definition')
  if (blocks.length === 0) return { kind: 'empty' }
  const paragraphs = blocks.filter((b) => b.type === 'paragraph')
  if (blocks.length === 1 && paragraphs.length === 1) {
    return { kind: 'inline', text: joinSoftLines(wikiLinksToText(cleaned)) }
  }
  const reasons = new Set<string>()
  if (paragraphs.length > 1) reasons.add('複数段落')
  for (const b of blocks) if (b.type !== 'paragraph') reasons.add(BLOCK_REASON[b.type] ?? b.type)
  return { kind: 'complex', markdown: wikiLinksToText(cleaned), reasons: [...reasons] }
}

export function generateManuscript(state: DomainState): Manuscript {
  const numbering = computeNumbering(state.structure)
  const blocks: ManuscriptBlock[] = []
  const warnings: ManuscriptWarning[] = []

  const emitGroup = (g: GroupNode) => {
    let fragments: string[] = []
    let fragmentNotes: NoteId[] = []
    const flush = () => {
      const text = joinFragments(fragments)
      if (text) blocks.push({ type: 'paragraph', text, groupId: g.id, noteIds: fragmentNotes })
      fragments = []
      fragmentNotes = []
    }
    for (const nid of g.noteIds) {
      const note = state.notes[nid]
      if (!note || note.archived) continue
      const prepared = prepareNoteBody(note.body)
      if (prepared.kind === 'empty') continue
      if (prepared.kind === 'inline') {
        fragments.push(prepared.text)
        fragmentNotes.push(nid)
      } else {
        flush()
        blocks.push({ type: 'raw', markdown: prepared.markdown, groupId: g.id, noteId: nid })
        warnings.push({ noteId: nid, groupId: g.id, noteTitle: note.title, reasons: prepared.reasons })
      }
    }
    flush()
  }

  const emitSection = (s: SectionNode, depth: number) => {
    blocks.push({ type: 'heading', depth, text: numbering.label.get(s.id) ?? s.title, sectionId: s.id })
    for (const c of s.children) {
      if (c.kind === 'group') emitGroup(c)
      else emitSection(c, depth + 1)
    }
  }
  for (const s of state.structure.root.children) emitSection(s, 1)
  return { blocks, warnings }
}

export function manuscriptToMarkdown(m: Manuscript): string {
  const parts = m.blocks.map((b) => {
    if (b.type === 'heading') return `${'#'.repeat(Math.min(6, b.depth))} ${b.text}`
    if (b.type === 'paragraph') return b.text
    return b.markdown
  })
  return parts.length ? parts.join('\n\n') + '\n' : ''
}
