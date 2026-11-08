// Write-ahead journal for multi-file updates (ADR-015). Leftover journals are rolled back on open.
import { copyFile, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { newId } from '../../shared/domain/ids'
import { TMP_SUFFIX, exists, withRetry, writeDurable } from './atomic'

export const JOURNAL_DIR = path.join('.facet', 'journal')

export type JournalOp =
  | { type: 'write'; target: string; tmp: string; backup: string | null }
  | { type: 'move'; from: string; to: string }

interface JournalFile {
  id: string
  createdAt: string
  ops: JournalOp[]
}

export interface PlannedWrite {
  type: 'write'
  abs: string
  content: string
}
export interface PlannedMove {
  type: 'move'
  from: string
  to: string
}
export type PlannedOp = PlannedWrite | PlannedMove

/** Fault injection for tests: throw after the n-th applied op. */
export const journalTestHooks: { failAfterOps: number | null } = { failAfterOps: null }

export async function runTransaction(root: string, ops: PlannedOp[]): Promise<void> {
  const id = newId()
  const dir = path.join(root, JOURNAL_DIR)
  const backupDir = path.join(dir, id)
  await mkdir(backupDir, { recursive: true })
  const jops: JournalOp[] = []
  // 1. Prepare: write every new content to a temp file and back up every file we will replace.
  let n = 0
  for (const op of ops) {
    if (op.type === 'write') {
      const tmp = op.abs + TMP_SUFFIX
      await writeDurable(tmp, op.content)
      let backup: string | null = null
      if (await exists(op.abs)) {
        backup = path.join(backupDir, `${n++}.bak`)
        await copyFile(op.abs, backup)
      }
      jops.push({ type: 'write', target: op.abs, tmp, backup })
    } else {
      jops.push({ type: 'move', from: op.from, to: op.to })
    }
  }
  const journalPath = path.join(dir, `${id}.json`)
  const journal: JournalFile = { id, createdAt: new Date().toISOString(), ops: jops }
  await writeDurable(journalPath, JSON.stringify(journal))
  // 2. Apply.
  try {
    let applied = 0
    for (const op of jops) {
      if (op.type === 'write') await withRetry(() => rename(op.tmp, op.target))
      else {
        await mkdir(path.dirname(op.to), { recursive: true })
        await withRetry(() => rename(op.from, op.to))
      }
      applied++
      if (journalTestHooks.failAfterOps !== null && applied >= journalTestHooks.failAfterOps) throw new Error('Injected failure')
    }
  } catch (e) {
    await rollbackJournal(journalPath)
    throw e
  }
  // 3. Commit: drop the journal.
  await rm(journalPath, { force: true })
  await rm(backupDir, { recursive: true, force: true })
}

async function rollbackJournal(journalPath: string): Promise<void> {
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as JournalFile
  for (const op of [...journal.ops].reverse()) {
    if (op.type === 'write') {
      if (op.backup && (await exists(op.backup))) await withRetry(() => copyFile(op.backup!, op.target))
      else if (!op.backup) await rm(op.target, { force: true })
      await rm(op.tmp, { force: true })
    } else if ((await exists(op.to)) && !(await exists(op.from))) {
      await withRetry(() => rename(op.to, op.from))
    }
  }
  await rm(journalPath, { force: true })
  await rm(path.join(path.dirname(journalPath), journal.id), { recursive: true, force: true })
}

/** Roll back every unfinished transaction. Returns the number of journals recovered. */
export async function recoverJournals(root: string): Promise<number> {
  const dir = path.join(root, JOURNAL_DIR)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return 0
  }
  let n = 0
  for (const e of entries) {
    if (!e.endsWith('.json')) continue
    await rollbackJournal(path.join(dir, e))
    n++
  }
  return n
}
