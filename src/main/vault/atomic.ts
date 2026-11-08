// Crash-safe file writes: temp file + fsync + rename, with retries for transient Windows locks.
import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, stat, readFile } from 'node:fs/promises'
import path from 'node:path'

export const TMP_SUFFIX = '.facet-tmp'

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Retry EPERM/EBUSY/EACCES (antivirus scanners and indexers briefly lock files on Windows). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let delay = 40
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i >= attempts - 1 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw e
      await sleep(delay)
      delay *= 2
    }
  }
}

export async function writeDurable(file: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const fh = await open(file, 'w')
  try {
    await fh.writeFile(content)
    await fh.sync()
  } finally {
    await fh.close()
  }
}

export async function writeFileAtomic(file: string, content: string | Buffer): Promise<void> {
  const tmp = file + TMP_SUFFIX
  await writeDurable(tmp, content)
  try {
    await withRetry(() => rename(tmp, file))
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

export interface FileStamp {
  mtimeMs: number
  size: number
  hash: string
}

export async function stampOf(file: string): Promise<FileStamp | null> {
  try {
    const st = await stat(file)
    const buf = await readFile(file)
    return { mtimeMs: st.mtimeMs, size: st.size, hash: sha256(buf) }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}
