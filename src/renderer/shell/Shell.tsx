// Common navigation row, three panes with independent collapse, status bar (SPEC §2).
import { useMemo, type ReactNode } from 'react'
import { computeNumbering } from '../../shared/domain/numbering'
import { allGroups, sectionSubtreeIds, type ParentRef } from '../../shared/domain/structure'
import type { SectionNode } from '../../shared/domain/types'
import { NoteEditor } from '../editor/NoteEditor'
import { openDialog, setPanes, setTab, switchWorkspace, useApp, type Tab } from '../store/store'

const TABS: Tab[] = ['Canvas', 'Outline', 'Cards', 'Reference']

export function NavBar() {
  const tab = useApp((s) => s.tab)
  const globalSearch = useApp((s) => s.globalSearch)
  return (
    <header className="nav" data-testid="nav">
      <div className="brand" data-testid="brand">
        <span className="brand-name">FACET</span>
        <small className="brand-expansion">FACET Arranges Concepts, Evidence, and Text</small>
      </div>
      <nav className="tabs" role="tablist" aria-label="Main tabs">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={!globalSearch && t === tab}
            className={`tab ${!globalSearch && t === tab ? 'active' : ''}`}
            data-testid={`tab-${t}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="nav-right">
        <button
          className={`btn global-search ${globalSearch ? 'active' : ''}`}
          data-testid="global-search-button"
          onClick={() => useApp.setState({ globalSearch: true })}
        >
          ⌕ Search all workspaces
        </button>
        <button className="btn icon settings-button" data-testid="settings-button" title="Settings" aria-label="Settings" onClick={() => openDialog({ kind: 'settings' })}>
          ⚙
        </button>
      </div>
    </header>
  )
}

function WorkspaceSwitcher() {
  const workspaces = useApp((s) => s.workspaces)
  const activeId = useApp((s) => s.activeId)
  if (!workspaces.length) {
    return (
      <div className="ws-panel">
        <div className="side-label">WORKSPACE</div>
        <button className="btn primary full" data-testid="add-first-workspace" onClick={() => openDialog({ kind: 'settings' })}>
          ＋ Add workspace…
        </button>
      </div>
    )
  }
  return (
    <div className="ws-panel">
      <label className="side-label" htmlFor="ws-select">
        WORKSPACE
      </label>
      <select id="ws-select" className="select full" data-testid="workspace-select" value={activeId ?? ''} onChange={(e) => void switchWorkspace(e.target.value)}>
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
            {w.status === 'error' ? ' (unavailable)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

function SectionsTree() {
  const snapshot = useApp((s) => s.snapshot)
  const scope = useApp((s) => s.scope)
  const tab = useApp((s) => s.tab)
  const structure = snapshot?.state.structure
  const numbering = useMemo(() => (structure ? computeNumbering(structure) : null), [structure])
  if (!structure || !numbering) return null
  const groups = allGroups(structure)
  const countIn = (id: string) => {
    const ids = sectionSubtreeIds(structure, id)
    return groups.filter((g) => g.parent.type === 'section' && ids.has((g.parent as Extract<ParentRef, { type: 'section' }>).id)).length
  }
  const choose = (id: string) => {
    useApp.setState({ scope: id })
    if (tab === 'Outline' && id !== 'all') useApp.setState({ scrollToSection: { id, nonce: Date.now() } })
  }
  const rows: ReactNode[] = []
  const rec = (sections: SectionNode[], depth: number) => {
    for (const s of sections) {
      rows.push(
        <button
          key={s.id}
          className={`side-item depth-${Math.min(depth, 4)} ${scope === s.id ? 'active' : ''}`}
          style={{ paddingLeft: 8 + (depth - 1) * 12 }}
          data-testid="section-item"
          data-section-id={s.id}
          onClick={() => choose(s.id)}
        >
          <span className="side-item-label">
            {depth > 1 ? '↳ ' : '▾ '}
            {numbering.label.get(s.id)}
          </span>
          <span className="count">{countIn(s.id)}</span>
        </button>,
      )
      rec(s.children.filter((c): c is SectionNode => c.kind === 'section'), depth + 1)
    }
  }
  rec(structure.root.children, 1)
  return (
    <div className="sections" data-testid="sections">
      <div className="side-label">SECTIONS</div>
      <button className={`side-item ${scope === 'all' || scope === 'unassigned' ? 'active' : ''}`} data-testid="section-all" onClick={() => choose('all')}>
        <span className="side-item-label">▦ All</span>
        <span className="count">{groups.length} groups</span>
      </button>
      {rows}
      {rows.length === 0 && <p className="helper side-hint">章がありません。Outlineの「＋ Section」で追加できます。</p>}
    </div>
  )
}

export function LeftPane() {
  const open = useApp((s) => s.leftOpen)
  const rightOpen = useApp((s) => s.rightOpen)
  const globalSearch = useApp((s) => s.globalSearch)
  const snapshot = useApp((s) => s.snapshot)
  if (!open) {
    return (
      <aside className="pane left closed" data-testid="left-pane" aria-label="左ペイン（折りたたみ）">
        <button className="pane-toggle" data-testid="toggle-left" title="左ペインを開く" aria-label="左ペインを開く" onClick={() => setPanes(true, rightOpen)}>
          ▶
        </button>
      </aside>
    )
  }
  return (
    <aside className="pane left" data-testid="left-pane">
      <button className="pane-toggle pane-toggle-left" data-testid="toggle-left" title="左ペインを閉じる" aria-label="左ペインを閉じる" onClick={() => setPanes(false, rightOpen)}>
        ◀
      </button>
      <WorkspaceSwitcher />
      {globalSearch ? (
        <div className="sections">
          <div className="side-label">WORKSPACES</div>
          <button className="side-item active">⌕ Search all workspaces</button>
          <button className="side-item" data-testid="exit-global" onClick={() => useApp.setState({ globalSearch: false })}>
            ← Back to workspace
          </button>
        </div>
      ) : (
        <SectionsTree />
      )}
      {snapshot && (
        <div className="side-foot" title={snapshot.vaultPath}>
          {snapshot.name}
          <br />
          <span className="mono">{snapshot.vaultPath}</span>
        </div>
      )}
    </aside>
  )
}

export function RightPane() {
  const open = useApp((s) => s.rightOpen)
  const leftOpen = useApp((s) => s.leftOpen)
  if (!open) {
    return (
      <aside className="pane right closed" data-testid="right-pane" aria-label="右ペイン（折りたたみ）">
        <button className="pane-toggle" data-testid="toggle-right" title="右ペインを開く" aria-label="右ペインを開く" onClick={() => setPanes(leftOpen, true)}>
          ◀
        </button>
      </aside>
    )
  }
  return (
    <aside className="pane right" data-testid="right-pane">
      <button className="pane-toggle pane-toggle-right" data-testid="toggle-right" title="右ペインを閉じる" aria-label="右ペインを閉じる" onClick={() => setPanes(leftOpen, false)}>
        ▶
      </button>
      <NoteEditor />
    </aside>
  )
}

export function StatusBar() {
  const snapshot = useApp((s) => s.snapshot)
  const saving = useApp((s) => s.saving)
  const version = useApp((s) => s.version)
  const notes = snapshot ? Object.keys(snapshot.state.notes).length : 0
  return (
    <footer className="statusbar">
      <span className="status-dot" />
      <span>LOCAL WORKSPACE</span>
      <span className="divider">│</span>
      <span>{snapshot ? `${notes} notes · Markdown vault` : 'No workspace'}</span>
      <span className="divider">│</span>
      <span data-testid="save-state">{saving ? 'SAVING…' : 'SAVED'}</span>
      <span className="grow" />
      <span>FACET</span>
      <span className="divider">│</span>
      <span>v{version}</span>
    </footer>
  )
}
