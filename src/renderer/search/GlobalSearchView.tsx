// Search all workspaces (SPEC §5): results show their workspace; click opens it there.
import { useEffect, useState } from 'react'
import type { GlobalSearchHit } from '../../shared/ipc/contract'
import { NoteCard } from '../cards/CardsView'
import { selectNote, switchWorkspace, toast, useApp } from '../store/store'

export function GlobalSearchView() {
  const workspaces = useApp((s) => s.workspaces)
  const activeId = useApp((s) => s.activeId)
  const [q, setQ] = useState('')
  const [ws, setWs] = useState('all')
  const [hits, setHits] = useState<GlobalSearchHit[]>([])
  useEffect(() => {
    let alive = true
    const t = setTimeout(async () => {
      const r = q.trim() ? await window.facet.searchAll(q) : []
      if (alive) setHits(r)
    }, 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q])
  const shown = hits.filter((h) => ws === 'all' || h.workspaceId === ws)
  const open = async (h: GlobalSearchHit) => {
    if (h.workspaceId !== activeId) await switchWorkspace(h.workspaceId)
    useApp.setState({ globalSearch: false, tab: 'Cards', rightOpen: true })
    selectNote(h.noteId)
    if (h.workspaceId !== activeId) toast(`Workspace「${h.workspaceName}」へ移動しました`)
  }
  const copyHere = async (h: GlobalSearchHit) => {
    if (!activeId) return
    const r = await window.facet.copyNoteToWorkspace(h.workspaceId, h.noteId, activeId)
    toast(r.message, r.ok ? 'info' : 'error')
    if (r.ok) {
      const snap = await window.facet.openWorkspace(activeId)
      if (snap.ok) useApp.setState({ snapshot: snap.snapshot })
    }
  }
  return (
    <div className="listview" data-testid="global-search-view">
      <h1 className="heading">Search all workspaces</h1>
      <p className="subheading">
        登録済みのすべてのWorkspaceのメモを横断検索します。別Workspaceへの再利用は独立したコピーとして作成されます。
      </p>
      <div className="searchline">
        <input
          className="input grow"
          autoFocus
          data-testid="global-search-input"
          placeholder="Search all notes…（日本語・英語）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="select"
          aria-label="Workspace filter"
          value={ws}
          onChange={(e) => setWs(e.target.value)}
        >
          <option value="all">All Workspaces</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
      {q.trim() && shown.length === 0 && <div className="empty">該当するメモはありません</div>}
      <div className="cardgrid">
        {shown.map((h) => (
          <NoteCard
            key={`${h.workspaceId}:${h.noteId}`}
            note={{ id: h.noteId, title: h.title, body: h.snippet, tags: h.tags }}
            workspace={h.workspaceName}
            onOpen={() => void open(h)}
            extra={
              h.workspaceId !== activeId && activeId ? (
                <button
                  className="btn tiny copy-here"
                  data-testid="copy-to-current"
                  onClick={(e) => {
                    e.stopPropagation()
                    void copyHere(h)
                  }}
                >
                  ⧉ Copy to current
                </button>
              ) : null
            }
          />
        ))}
      </div>
    </div>
  )
}
