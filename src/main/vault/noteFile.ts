// Markdown note file format: first line "# Title", then the body (SPEC §8.1).

export function serializeNote(title: string, body: string): string {
  return body ? `# ${title}\n\n${body}` : `# ${title}\n`
}

export function parseNoteFile(
  content: string,
  fallbackTitle: string,
): { title: string; body: string; hasTitle: boolean } {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const nl = text.indexOf('\n')
  const first = nl === -1 ? text : text.slice(0, nl)
  const m = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(first)
  if (!m) return { title: fallbackTitle, body: text, hasTitle: false }
  let rest = nl === -1 ? '' : text.slice(nl + 1)
  if (rest.startsWith('\n')) rest = rest.slice(1)
  return { title: m[1].trim(), body: rest, hasTitle: true }
}
