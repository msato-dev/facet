// File watching for external edits. Our own writes are filtered by content stamps in the session.
import { watch, type FSWatcher } from 'chokidar'
import path from 'node:path'

export class VaultWatcher {
  private watcher: FSWatcher | null = null
  private bibWatcher: FSWatcher | null = null
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private root: string,
    private onChange: (rel: string) => void,
    private onBibChange: () => void,
  ) {}

  start(bibAbs: string): void {
    this.watcher = watch(this.root, {
      ignoreInitial: true,
      depth: 3,
      ignored: (p: string) => {
        const rel = path.relative(this.root, p).split(path.sep).join('/')
        return rel.startsWith('.facet') || rel.startsWith('exports') || rel.endsWith('.facet-tmp') || rel.startsWith('.git') || rel.includes('/.facet-write-test')
      },
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    })
    const handle = (p: string) => {
      const rel = path.relative(this.root, p).split(path.sep).join('/')
      clearTimeout(this.timers.get(rel))
      this.timers.set(rel, setTimeout(() => this.onChange(rel), 80))
    }
    this.watcher.on('add', handle).on('change', handle).on('unlink', handle)
    this.watchBib(bibAbs)
  }

  watchBib(bibAbs: string): void {
    void this.bibWatcher?.close()
    const inside = !path.relative(this.root, bibAbs).startsWith('..')
    if (inside) {
      this.bibWatcher = null
      return
    }
    this.bibWatcher = watch(bibAbs, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } })
    this.bibWatcher.on('all', () => this.onBibChange())
  }

  async stop(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t)
    await this.watcher?.close()
    await this.bibWatcher?.close()
  }
}
