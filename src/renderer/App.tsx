import { useEffect } from 'react'
import { CanvasView } from './canvas/CanvasView'
import { CardsView } from './cards/CardsView'
import { ContextMenuHost } from './common/ContextMenu'
import { DialogHost, ToastHost } from './common/Dialogs'
import { OutlineView } from './outline/OutlineView'
import { ReferenceView } from './reference/ReferenceView'
import { GlobalSearchView } from './search/GlobalSearchView'
import { LeftPane, NavBar, RightPane, StatusBar } from './shell/Shell'
import { flushAllEditors, initApp, openDialog, redo, undo, useApp } from './store/store'

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

function Center() {
  const ready = useApp((s) => s.ready)
  const tab = useApp((s) => s.tab)
  const globalSearch = useApp((s) => s.globalSearch)
  const snapshot = useApp((s) => s.snapshot)
  const loadError = useApp((s) => s.loadError)
  const workspaces = useApp((s) => s.workspaces)
  if (!ready) return <div className="empty">Loading…</div>
  if (globalSearch) return <GlobalSearchView />
  if (!snapshot) {
    return (
      <div className="welcome" data-testid="welcome">
        <h1 className="heading">FACET</h1>
        <p className="subheading">FACET Arranges Concepts, Evidence, and Text</p>
        {loadError && <p className="field-error">Workspaceを開けません: {loadError}</p>}
        <p className="helper">{workspaces.length ? 'Settings の Vault Locations で参照先を確認してください。' : '論文ごとのWorkspace（Vaultフォルダー）を追加して始めます。'}</p>
        <button className="btn primary" data-testid="welcome-settings" onClick={() => openDialog({ kind: 'settings' })}>
          ⚙ Open Settings
        </button>
      </div>
    )
  }
  if (tab === 'Canvas') return <CanvasView />
  if (tab === 'Outline') return <OutlineView />
  if (tab === 'Cards') return <CardsView />
  return <ReferenceView />
}

export function App() {
  useEffect(() => {
    void initApp()
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void flushAllEditors()
      }
      if (!mod || isTextTarget(e.target) || useApp.getState().dialogs.length) return
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        void undo()
      } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault()
        void redo()
      }
    }
    const onUnload = () => void flushAllEditors()
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])
  return (
    <div className="app">
      <NavBar />
      <div className="main">
        <LeftPane />
        <main className="content" data-testid="center-pane">
          <Center />
        </main>
        <RightPane />
      </div>
      <StatusBar />
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
    </div>
  )
}
