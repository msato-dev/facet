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
    this.data = fn(structuredClone(this.data))
    const snapshot = JSON.stringify(this.data, null, 2) + '\n'
    this.writing = this.writing.then(() => writeFileAtomic(this.file, snapshot))
    await this.writing
    return this.data
  }
}
