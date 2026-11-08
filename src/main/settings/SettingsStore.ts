// App settings in the user profile (userData), independent of where the portable EXE lives (WIN-02).
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { writeFileAtomic } from '../vault/atomic'
import { zSettings, type SettingsFile } from '../vault/schemas'

export function defaultSettings(): SettingsFile {
  return {
    schemaVersion: 1,
    workspaces: [],
    lastWorkspaceId: null,
    panes: { leftOpen: true, rightOpen: true },
    window: { bounds: null, maximized: false },
  }
}

export class SettingsStore {
  data: SettingsFile = defaultSettings()
  private writing: Promise<void> = Promise.resolve()

  constructor(public readonly file: string) {}

  static forDir(dir: string): SettingsStore {
    return new SettingsStore(path.join(dir, 'settings.json'))
  }

  async load(): Promise<SettingsFile> {
    try {
      const parsed = zSettings.safeParse(JSON.parse(await readFile(this.file, 'utf8')))
      this.data = parsed.success ? parsed.data : defaultSettings()
    } catch {
      this.data = defaultSettings()
    }
    return this.data
  }

  async update(fn: (d: SettingsFile) => SettingsFile): Promise<SettingsFile> {
    const prev = this.data
    const next = fn(structuredClone(prev))
    const snapshot = JSON.stringify(next, null, 2) + '\n'
    const run = this.writing.then(() => writeFileAtomic(this.file, snapshot))
    this.writing = run.catch(() => undefined) // a failed write must not block later ones
    this.data = next
    try {
      await run
    } catch (e) {
      if (this.data === next) this.data = prev // keep memory in line with the file on disk
      throw e
    }
    return next
  }
}
