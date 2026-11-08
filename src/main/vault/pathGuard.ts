// Resolve vault-relative paths safely: no absolute paths, no "..", no symlink/junction escapes.
import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'

export class PathGuardError extends Error {}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function validateRelative(rel: string): string {
  if (!rel || rel.includes('\0')) throw new PathGuardError('Invalid path')
  const norm = rel.replace(/\\/g, '/')
  if (path.isAbsolute(norm) || /^[a-zA-Z]:/.test(norm) || norm.startsWith('/')) throw new PathGuardError('Absolute paths are not allowed')
  const parts = norm.split('/')
  if (parts.some((p) => p === '..' || p === '')) throw new PathGuardError('Path traversal is not allowed')
  return parts.join(path.sep)
}

/**
 * Resolve `rel` under `realRoot` (which must already be a realpath). Every existing component is
 * checked so that a symlink or junction inside the vault cannot redirect I/O outside it.
 */
export async function resolveInVault(realRoot: string, rel: string): Promise<string> {
  const safe = validateRelative(rel)
  const abs = path.join(realRoot, safe)
  if (!isInside(realRoot, abs)) throw new PathGuardError('Path escapes the vault')
  let current = realRoot
  for (const part of safe.split(path.sep)) {
    current = path.join(current, part)
    let st
    try {
      st = await lstat(current)
    } catch {
      break // does not exist yet; the remaining components will be created inside current parent
    }
    if (st.isSymbolicLink()) {
      const target = await realpath(current)
      if (!isInside(realRoot, target)) throw new PathGuardError('Symbolic link or junction escapes the vault')
      throw new PathGuardError('Symbolic links and junctions inside the vault are not followed')
    }
  }
  return abs
}

export async function realRootOf(dir: string): Promise<string> {
  return realpath(path.resolve(dir))
}
