import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { applyCommand, type Command } from '../../src/shared/domain/commands'
import { newId } from '../../src/shared/domain/ids'
import { findNoteLocation } from '../../src/shared/domain/structure'
import type { DomainState } from '../../src/shared/domain/types'
import { journalTestHooks } from '../../src/main/vault/journal'
import { resolveInVault } from '../../src/main/vault/pathGuard'
import { VaultRepository } from '../../src/main/vault/VaultRepository'
import { SettingsStore } from '../../src/main/settings/SettingsStore'
import { WorkspaceManager } from '../../src/main/workspace/WorkspaceManager'
import { parseBibliography } from '../../src/main/bib/bib'

const ctx = { newId, now: () => new Date().toISOString() }
let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'facet-it-'))
})
afterEach(async () => {
  journalTestHooks.failAfterOps = null
  await rm(tmp, { recursive: true, force: true })
})

function step(state: DomainState, cmd: Command): DomainState {
  const r = applyCommand(state, cmd, ctx)
  if (!r.ok) throw new Error(r.error.message)
  return r.state
}

async function newVault(name = 'Paper') {
  const dir = path.join(tmp, name)
  await mkdir(dir)
  await VaultRepository.init(dir, name)
  return VaultRepository.open(dir)
}

describe('vault persistence (DAT-05)', () => {
  it('round-trips notes, structure and canvas positions through files', async () => {
    const { repo, loaded } = await newVault()
    let st = loaded.state
    st = step(st, { type: 'section.create', title: 'Introduction', parentId: null })
    const sec = st.structure.root.children[0].id
    st = step(st, { type: 'note.create', title: '逆累帯構造', body: '斜長石の逆累帯構造 [@Smith2024]', tags: ['Petrology'] })
    const nid = Object.keys(st.notes)[0]
    st = step(st, { type: 'group.create', title: 'Obs', sectionId: sec, noteIds: [nid], canvasPos: { x: 120, y: 80 } })
    let prev = loaded.state
    await repo.persist(prev, st)
    prev = st

    const md = await readFile(path.join(repo.root, 'notes', `${nid}.md`), 'utf8')
    expect(md).toBe('# 逆累帯構造\n\n斜長石の逆累帯構造 [@Smith2024]')

    const reopened = await VaultRepository.open(repo.root)
    const s2 = reopened.loaded.state
    expect(s2.notes[nid].title).toBe('逆累帯構造')
    expect(s2.notes[nid].tags).toEqual(['Petrology'])
    expect(findNoteLocation(s2.structure, nid)?.group.title).toBe('Obs')
    const gid = findNoteLocation(s2.structure, nid)!.group.id
    expect(s2.canvas.canvases[0].groups[gid]).toEqual({ x: 120, y: 80 })
    expect(reopened.loaded.issues).toEqual([])
  })

  it('moves deleted notes to the vault trash instead of removing them', async () => {
    const { repo, loaded } = await newVault()
    const a = step(loaded.state, { type: 'note.create', title: 'Temp', body: 'x' })
    await repo.persist(loaded.state, a)
    const id = Object.keys(a.notes)[0]
    const b = step(a, { type: 'note.trash', ids: [id] })
    await repo.persist(a, b)
    expect(await readdir(path.join(repo.root, 'notes'))).toEqual([])
    expect(await readFile(path.join(repo.root, '.facet', 'trash', `${id}.md`), 'utf8')).toContain('# Temp')
    const restored = await repo.readTrashed(id)
    expect(restored?.title).toBe('Temp')
  })

  it('does not silently overwrite a note edited externally', async () => {
    const { repo, loaded } = await newVault()
    const a = step(loaded.state, { type: 'note.create', title: 'Shared', body: 'v1' })
    await repo.persist(loaded.state, a)
    const id = Object.keys(a.notes)[0]
    const file = path.join(repo.root, 'notes', `${id}.md`)
    await new Promise((r) => setTimeout(r, 20))
    await writeFile(file, '# Shared\n\nexternal edit')
    const b = step(a, { type: 'note.updateBody', id, body: 'v2 from FACET', baseRev: null })
    await expect(repo.persist(a, b)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(file, 'utf8')).toBe('# Shared\n\nexternal edit')
  })

  it('imports orphan markdown files and reports missing titles', async () => {
    const { repo } = await newVault()
    await writeFile(path.join(repo.root, 'notes', 'hand written.md'), 'no heading here')
    await writeFile(path.join(repo.root, 'notes', 'other.md'), '# Proper title\n\nBody')
    const { loaded } = await VaultRepository.open(repo.root)
    const titles = Object.values(loaded.state.notes).map((n) => n.title).sort()
    expect(titles).toEqual(['Proper title', 'hand written'])
    expect(loaded.issues.map((i) => i.kind).sort()).toEqual(['imported-orphan', 'imported-orphan', 'missing-title'])
    const again = await VaultRepository.open(repo.root)
    expect(again.loaded.issues.filter((i) => i.kind === 'imported-orphan')).toEqual([])
  })

  it('removes dangling structure references on load', async () => {
    const { repo } = await newVault()
    await writeFile(
      path.join(repo.root, 'structure.json'),
      JSON.stringify({ schemaVersion: 1, root: { children: [{ kind: 'section', id: 's1', title: 'A', children: [{ kind: 'group', id: 'g1', title: 'G', noteIds: ['ghost'] }] }] }, unplacedGroups: [] }),
    )
    const { loaded } = await VaultRepository.open(repo.root)
    expect(loaded.issues.some((i) => i.kind === 'invalid-structure-ref')).toBe(true)
    expect(JSON.parse(await readFile(path.join(repo.root, 'structure.json'), 'utf8')).root.children[0].children[0].noteIds).toEqual([])
  })
})

describe('multi-file transactions', () => {
  it('rolls back every file when a rename cascade fails midway', async () => {
    const { repo, loaded } = await newVault()
    let st = step(loaded.state, { type: 'note.create', title: 'Target', body: 'x' })
    st = step(st, { type: 'note.create', title: 'Ref1', body: 'see [[Target]]' })
    st = step(st, { type: 'note.create', title: 'Ref2', body: 'also [[Target]]' })
    await repo.persist(loaded.state, st)
    const before = await snapshotDir(path.join(repo.root, 'notes'))
    const targetId = Object.values(st.notes).find((n) => n.title === 'Target')!.id
    const renamed = step(st, { type: 'note.rename', id: targetId, title: 'Renamed' })
    journalTestHooks.failAfterOps = 2
    await expect(repo.persist(st, renamed)).rejects.toThrow('Injected failure')
    journalTestHooks.failAfterOps = null
    expect(await snapshotDir(path.join(repo.root, 'notes'))).toEqual(before)
    expect(await readdir(path.join(repo.root, '.facet', 'journal'))).toEqual([])
  })

  it('recovers a leftover journal on open (crash simulation)', async () => {
    const { repo, loaded } = await newVault()
    const st = step(loaded.state, { type: 'note.create', title: 'A', body: 'original' })
    await repo.persist(loaded.state, st)
    const id = Object.keys(st.notes)[0]
    const file = path.join(repo.root, 'notes', `${id}.md`)
    // Simulate a crash after a write was applied but before the journal was removed.
    const jdir = path.join(repo.root, '.facet', 'journal')
    await mkdir(path.join(jdir, 'tx1'), { recursive: true })
    await writeFile(path.join(jdir, 'tx1', '0.bak'), '# A\n\noriginal')
    await writeFile(file, '# A\n\nhalf-written')
    await writeFile(path.join(jdir, 'tx1.json'), JSON.stringify({ id: 'tx1', createdAt: '', ops: [{ type: 'write', target: file, tmp: file + '.facet-tmp', backup: path.join(jdir, 'tx1', '0.bak') }] }))
    const { loaded: l2 } = await VaultRepository.open(repo.root)
    expect(l2.state.notes[id].body).toBe('original')
    expect(l2.issues.some((i) => i.kind === 'recovered-journal')).toBe(true)
  })
})

describe('path guard', () => {
  it('rejects traversal, absolute paths and symlink escapes', async () => {
    const { repo } = await newVault()
    await expect(resolveInVault(repo.root, '../x.md')).rejects.toThrow()
    await expect(resolveInVault(repo.root, '/etc/passwd')).rejects.toThrow()
    await expect(resolveInVault(repo.root, 'C:/Windows/x')).rejects.toThrow()
    const outside = path.join(tmp, 'outside')
    await mkdir(outside)
    await symlink(outside, path.join(repo.root, 'link'), 'dir')
    await expect(resolveInVault(repo.root, 'link/secret.md')).rejects.toThrow()
    await expect(resolveInVault(repo.root, 'notes/ok.md')).resolves.toContain('notes')
  })
})

describe('workspace manager & settings (DAT-06, UI-14)', () => {
  it('registers workspaces, validates location changes and keeps the old path when invalid', async () => {
    const userData = path.join(tmp, 'userData')
    const manager = new WorkspaceManager(SettingsStore.forDir(userData), () => undefined, { watch: false })
    await manager.init()
    const dirA = path.join(tmp, 'A')
    const dirB = path.join(tmp, 'B')
    await mkdir(dirA)
    await mkdir(dirB)
    const a = await manager.addWorkspace(dirA, 'Zao')
    const b = await manager.addWorkspace(dirB, 'Chamber')
    expect(a.ok && b.ok).toBe(true)
    const idA = a.workspace!.id

    // Pointing A at B's vault (a different workspace) is refused; nothing is moved or deleted.
    const r = await manager.saveLocations({ [idA]: dirB })
    expect(r.ok).toBe(false)
    expect(r.results[idA].message).toContain('別のWorkspace')
    expect(manager.settings.data.workspaces.find((w) => w.id === idA)!.vaultPath).toBe(a.workspace!.vaultPath)
    expect(await readdir(dirA)).toContain('project.yml')

    const missing = await manager.saveLocations({ [idA]: path.join(tmp, 'nope') })
    expect(missing.ok).toBe(false)
    const relative = await manager.saveLocations({ [idA]: 'relative/path' })
    expect(relative.results[idA].message).toContain('絶対パス')

    // A copied vault (same workspace id) is accepted.
    const copy = path.join(tmp, 'A-copy')
    await mkdir(copy)
    for (const f of await readdir(dirA, { withFileTypes: true })) {
      if (f.isFile()) await writeFile(path.join(copy, f.name), await readFile(path.join(dirA, f.name)))
    }
    await mkdir(path.join(copy, 'notes'))
    const ok = await manager.saveLocations({ [idA]: copy })
    expect(ok.ok).toBe(true)

    // Settings survive a restart.
    const again = new WorkspaceManager(SettingsStore.forDir(userData), () => undefined, { watch: false })
    await again.init()
    expect(again.summaries().map((w) => [w.name, w.status])).toEqual([
      ['Zao', 'ok'],
      ['Chamber', 'ok'],
    ])
    expect(again.summaries()[0].vaultPath).toBe(await (await import('node:fs/promises')).realpath(copy))
    await manager.dispose()
    await again.dispose()
  })

  it('searches across workspaces (Japanese and English) and copies notes independently', async () => {
    const manager = new WorkspaceManager(SettingsStore.forDir(path.join(tmp, 'ud')), () => undefined, { watch: false })
    await manager.init()
    await mkdir(path.join(tmp, 'A'))
    await mkdir(path.join(tmp, 'B'))
    const a = (await manager.addWorkspace(path.join(tmp, 'A'), 'Zao')).workspace!
    const b = (await manager.addWorkspace(path.join(tmp, 'B'), 'Chamber')).workspace!
    await manager.session(a.id)!.execute({ type: 'note.create', title: 'Recharge frequency', body: 'マグマ溜まりへの再注入の頻度' })
    await manager.session(b.id)!.execute({ type: 'note.create', title: 'Recharge frequency', body: 'Injection events modify the thermal evolution.' })
    const hits = manager.searchAll('recharge')
    expect(hits.map((h) => h.workspaceName).sort()).toEqual(['Chamber', 'Zao'])
    expect(manager.searchAll('再注入').map((h) => h.workspaceName)).toEqual(['Zao'])
    const srcId = hits.find((h) => h.workspaceId === a.id)!.noteId
    const copied = await manager.copyNote(a.id, srcId, b.id)
    expect(copied.ok).toBe(true)
    const dst = manager.session(b.id)!.state.notes[copied.noteId!]
    expect(dst.id).not.toBe(srcId)
    expect(dst.title).toBe('Recharge frequency (copy)')
    await manager.dispose()
  })
})

describe('bibliography', () => {
  it('parses entries, reports errors and duplicate keys', () => {
    const bib = parseBibliography(
      `@article{Smith2024, author={Smith, J. and Doe, A. and Roe, B.}, title={Magma recharge}, journal={J. Volc.}, year={2024}, doi={10.1/x}}
@book{Smith2024, title={Dup}, year=2020}
@misc{Tanaka2022, author={田中 太郎}, title={日本語}, date={2022-05-01}}`,
      'references/library.bib',
    )
    expect(bib.entries.map((e) => [e.key, e.author, e.year])).toEqual([
      ['Smith2024', 'Smith et al.', '2024'],
      ['Tanaka2022', '田中 太郎', '2022'],
    ])
    expect(bib.issues.some((i) => i.kind === 'duplicate-key' && i.key === 'Smith2024')).toBe(true)
  })
})

async function snapshotDir(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const f of await readdir(dir)) out[f] = await readFile(path.join(dir, f), 'utf8')
  return out
}
