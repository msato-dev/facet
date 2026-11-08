// Cross-workspace full-text index (rebuildable cache; never the source of truth).
import MiniSearch from 'minisearch'
import type { Note, NoteId, WorkspaceId } from '../../shared/domain/types'
import { normalizeForSearch, tokenize } from '../../shared/search/tokenizer'
import type { GlobalSearchHit } from '../../shared/ipc/contract'

interface Doc {
  id: string
  workspaceId: WorkspaceId
  noteId: NoteId
  title: string
  body: string
  tags: string
}

export class SearchIndex {
  private ms = new MiniSearch<Doc>({
    fields: ['title', 'body', 'tags'],
    storeFields: ['workspaceId', 'noteId', 'title', 'body', 'tags'],
    tokenize,
    processTerm: (t) => t,
    searchOptions: { tokenize, processTerm: (t) => t },
  })
  private names = new Map<WorkspaceId, string>()

  private key(ws: WorkspaceId, id: NoteId) {
    return `${ws}:${id}`
  }

  setWorkspace(ws: WorkspaceId, name: string, notes: Record<NoteId, Note>): void {
    this.removeWorkspace(ws)
    this.names.set(ws, name)
    this.ms.addAll(
      Object.values(notes)
        .filter((n) => !n.archived)
        .map((n) => this.doc(ws, n)),
    )
  }

  removeWorkspace(ws: WorkspaceId): void {
    const ids: string[] = []
    // MiniSearch has no prefix-delete; collect our keys via a wildcard search.
    for (const r of this.ms.search(MiniSearch.wildcard, { filter: (r) => r.workspaceId === ws }))
      ids.push(String(r.id))
    if (ids.length) this.ms.discardAll(ids)
    this.names.delete(ws)
  }

  updateNotes(ws: WorkspaceId, changes: Record<NoteId, Note | null>): void {
    for (const [id, n] of Object.entries(changes)) {
      const key = this.key(ws, id)
      if (this.ms.has(key)) this.ms.discard(key)
      if (n && !n.archived) this.ms.add(this.doc(ws, n))
    }
  }

  private doc(ws: WorkspaceId, n: Note): Doc {
    return {
      id: this.key(ws, n.id),
      workspaceId: ws,
      noteId: n.id,
      title: n.title,
      body: n.body,
      tags: n.tags.join(' '),
    }
  }

  search(query: string, limit = 200): GlobalSearchHit[] {
    const q = query.trim()
    if (!q) return []
    const results = this.ms.search(q, { prefix: true, combineWith: 'AND', boost: { title: 3, tags: 2 } })
    return results.slice(0, limit).map((r) => {
      const body = String(r.body ?? '')
      return {
        workspaceId: r.workspaceId as string,
        workspaceName: this.names.get(r.workspaceId as string) ?? '',
        noteId: r.noteId as string,
        title: r.title as string,
        snippet: snippet(body, q),
        tags: String(r.tags ?? '')
          .split(' ')
          .filter(Boolean),
        score: r.score,
      }
    })
  }
}

function snippet(body: string, query: string): string {
  const plain = body.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t, a) => a ?? t).replace(/\s+/g, ' ')
  const norm = normalizeForSearch(plain)
  const first = query
    .split(/\s+/)
    .map(normalizeForSearch)
    .find((t) => norm.includes(t))
  const at = first ? norm.indexOf(first) : 0
  const start = Math.max(0, at - 40)
  return (start > 0 ? '…' : '') + plain.slice(start, start + 140) + (plain.length > start + 140 ? '…' : '')
}
