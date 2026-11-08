// Read-only BibTeX loading: parse errors with line numbers, duplicate citation keys (SPEC §6).
import { readFile } from 'node:fs/promises'
import { parse } from '@retorquere/bibtex-parser/js'
import type { BibIssue, BibliographyState, Reference } from '../../shared/domain/types'

interface Creator {
  name?: string
  lastName?: string
  firstName?: string
  prefix?: string
}

const CJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/

function creatorName(c: Creator): string {
  if (c.name) return c.name
  const last = [c.prefix, c.lastName].filter(Boolean).join(' ')
  if (CJK.test(`${c.firstName ?? ''}${last}`)) return [c.firstName, last].filter(Boolean).join(' ')
  return last || c.firstName || ''
}

export function formatAuthors(creators: Creator[] | undefined): string {
  if (!creators?.length) return ''
  const names = creators.map(creatorName).filter(Boolean)
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]} et al.`
}

function field(fields: Record<string, unknown>, ...names: string[]): string {
  for (const n of names) {
    const v = fields[n]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

export function parseBibliography(text: string, source: string): BibliographyState {
  const issues: BibIssue[] = []
  let lib
  try {
    lib = parse(text, { sentenceCase: false })
  } catch (e) {
    return {
      source,
      entries: [],
      issues: [{ kind: 'parse-error', message: (e as Error).message }],
      loadedAt: new Date().toISOString(),
    }
  }
  for (const err of lib.errors) {
    const m = /line (\d+)/.exec(err.error)
    issues.push({ kind: 'parse-error', message: err.error, line: m ? Number(m[1]) : undefined })
  }
  const entries: Reference[] = []
  const seen = new Set<string>()
  for (const e of lib.entries) {
    const f = e.fields as unknown as Record<string, unknown>
    if (seen.has(e.key)) {
      issues.push({
        kind: 'duplicate-key',
        key: e.key,
        message: `引用キー ${e.key} が重複しています（最初のエントリーを使用）`,
      })
      continue
    }
    seen.add(e.key)
    const date = field(f, 'year', 'date')
    entries.push({
      key: e.key,
      type: e.type,
      author: formatAuthors((f.author ?? f.editor) as Creator[] | undefined),
      year: /\d{4}/.exec(date)?.[0] ?? date,
      title: field(f, 'title'),
      container: field(f, 'journal', 'journaltitle', 'booktitle', 'publisher'),
      doi: field(f, 'doi'),
    })
  }
  return { source, entries, issues, loadedAt: new Date().toISOString() }
}

export async function loadBibliography(abs: string, source: string): Promise<BibliographyState> {
  let text: string
  try {
    text = await readFile(abs, 'utf8')
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
    return {
      source,
      entries: [],
      issues: [
        missing
          ? {
              kind: 'missing-file',
              message: `BibTeXファイル ${source} が見つかりません。Zotero等からこの場所へエクスポートしてください`,
            }
          : { kind: 'read-error', message: `BibTeXファイルを読み込めません: ${(e as Error).message}` },
      ],
      loadedAt: new Date().toISOString(),
    }
  }
  return parseBibliography(text, source)
}
