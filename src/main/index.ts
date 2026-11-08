// Electron main process: window, security, IPC (SPEC §9.1).
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { CH } from '../shared/ipc/channels'
import {
  zCommand,
  zId,
  zPanes,
  zVaultLocations,
  type InitialState,
  type WorkspaceEvent,
} from '../shared/ipc/contract'
import { SettingsStore } from './settings/SettingsStore'
import { writeFileAtomic } from './vault/atomic'
import { WorkspaceManager } from './workspace/WorkspaceManager'

const E2E = process.env.FACET_E2E === '1'

app.setName('FACET')
// userData lives in %APPDATA%\FACET so the portable EXE can be moved freely (WIN-02).
const userDataDir =
  E2E && process.env.FACET_USER_DATA
    ? process.env.FACET_USER_DATA
    : path.join(app.getPath('appData'), 'FACET')
app.setPath('userData', userDataDir)

/** Test hooks: replace OS dialogs during automated E2E runs only. */
interface TestHooks {
  browseResult: string | null
  saveResult: string | null
  openFileResult: string | null
  /** Answer to the "unsaved changes" close prompt; null means discard (so test teardown never hangs). */
  closeChoice: 'cancel' | 'discard' | null
  closePrompts: number
}
const testHooks: TestHooks = {
  browseResult: null,
  saveResult: null,
  openFileResult: null,
  closeChoice: null,
  closePrompts: 0,
}
if (E2E) (globalThis as unknown as { __facetTest: TestHooks }).__facetTest = testHooks

if (!E2E && !app.requestSingleInstanceLock()) app.quit()

let mainWindow: BrowserWindow | null = null
let manager: WorkspaceManager

function emit(e: WorkspaceEvent): void {
  mainWindow?.webContents.send(CH.workspaceEvent, e)
}

function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? ''
  if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return true
  return url.startsWith('file://')
}

function handle<A extends unknown[]>(
  channel: string,
  schema: z.ZodType<A>,
  fn: (...args: A) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...raw) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new Error(`Invalid arguments for ${channel}`)
    return fn(...parsed.data)
  })
}

function registerIpc(): void {
  const none = z.tuple([])
  handle(CH.getInitialState, none, (): InitialState => {
    const s = manager.settings.data
    const workspaces = manager.summaries()
    const active =
      workspaces.find((w) => w.id === s.lastWorkspaceId && w.status === 'ok') ??
      workspaces.find((w) => w.status === 'ok')
    return {
      workspaces,
      activeWorkspaceId: active?.id ?? null,
      panes: s.panes,
      version: app.getVersion(),
      e2e: E2E,
    }
  })
  handle(CH.openWorkspace, z.tuple([zId]), (id) => {
    const s = manager.session(id)
    return s
      ? { ok: true, snapshot: s.snapshot() }
      : { ok: false, message: manager.summaries().find((w) => w.id === id)?.error ?? 'Workspaceを開けません' }
  })
  handle(CH.execute, z.tuple([zId, zCommand]), (id, cmd) => manager.execute(id, (s) => s.execute(cmd)))
  handle(CH.undo, z.tuple([zId]), (id) => manager.execute(id, (s) => s.undo()))
  handle(CH.redo, z.tuple([zId]), (id) => manager.execute(id, (s) => s.redo()))
  handle(CH.restoreFromTrash, z.tuple([zId, zId]), (id, noteId) =>
    manager.execute(id, (s) => s.restoreFromTrash(noteId)),
  )
  handle(CH.copyNoteToWorkspace, z.tuple([zId, zId, zId]), (from, noteId, to) =>
    manager.copyNote(from, noteId, to),
  )
  handle(CH.searchAll, z.tuple([z.string().max(1000)]), (q) => manager.searchAll(q))
  handle(CH.copyText, z.tuple([z.string().max(20_000_000)]), (text) => clipboard.writeText(text))
  handle(CH.exportManuscript, z.tuple([zId, z.string().max(20_000_000)]), async (id, markdown) => {
    const s = manager.session(id)
    if (!s) return { ok: false, message: 'Workspaceが開かれていません' }
    const defaultPath = path.join(s.vaultPath, 'exports', 'manuscript.md')
    let target: string | undefined
    if (E2E) target = testHooks.saveResult ?? defaultPath
    else {
      await mkdir(path.dirname(defaultPath), { recursive: true })
      const r = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export manuscript',
        defaultPath,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      target = r.canceled ? undefined : r.filePath
    }
    if (!target) return { ok: false, message: 'エクスポートをキャンセルしました' }
    await mkdir(path.dirname(target), { recursive: true })
    await writeFileAtomic(target, markdown)
    return { ok: true, message: `エクスポートしました: ${target}`, path: target }
  })
  handle(CH.reloadBibliography, z.tuple([zId]), async (id) => {
    const s = manager.session(id)
    if (!s) return null
    await s.loadBib()
    return s.snapshot()
  })
  handle(CH.chooseBibliography, z.tuple([zId]), async (id) => {
    const s = manager.session(id)
    if (!s) return null
    let file: string | null
    if (E2E) file = testHooks.openFileResult
    else {
      const r = await dialog.showOpenDialog(mainWindow!, {
        title: 'Choose BibTeX file',
        defaultPath: path.dirname(s.bibAbsPath()),
        properties: ['openFile'],
        filters: [{ name: 'BibTeX', extensions: ['bib'] }],
      })
      file = r.canceled ? null : (r.filePaths[0] ?? null)
    }
    if (!file) return null
    await manager.setBibliography(id, file)
    return s.snapshot()
  })
  handle(CH.openBibliographyFolder, z.tuple([zId]), async (id) => {
    const s = manager.session(id)
    if (!s) return
    const dir = path.dirname(s.bibAbsPath())
    await mkdir(dir, { recursive: true })
    if (!E2E) await shell.openPath(dir)
  })
  handle(
    CH.browseFolder,
    z.tuple([z.string().max(4096).optional()]) as unknown as z.ZodType<[string | undefined]>,
    async (defaultPath) => {
      if (E2E) return testHooks.browseResult
      const r = await dialog.showOpenDialog(mainWindow!, {
        title: 'Select vault folder',
        defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
  )
  handle(CH.validateVaultPath, z.tuple([zId, z.string().max(4096)]), (id, p) =>
    manager.validateLocation(id, p),
  )
  handle(CH.saveVaultLocations, z.tuple([zVaultLocations]), (paths) => manager.saveLocations(paths))
  handle(CH.addWorkspace, z.tuple([z.string().max(4096), z.string().max(500)]), (p, name) =>
    manager.addWorkspace(p, name),
  )
  handle(CH.removeWorkspace, z.tuple([zId]), (id) => manager.removeWorkspace(id))
  handle(CH.setPanes, z.tuple([zPanes]), async (panes) => {
    await manager.settings.update((d) => ({ ...d, panes }))
  })
  handle(CH.setActiveWorkspace, z.tuple([zId]), async (id) => {
    await manager.settings.update((d) => ({ ...d, lastWorkspaceId: id }))
  })
  handle(CH.closeReady, z.tuple([z.number().int().nonnegative(), z.boolean()]), (requestId, ok) => {
    closeReplies.get(requestId)?.(ok)
    closeReplies.delete(requestId)
  })
}

// ---------------------------------------------------------------------------
// Close guard: never close while the Renderer still holds edits that are not on disk.

const CLOSE_FLUSH_TIMEOUT_MS = 15_000
const closeReplies = new Map<number, (ok: boolean) => void>()
let nextCloseRequest = 1

/** Ask the Renderer to flush its editors. Resolves true when nothing is left unsaved. */
function requestRendererFlush(win: BrowserWindow): Promise<boolean> {
  const wc = win.webContents
  if (wc.isDestroyed() || wc.isCrashed()) return Promise.resolve(true) // nothing left to flush
  const id = nextCloseRequest++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      closeReplies.delete(id)
      resolve(false) // unknown state: let the user decide
    }, CLOSE_FLUSH_TIMEOUT_MS)
    closeReplies.set(id, (ok) => {
      clearTimeout(timer)
      resolve(ok)
    })
    wc.send(CH.closeRequest, id)
  })
}

async function confirmDiscardOnClose(win: BrowserWindow): Promise<boolean> {
  if (E2E) {
    testHooks.closePrompts++
    return testHooks.closeChoice !== 'cancel'
  }
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'FACET',
    message: '保存できていない変更があります',
    detail:
      '競合または保存エラーのため、一部の編集内容を Vault に保存できていません。\n' +
      '「戻る」を選び、競合バナーで「最新を読み込む」か「自分の内容で上書き」を選んでから終了してください。',
    buttons: ['戻る', '変更を破棄して終了'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return r.response === 1
}

function hardenSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (ev) => ev.preventDefault())
    contents.on('will-attach-webview', (ev) => ev.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}

async function createWindow(): Promise<void> {
  const saved = manager.settings.data.window
  mainWindow = new BrowserWindow({
    width: saved.bounds?.width ?? 1440,
    height: saved.bounds?.height ?? 900,
    x: saved.bounds?.x,
    y: saved.bounds?.y,
    minWidth: 960,
    minHeight: 600,
    title: 'FACET',
    backgroundColor: '#17171b',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })
  if (saved.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  const persistBounds = () => {
    if (!mainWindow) return
    const maximized = mainWindow.isMaximized()
    const bounds = maximized
      ? (manager.settings.data.window.bounds ?? mainWindow.getBounds())
      : mainWindow.getBounds()
    void manager.settings.update((d) => ({ ...d, window: { bounds, maximized } }))
  }
  const win = mainWindow
  let closeAllowed = false
  let closeInProgress = false
  win.on('close', (e) => {
    if (closeAllowed) {
      persistBounds()
      return
    }
    e.preventDefault()
    if (closeInProgress) return
    closeInProgress = true
    void (async () => {
      try {
        const ok = await requestRendererFlush(win)
        await manager.idle()
        if (!ok && !(await confirmDiscardOnClose(win))) return
        closeAllowed = true
        if (!win.isDestroyed()) win.close()
      } finally {
        closeInProgress = false
      }
    })()
  })
  mainWindow.on('closed', () => (mainWindow = null))
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  hardenSecurity()
  manager = new WorkspaceManager(SettingsStore.forDir(app.getPath('userData')), emit)
  await manager.init()
  registerIpc()
  await createWindow()
})

app.on('window-all-closed', () => {
  void manager?.dispose().finally(() => app.quit())
})
