import type { Note, NoteId } from './types'

/** Comparison key for title uniqueness (ADR-009): NFC, trimmed, case-insensitive. */
export function titleKey(title: string): string {
  return title.normalize('NFC').trim().toLocaleLowerCase('en-US')
}

export function normalizeTitle(title: string): string {
  return title.normalize('NFC').trim().replace(/\s+/g, ' ')
}

export type TitleError = 'empty' | 'invalid-chars' | 'duplicate'

const FORBIDDEN = /\[\[|\]\]|[|#\r\n]/

export function validateTitleSyntax(title: string): TitleError | null {
  const t = normalizeTitle(title)
  if (!t) return 'empty'
  if (FORBIDDEN.test(title) || FORBIDDEN.test(t)) return 'invalid-chars'
  return null
}

export function findTitleConflict(
  notes: Record<NoteId, Note>,
  title: string,
  exceptId?: NoteId,
): Note | undefined {
  const key = titleKey(title)
  for (const n of Object.values(notes)) {
    if (n.id !== exceptId && titleKey(n.title) === key) return n
  }
  return undefined
}

export function validateTitle(notes: Record<NoteId, Note>, title: string, exceptId?: NoteId): TitleError | null {
  const syntax = validateTitleSyntax(title)
  if (syntax) return syntax
  return findTitleConflict(notes, title, exceptId) ? 'duplicate' : null
}

export const TITLE_ERROR_MESSAGES: Record<TitleError, string> = {
  empty: 'タイトルは必須です',
  'invalid-chars': 'タイトルに [[ ]] | # や改行は使用できません',
  duplicate: '同じWorkspace内に同じタイトルのメモがあります',
}

/** Generate a unique title by appending " (copy)", " (copy 2)", ... */
export function uniqueTitle(notes: Record<NoteId, Note>, base: string, suffix = 'copy'): string {
  let candidate = `${base} (${suffix})`
  let i = 2
  while (findTitleConflict(notes, candidate)) candidate = `${base} (${suffix} ${i++})`
  return candidate
}
