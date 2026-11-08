// Joining rules for note fragments inside one manuscript paragraph (ADR-013).

const CJK = /[⺀-⿿　-〿぀-ヿ㄀-ㄯ㆐-ㇿ㐀-䶿一-鿿豈-﫿︰-﹏＀-￯]/u
const CJK_PUNCT_END = /[。、，．！？：；」』）】〕〉》”’・…]$/u
const OPENING = /^[「『（【〔〈《“‘]/u

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
