import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Root, RootContent } from 'mdast'

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath)

export function parseMarkdown(md: string): Root {
  return processor.parse(md) as Root
}

export type MdNode = Root | RootContent

export function visit(node: MdNode, fn: (n: MdNode) => boolean | void): void {
  if (fn(node) === false) return
  const children = (node as { children?: MdNode[] }).children
  if (children) for (const c of children) visit(c, fn)
}

const PROTECTED_TYPES = new Set(['code', 'inlineCode', 'math', 'inlineMath', 'html'])

/** Source ranges where text must never be rewritten (code, math, raw HTML). Sorted by start. */
export function protectedRanges(md: string, tree: Root = parseMarkdown(md)): Array<[number, number]> {
  const out: Array<[number, number]> = []
  visit(tree, (n) => {
    if (PROTECTED_TYPES.has(n.type) && n.position?.start.offset != null && n.position.end.offset != null) {
      out.push([n.position.start.offset, n.position.end.offset])
      return false
    }
  })
  return out.sort((a, b) => a[0] - b[0])
}

export function inRanges(ranges: Array<[number, number]>, start: number, end: number): boolean {
  return ranges.some(([a, b]) => start < b && end > a)
}
