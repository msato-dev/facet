// Tokenizer for mixed Japanese/English search: Latin words + CJK bigrams (ADR-005).

const CJK_RUN = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]+/gu

export function normalizeForSearch(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('en-US')
}

export function tokenize(text: string): string[] {
  const norm = normalizeForSearch(text)
  const tokens: string[] = []
  let last = 0
  const pushLatin = (s: string) => {
    for (const w of s.split(/[^\p{L}\p{N}_@-]+/u)) {
      const t = w.replace(/^[-@]+|[-@]+$/g, '')
      if (t) tokens.push(t)
    }
  }
  for (const m of norm.matchAll(CJK_RUN)) {
    pushLatin(norm.slice(last, m.index))
    const run = m[0]
    if (run.length === 1) tokens.push(run)
    else for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
    last = m.index + run.length
  }
  pushLatin(norm.slice(last))
  return tokens
}

/** Substring match used for in-workspace filtering (Cards). */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = normalizeForSearch(query).trim()
  if (!q) return true
  const h = normalizeForSearch(haystack)
  return q.split(/\s+/).every((part) => h.includes(part))
}
