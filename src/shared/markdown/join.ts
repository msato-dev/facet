// Joining rules for note fragments inside one manuscript paragraph (ADR-013).

const CJK =
  /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u30FF\u3100-\u312F\u3190-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/u
const CJK_PUNCT_END =
  /[\u3002\u3001\uFF0C\uFF0E\uFF01\uFF1F\uFF1A\uFF1B\u300D\u300F\uFF09\u3011\u3015\u3009\u300B\u201D\u2019\u30FB\u2026]$/u
const OPENING = /^[\u300C\u300E\uFF08\u3010\u3014\u3008\u300A\u201C\u2018]/u

export function isCjkChar(ch: string | undefined): boolean {
  return !!ch && CJK.test(ch)
}

/** Separator to place between `left` and `right`: '' for CJK boundaries, otherwise a single space. */
export function separatorBetween(left: string, right: string): string {
  if (!left || !right) return ''
  const l = left.at(-1)
  const r = right[0]
  if (CJK_PUNCT_END.test(left)) return ''
  if (isCjkChar(l) && (isCjkChar(r) || OPENING.test(right))) return ''
  return ' '
}

export function joinFragments(fragments: string[]): string {
  let out = ''
  for (const f of fragments) {
    const t = f.trim()
    if (!t) continue
    out = out ? out + separatorBetween(out, t) + t : t
  }
  return out
}

/** Collapse soft line breaks inside a paragraph using the same CJK-aware rule. */
export function joinSoftLines(text: string): string {
  return joinFragments(text.split(/\r?\n/))
}
