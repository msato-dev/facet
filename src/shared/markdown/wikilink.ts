// WikiLink parsing and rename that never touches code, math or escaped brackets (SPEC §8.1, DAT-02).
import { titleKey } from '../domain/titles'
import type { Note, NoteId } from '../domain/types'
import { inRanges, parseMarkdown, protectedRanges } from './parse'

export interface WikiLinkMatch {
  start: number
  end: number
  target: string
  alias: string | null
  raw: string
}

const WIKILINK_RE = /\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]/g

function isEscaped(text: string, index: number): boolean {
  let n = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) n++
  return n % 2 === 1
}

/** Scan raw source for WikiLinks, given pre-computed protected ranges. */
export function scanWikiLinks(md: string, ranges: Array<[number, number]>): WikiLinkMatch[] {
  const out: WikiLinkMatch[] = []
  if (!md.includes('[[')) return out
  WIKILINK_RE.lastIndex = 0
  for (let m = WIKILINK_RE.exec(md); m; m = WIKILINK_RE.exec(md)) {
    const start = m.index
    const end = start + m[0].length
    if (isEscaped(md, start) || inRanges(ranges, start, end)) continue
    const target = m[1].trim()
    if (!target) continue
    out.push({ start, end, target, alias: m[2]?.trim() || null, raw: m[0] })
  }
  return out
}

export function findWikiLinks(md: string): WikiLinkMatch[] {
  if (!md.includes('[[')) return []
  return scanWikiLinks(md, protectedRanges(md, parseMarkdown(md)))
}

export function displayText(link: Pick<WikiLinkMatch, 'target' | 'alias'>): string {
  return link.alias ?? link.target
}

/** Replace links whose target equals oldTitle (by titleKey) with newTitle, keeping aliases. */
export function renameWikiLinks(
  md: string,
  oldTitle: string,
  newTitle: string,
): { text: string; count: number } {
  const key = titleKey(oldTitle)
  const links = findWikiLinks(md).filter((l) => titleKey(l.target) === key)
  if (!links.length) return { text: md, count: 0 }
  let out = ''
  let last = 0
  for (const l of links) {
    out += md.slice(last, l.start) + `[[${newTitle}${l.alias ? `|${l.alias}` : ''}]]`
    last = l.end
  }
  out += md.slice(last)
  return { text: out, count: links.length }
}

export interface LinkInfo {
  outgoing: Array<{ target: string; noteId: NoteId | null }>
  backlinks: NoteId[]
  broken: string[]
}

export function buildTitleIndex(notes: Record<NoteId, Note>): Map<string, NoteId> {
  const idx = new Map<string, NoteId>()
  for (const n of Object.values(notes)) idx.set(titleKey(n.title), n.id)
  return idx
}

export function resolveLink(titleIndex: Map<string, NoteId>, target: string): NoteId | null {
  return titleIndex.get(titleKey(target)) ?? null
}

/** Outgoing links, backlinks and broken links for one note. */
export function linkInfo(notes: Record<NoteId, Note>, noteId: NoteId): LinkInfo {
  const note = notes[noteId]
  const idx = buildTitleIndex(notes)
  const outgoing: LinkInfo['outgoing'] = []
  const broken: string[] = []
  if (note) {
    const seen = new Set<string>()
    for (const l of findWikiLinks(note.body)) {
      const k = titleKey(l.target)
      if (seen.has(k)) continue
      seen.add(k)
      const id = resolveLink(idx, l.target)
      outgoing.push({ target: l.target, noteId: id })
      if (!id) broken.push(l.target)
    }
  }
  const backlinks: NoteId[] = []
  if (note) {
    const key = titleKey(note.title)
    for (const n of Object.values(notes)) {
      if (n.id === noteId || !n.body.includes('[[')) continue
      if (findWikiLinks(n.body).some((l) => titleKey(l.target) === key)) backlinks.push(n.id)
    }
  }
  return { outgoing, backlinks, broken }
}

/** Every broken link across the workspace. */
export function brokenLinks(notes: Record<NoteId, Note>): Array<{ noteId: NoteId; target: string }> {
  const idx = buildTitleIndex(notes)
  const out: Array<{ noteId: NoteId; target: string }> = []
  for (const n of Object.values(notes)) {
    if (!n.body.includes('[[')) continue
    for (const l of findWikiLinks(n.body))
      if (!resolveLink(idx, l.target)) out.push({ noteId: n.id, target: l.target })
  }
  return out
}
