import { useEffect, useRef } from 'react'
import { create } from 'zustand'

export interface MenuItem {
  label: string
  run: () => void
  danger?: boolean
  disabled?: boolean
}

const useMenu = create<{ menu: { x: number; y: number; items: MenuItem[] } | null }>(() => ({ menu: null }))

export function openContextMenu(
  e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation?(): void },
  items: MenuItem[],
): void {
  e.preventDefault()
  e.stopPropagation?.()
  useMenu.setState({ menu: { x: e.clientX, y: e.clientY, items } })
}

export function ContextMenuHost() {
  const menu = useMenu((s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (ev: Event) => {
      if (ev instanceof KeyboardEvent && ev.key !== 'Escape') return
      if (ev instanceof PointerEvent && ref.current?.contains(ev.target as Node)) return
      useMenu.setState({ menu: null })
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close, true)
    window.addEventListener('blur', close)
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close, true)
      window.removeEventListener('blur', close)
    }
  }, [menu])
  if (!menu) return null
  const x = Math.min(menu.x, window.innerWidth - 230)
  const y = Math.min(menu.y, window.innerHeight - 40 - menu.items.length * 32)
  return (
    <div className="ctx" role="menu" ref={ref} style={{ left: x, top: y }} data-testid="context-menu">
      {menu.items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          className={it.danger ? 'danger' : ''}
          disabled={it.disabled}
          onClick={() => {
            useMenu.setState({ menu: null })
            it.run()
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
