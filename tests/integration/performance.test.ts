// Scale check (SPEC §9.2): ~1,000 notes × 10 workspaces. Targets are DESIGN values.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { newId } from '../../src/shared/domain/ids'
import { generateManuscript } from '../../src/shared/markdown/manuscript'
import { SettingsStore } from '../../src/main/settings/SettingsStore'
import { WorkspaceManager } from '../../src/main/workspace/WorkspaceManager'

const WORKSPACES = 10
const NOTES = 1000
let tmp: string

async function syntheticVault(dir: string, w: number) {
  await mkdir(path.join(dir, 'notes'), { recursive: true })
  const notes: Record<string, unknown> = {}
  const groups: Array<{ kind: 'group'; id: string; title: string; noteIds: string[] }> = []
  let current: string[] = []
  for (let i = 0; i < NOTES; i++) {
    const id = newId()
    const body = `Note ${i} of workspace ${w}. マグマ溜まり ${i % 37} の再活性化と diffusion timescale ${i}. See [[Note ${w}-${(i + 1) % NOTES}]].`
    await writeFile(path.join(dir, 'notes', `${id}.md`), `# Note ${w}-${i}\n\n${body}`)
    notes[id] = {
      file: `notes/${id}.md`,
      tags: [`t${i % 20}`],
      createdAt: new Date(i * 1000).toISOString(),
      updatedAt: new Date(i * 1000).toISOString(),
      archived: false,
      lastPlacement: null,
    }
    if (i < 800) {
      current.push(id)
      if (current.length === 4) {
        groups.push({ kind: 'group', id: newId(), title: `G${groups.length}`, noteIds: current })
        current = []
      }
    }
  }
  const sections = Array.from({ length: 10 }, (_, s) => ({
    kind: 'section',
    id: newId(),
    title: `Chapter ${s}`,
    children: groups.slice(s * 20, s * 20 + 20),
  }))
  await writeFile(
    path.join(dir, 'project.yml'),
    `schemaVersion: 1\nworkspaceId: ${newId()}\nname: W${w}\ncreatedAt: "2026-01-01T00:00:00Z"\n`,
  )
  await writeFile(path.join(dir, 'notes-index.json'), JSON.stringify({ schemaVersion: 1, notes }))
  await writeFile(
    path.join(dir, 'structure.json'),
    JSON.stringify({ schemaVersion: 1, root: { children: sections }, unplacedGroups: [] }),
  )
}

beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'facet-perf-'))
  for (let w = 0; w < WORKSPACES; w++) await syntheticVault(path.join(tmp, `v${w}`), w)
}, 120_000)
afterAll(async () => rm(tmp, { recursive: true, force: true }))

describe('performance (10 workspaces × 1,000 notes)', () => {
  it('loads, searches and generates the manuscript within budget', async () => {
    const manager = new WorkspaceManager(SettingsStore.forDir(path.join(tmp, 'ud')), () => undefined, {
      watch: false,
    })
    await manager.init()
    let t = performance.now()
    for (let w = 0; w < WORKSPACES; w++) {
      const r = await manager.addWorkspace(path.join(tmp, `v${w}`), `W${w}`)
      expect(r.ok).toBe(true)
    }
    const loadMs = performance.now() - t
    t = performance.now()
    const hits = manager.searchAll('再活性化 diffusion')
    const searchMs = performance.now() - t
    expect(hits.length).toBeGreaterThan(100)
    const session = manager.session(manager.summaries()[0].id)!
    t = performance.now()
    const m = generateManuscript(session.state)
    const msMs = performance.now() - t
    expect(m.blocks.filter((b) => b.type === 'paragraph')).toHaveLength(200)
    t = performance.now()
    const r = await session.execute({
      type: 'note.rename',
      id: Object.keys(session.state.notes)[1],
      title: 'Renamed note',
    })
    const renameMs = performance.now() - t
    expect(r.ok).toBe(true)
    console.log(
      `load ${loadMs.toFixed(0)}ms (10 vaults), search ${searchMs.toFixed(1)}ms, manuscript ${msMs.toFixed(0)}ms, rename-cascade ${renameMs.toFixed(0)}ms`,
    )
    expect(searchMs).toBeLessThan(100)
    expect(loadMs).toBeLessThan(10_000)
    await manager.dispose()
  }, 120_000)
})
