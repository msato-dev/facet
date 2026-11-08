// Write-ahead journal for multi-file updates (ADR-015, ADR-028). Leftover journals are rolled back on open.
//
// A journal lives inside the vault and can be edited by anyone who can edit the vault, so it is
// untrusted input: it is schema-checked, stores only vault-relative paths, and every path is
// resolved with resolveInVault before any file operation. A journal that fails these checks is
// never executed; it is moved to .facet/journal-quarantine together with its backups.
import { copyFile, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { newId } from '../../shared/domain/ids'
import { TMP_SUFFIX, exists, withRetry, writeDurable } from './atomic'
import { resolveInVault } from './pathGuard'

export const JOURNAL_DIR = '.facet/journal'
export const QUARANTINE_DIR = '.facet/journal-quarantine'

const zJournalId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const zRel = z.string().min(1).max(1024)

/** Current format: vault-relative paths; temp and backup locations are derived, not stored. */
const zJournal = z
  .object({
    schemaVersion: z.literal(2),
    id: zJournalId,
    createdAt: z.string().max(64),
    ops: z
      .array(
        z.discriminatedUnion('type', [
          z
            .object({ type: z.literal('write'), target: zRel, backup: z.number().int().min(0).nullable() })
            .strict(),
          z.object({ type: z.literal('move'), from: zRel, to: zRel }).strict(),
        ]),
      )
      .max(100_000),
  })
  .strict()

/** FACET 0.1.0 format: absolute paths. Accepted only when it converts to the current format. */
const zLegacyJournal = z.object({
  id: zJournalId,
  createdAt: z.string().max(64),
  ops: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('write'),
          target: z.string(),
          tmp: z.string(),
          backup: z.string().nullable(),
        }),
        z.object({ type: z.literal('move'), from: z.string(), to: z.string() }),
      ]),
    )
    .max(100_000),
})

type JournalFile = z.infer<typeof zJournal>
type JournalOp = JournalFile['ops'][number]

export interface PlannedWrite {
  type: 'write'
  /** Vault-relative path (forward slashes). */
  rel: string
  content: string
}
export interface PlannedMove {
  type: 'move'
  from: string
  to: string
}
export type PlannedOp = PlannedWrite | PlannedMove

export class JournalError extends Error {}

/** Fault injection for tests: throw after the n-th applied op. */
export const journalTestHooks: { failAfterOps: number | null } = { failAfterOps: null }

const backupRel = (id: string, n: number) => `${JOURNAL_DIR}/${id}/${n}.bak`

function normRel(rel: string): string {
  return rel.replace(/\\/g, '/')
}

/** Ops may touch vault files, never the journal machinery itself. */
function assertOpTarget(rel: string): void {
  const r = normRel(rel).toLowerCase()
  if (r === '.facet/journal' || r.startsWith('.facet/journal/') || r.startsWith('.facet/journal-quarantine'))
    throw new JournalError(`journal op targets the journal folder: ${rel}`)
}

export async function runTransaction(root: string, ops: PlannedOp[]): Promise<void> {
  const id = newId()
  const backupDir = await resolveInVault(root, `${JOURNAL_DIR}/${id}`)
  await mkdir(backupDir, { recursive: true })
  const jops: JournalOp[] = []
  const resolved: Array<{ tmp: string; target: string } | { from: string; to: string }> = []
  // 1. Prepare: write every new content to a temp file and back up every file we will replace.
  let n = 0
  for (const op of ops) {
    if (op.type === 'write') {
      const rel = normRel(op.rel)
      assertOpTarget(rel)
      const target = await resolveInVault(root, rel)
      const tmp = await resolveInVault(root, rel + TMP_SUFFIX)
      await writeDurable(tmp, op.content)
      let backup: number | null = null
      if (await exists(target)) {
        backup = n++
        await copyFile(target, await resolveInVault(root, backupRel(id, backup)))
      }
      jops.push({ type: 'write', target: rel, backup })
      resolved.push({ tmp, target })
    } else {
      const from = normRel(op.from)
      const to = normRel(op.to)
      assertOpTarget(from)
      assertOpTarget(to)
      jops.push({ type: 'move', from, to })
      resolved.push({ from: await resolveInVault(root, from), to: await resolveInVault(root, to) })
    }
  }
  const journalPath = await resolveInVault(root, `${JOURNAL_DIR}/${id}.json`)
  const journal: JournalFile = { schemaVersion: 2, id, createdAt: new Date().toISOString(), ops: jops }
  await writeDurable(journalPath, JSON.stringify(journal))
  // 2. Apply.
  try {
    let applied = 0
    for (const op of resolved) {
      if ('tmp' in op) await withRetry(() => rename(op.tmp, op.target))
      else {
        await mkdir(path.dirname(op.to), { recursive: true })
        await withRetry(() => rename(op.from, op.to))
      }
      applied++
      if (journalTestHooks.failAfterOps !== null && applied >= journalTestHooks.failAfterOps)
        throw new Error('Injected failure')
    }
  } catch (e) {
    await rollback(root, journal)
    throw e
  }
  // 3. Commit: drop the journal.
  await rm(journalPath, { force: true })
  await rm(backupDir, { recursive: true, force: true })
}

/** Parse and validate a journal; throws JournalError when it must not be executed. */
async function readJournal(root: string, fileName: string, text: string): Promise<JournalFile> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new JournalError('journal is not valid JSON')
  }
  let journal: JournalFile
  const current = zJournal.safeParse(data)
  if (current.success) journal = current.data
  else {
    const legacy = zLegacyJournal.safeParse(data)
    if (!legacy.success) throw new JournalError('journal does not match the schema')
    journal = convertLegacy(root, legacy.data)
  }
  if (fileName !== `${journal.id}.json`) throw new JournalError('journal file name does not match its id')
  // Every path must resolve inside the vault (no "..", absolute paths, symlinks or junctions).
  try {
    for (const op of journal.ops) {
      if (op.type === 'write') {
        assertOpTarget(op.target)
        await resolveInVault(root, op.target)
        await resolveInVault(root, op.target + TMP_SUFFIX)
        if (op.backup !== null) await resolveInVault(root, backupRel(journal.id, op.backup))
      } else {
        assertOpTarget(op.from)
        assertOpTarget(op.to)
        await resolveInVault(root, op.from)
        await resolveInVault(root, op.to)
      }
    }
  } catch (e) {
    throw new JournalError(`journal path rejected: ${(e as Error).message}`)
  }
  return journal
}

function convertLegacy(root: string, legacy: z.infer<typeof zLegacyJournal>): JournalFile {
  const toRel = (abs: string): string => {
    if (!path.isAbsolute(abs)) throw new JournalError('legacy journal path is not absolute')
    const rel = path.relative(root, abs)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
      throw new JournalError('legacy journal path escapes the vault')
    return normRel(rel)
  }
  const ops: JournalOp[] = legacy.ops.map((op) => {
    if (op.type === 'move') return { type: 'move', from: toRel(op.from), to: toRel(op.to) }
    const target = toRel(op.target)
    if (toRel(op.tmp) !== target + TMP_SUFFIX)
      throw new JournalError('legacy journal temp path is unexpected')
    let backup: number | null = null
    if (op.backup !== null) {
      const m = new RegExp(`^${JOURNAL_DIR}/${legacy.id}/(\\d+)\\.bak$`).exec(toRel(op.backup))
      if (!m) throw new JournalError('legacy journal backup path is unexpected')
      backup = Number(m[1])
    }
    return { type: 'write', target, backup }
  })
  return { schemaVersion: 2, id: legacy.id, createdAt: legacy.createdAt, ops }
}

async function rollback(root: string, journal: JournalFile): Promise<void> {
  for (const op of [...journal.ops].reverse()) {
    if (op.type === 'write') {
      const target = await resolveInVault(root, op.target)
      const tmp = await resolveInVault(root, op.target + TMP_SUFFIX)
      if (op.backup !== null) {
        const backup = await resolveInVault(root, backupRel(journal.id, op.backup))
        if (await exists(backup)) await withRetry(() => copyFile(backup, target))
      } else await rm(target, { force: true })
      await rm(tmp, { force: true })
    } else {
      const from = await resolveInVault(root, op.from)
      const to = await resolveInVault(root, op.to)
      if ((await exists(to)) && !(await exists(from))) {
        await mkdir(path.dirname(from), { recursive: true })
        await withRetry(() => rename(to, from))
      }
    }
  }
  await rm(await resolveInVault(root, `${JOURNAL_DIR}/${journal.id}.json`), { force: true })
  await rm(await resolveInVault(root, `${JOURNAL_DIR}/${journal.id}`), { recursive: true, force: true })
}

/** Move a rejected journal (and its backup folder, if any) out of the way without executing it. */
async function quarantine(root: string, fileName: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destDir = await resolveInVault(root, `${QUARANTINE_DIR}/${stamp}`)
  await mkdir(destDir, { recursive: true })
  const names = [fileName]
  const stem = fileName.slice(0, -'.json'.length)
  if (zJournalId.safeParse(stem).success) names.push(stem)
  for (const name of names) {
    const src = path.join(await resolveInVault(root, JOURNAL_DIR), name)
    if (await exists(src)) await withRetry(() => rename(src, path.join(destDir, name)))
  }
  return `${QUARANTINE_DIR}/${stamp}`
}

export interface JournalRecovery {
  recovered: number
  /** Vault-relative folders that received rejected journals. */
  quarantined: string[]
}

/** Roll back every unfinished transaction; quarantine journals that fail validation. */
export async function recoverJournals(root: string): Promise<JournalRecovery> {
  const result: JournalRecovery = { recovered: 0, quarantined: [] }
  let dir: string
  try {
    dir = await resolveInVault(root, JOURNAL_DIR)
  } catch {
    // .facet or .facet/journal is a link out of the vault: never touch it.
    throw new JournalError('.facet/journal はリンクのため使用できません。Vault の構成を確認してください')
  }
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return result
  }
  for (const e of entries) {
    if (!e.endsWith('.json')) continue
    let journal: JournalFile
    try {
      const text = await readFile(await resolveInVault(root, `${JOURNAL_DIR}/${e}`), 'utf8')
      journal = await readJournal(root, e, text)
    } catch {
      // Unreadable, malformed, or pointing outside the vault: never execute it.
      result.quarantined.push(await quarantine(root, e))
      continue
    }
    await rollback(root, journal)
    result.recovered++
  }
  return result
}

/** Report pending journals without touching anything (read-only validation of a vault). */
export async function pendingJournals(root: string): Promise<number> {
  try {
    const dir = await resolveInVault(root, JOURNAL_DIR)
    return (await readdir(dir)).filter((e) => e.endsWith('.json')).length
  } catch {
    return 0
  }
}
