// Pure domain commands. Main applies them as the single writer; tests apply them directly.
import { pruneCanvas, setGroupPos, setNotePos, updateMainCanvas } from './canvas'
import { checkInvariants } from './invariants'
import {
  allGroups,
  childrenOf,
  detachNode,
  findGroup,
  findNoteLocation,
  findSection,
  insertNode,
  insertNoteInGroup,
  isSectionDescendant,
  removeNoteFromGroups,
  updateChildren,
  updateGroup,
  updateSection,
  type ParentRef,
} from './structure'
import { TITLE_ERROR_MESSAGES, normalizeTitle, uniqueTitle, validateTitle } from './titles'
import type { DomainState, GroupId, GroupNode, Note, NoteId, Point, SectionNode, Viewport } from './types'
import { renameWikiLinks } from '../markdown/wikilink'

export type DropPosition = 'before' | 'after' | 'inside'

export type DropTarget =
  | { kind: 'section' | 'group' | 'note'; id: string; position: DropPosition }
  | { kind: 'unassigned' }
  | { kind: 'root' }

export type Command =
  | {
      type: 'note.create'
      title: string
      body?: string
      tags?: string[]
      groupId?: GroupId
      canvasPos?: Point
    }
  | { type: 'note.rename'; id: NoteId; title: string }
  | { type: 'note.updateBody'; id: NoteId; body: string; baseRev: number | null }
  | { type: 'note.setTags'; id: NoteId; tags: string[] }
  | { type: 'note.archive'; ids: NoteId[] }
  | { type: 'note.unarchive'; ids: NoteId[]; restorePlacement?: boolean }
  | { type: 'note.trash'; ids: NoteId[] }
  | { type: 'note.restore'; note: Omit<Note, 'rev'> }
  | { type: 'note.duplicate'; id: NoteId; canvasPos?: Point }
  | { type: 'note.import'; title: string; body: string; tags: string[]; canvasPos?: Point }
  | { type: 'note.move'; id: NoteId; target: DropTarget }
  | { type: 'section.create'; title: string; parentId: string | null; index?: number }
  | { type: 'section.rename'; id: string; title: string }
  | { type: 'section.delete'; id: string }
  | { type: 'section.move'; id: string; target: DropTarget }
  | { type: 'group.create'; title: string; sectionId: string | null; noteIds?: NoteId[]; canvasPos?: Point }
  | { type: 'group.rename'; id: GroupId; title: string }
  | { type: 'group.delete'; id: GroupId }
  | { type: 'group.move'; id: GroupId; target: DropTarget }
  | { type: 'canvas.setGroupPos'; id: GroupId; pos: Point }
  | { type: 'canvas.setNotePos'; id: NoteId; pos: Point }
  | { type: 'canvas.setGroupExpanded'; ids: GroupId[]; expanded: boolean }
  | { type: 'canvas.setViewport'; viewport: Viewport }
  | { type: 'batch'; label?: string; commands: Command[] }

export type CommandErrorCode = 'title' | 'conflict' | 'not-found' | 'invalid-move' | 'invalid' | 'invariant'

export interface CommandError {
  code: CommandErrorCode
  message: string
}

export interface CommandInfo {
  createdId?: string
  updatedLinks?: number
}

export type CommandResult =
  { ok: true; state: DomainState; info: CommandInfo } | { ok: false; error: CommandError }

export interface CommandContext {
  now: () => string
  newId: () => string
}

/** Commands whose effects are not recorded on the app-level undo stack. */
export function isUndoable(cmd: Command): boolean {
  if (cmd.type === 'batch') return cmd.commands.some(isUndoable)
  return (
    cmd.type !== 'note.updateBody' &&
    cmd.type !== 'canvas.setViewport' &&
    cmd.type !== 'canvas.setGroupExpanded'
  )
}

export function commandLabel(cmd: Command): string {
  if (cmd.type === 'batch') return cmd.label ?? cmd.commands.map(commandLabel)[0] ?? 'batch'
  return cmd.type
}

class CmdError extends Error {
  constructor(
    public code: CommandErrorCode,
    message: string,
  ) {
    super(message)
  }
}

function fail(code: CommandErrorCode, message: string): never {
  throw new CmdError(code, message)
}

function requireNote(state: DomainState, id: NoteId): Note {
  const n = state.notes[id]
  if (!n) fail('not-found', 'メモが見つかりません')
  return n
}

function checkTitle(state: DomainState, title: string, exceptId?: NoteId): string {
  const err = validateTitle(state.notes, title, exceptId)
  if (err) fail('title', TITLE_ERROR_MESSAGES[err])
  return normalizeTitle(title)
}

function nodeTitle(title: string, what: string): string {
  const t = normalizeTitle(title)
  if (!t) fail('invalid', `${what}のタイトルは必須です`)
  return t
}

function putNote(state: DomainState, note: Note): DomainState {
  return { ...state, notes: { ...state.notes, [note.id]: note } }
}

function touch(note: Note, patch: Partial<Note>, now: string): Note {
  return { ...note, ...patch, updatedAt: now, rev: note.rev + 1 }
}

function normalizeTags(tags: string[]): string[] {
  const out: string[] = []
  for (const t of tags) {
    const v = t.normalize('NFC').trim()
    if (v && !out.includes(v)) out.push(v)
  }
  return out
}

function newNote(ctx: CommandContext, title: string, body: string, tags: string[]): Note {
  const now = ctx.now()
  return {
    id: ctx.newId(),
    title,
    body,
    tags: normalizeTags(tags),
    createdAt: now,
    updatedAt: now,
    archived: false,
    lastPlacement: null,
    rev: 1,
  }
}

// ---------------------------------------------------------------------------
// Moves

function resolveSectionTarget(
  state: DomainState,
  movingId: string,
  target: DropTarget,
): { parent: ParentRef; index: number } {
  const s = state.structure
  if (target.kind === 'root') return { parent: { type: 'root' }, index: s.root.children.length }
  if (target.kind === 'unassigned') fail('invalid-move', '章節は未配置領域へ移動できません')
  if (target.kind === 'note') fail('invalid-move', '章節はメモの位置へ移動できません')
  if (target.kind === 'section') {
    if (isSectionDescendant(s, movingId, target.id))
      fail('invalid-move', '章節を自身または子孫の中へ移動できません')
    const loc = findSection(s, target.id)
    if (!loc) fail('not-found', '移動先の章節が見つかりません')
    if (target.position === 'inside')
      return { parent: { type: 'section', id: target.id }, index: loc.section.children.length }
    return { parent: loc.parent, index: loc.index + (target.position === 'after' ? 1 : 0) }
  }
  const gl = findGroup(s, target.id)
  if (!gl) fail('not-found', '移動先が見つかりません')
  if (gl.parent.type !== 'section') fail('invalid-move', '章節を未配置グループの位置へ移動できません')
  if (isSectionDescendant(s, movingId, gl.parent.id))
    fail('invalid-move', '章節を自身の子孫の中へ移動できません')
  return { parent: gl.parent, index: gl.index + (target.position === 'after' ? 1 : 0) }
}

function moveSection(state: DomainState, id: string, target: DropTarget): DomainState {
  const s = state.structure
  const loc = findSection(s, id)
  if (!loc) fail('not-found', '章節が見つかりません')
  const { parent, index } = resolveSectionTarget(state, id, target)
  // Adjust index for removal from the same parent list.
  let idx = index
  if (sameParent(parent, loc.parent) && loc.index < index) idx -= 1
  const [detached, node] = detachNode(s, 'section', id)
  if (!node) fail('not-found', '章節が見つかりません')
  return { ...state, structure: insertNode(detached, parent, idx, node) }
}

function sameParent(a: ParentRef, b: ParentRef): boolean {
  if (a.type !== b.type) return false
  return a.type !== 'section' || a.id === (b as { id: string }).id
}

function moveGroup(state: DomainState, id: GroupId, target: DropTarget): DomainState {
  const s = state.structure
  const gl = findGroup(s, id)
  if (!gl) fail('not-found', 'Paragraph Groupが見つかりません')
  let parent: ParentRef
  let index: number
  if (target.kind === 'unassigned') {
    parent = { type: 'unplaced' }
    index = s.unplacedGroups.length
  } else if (target.kind === 'root') {
    fail('invalid-move', 'Paragraph Groupは章節の中に配置してください')
  } else if (target.kind === 'section') {
    const loc = findSection(s, target.id)
    if (!loc) fail('not-found', '移動先の章節が見つかりません')
    if (target.position === 'inside') {
      parent = { type: 'section', id: target.id }
      index = loc.section.children.length
    } else {
      if (loc.parent.type === 'root') fail('invalid-move', 'Paragraph Groupは章の外に置けません')
      parent = loc.parent
      index = loc.index + (target.position === 'after' ? 1 : 0)
    }
  } else if (target.kind === 'group') {
    if (target.id === id) return state
    const tl = findGroup(s, target.id)
    if (!tl) fail('not-found', '移動先が見つかりません')
    parent = tl.parent
    index = tl.index + (target.position === 'after' ? 1 : 0)
  } else {
    fail('invalid-move', 'Paragraph Groupはメモの位置へ移動できません')
  }
  if (sameParent(parent, gl.parent) && gl.index < index) index -= 1
  const [detached, node] = detachNode(s, 'group', id)
  if (!node) fail('not-found', 'Paragraph Groupが見つかりません')
  return { ...state, structure: insertNode(detached, parent, index, node) }
}

function moveNote(state: DomainState, id: NoteId, target: DropTarget): DomainState {
  const note = requireNote(state, id)
  const s = state.structure
  if (target.kind === 'unassigned') return { ...state, structure: removeNoteFromGroups(s, id) }
  if (note.archived) fail('invalid-move', 'アーカイブ済みのメモは配置できません')
  if (target.kind === 'group') {
    const gl = findGroup(s, target.id)
    if (!gl) fail('not-found', '移動先のParagraph Groupが見つかりません')
    const without = removeNoteFromGroups(s, id)
    const g = findGroup(without, target.id)!.group
    const index = target.position === 'before' ? 0 : g.noteIds.length
    return { ...state, structure: insertNoteInGroup(without, target.id, index, id) }
  }
  if (target.kind === 'note') {
    if (target.id === id) return state
    const tl = findNoteLocation(s, target.id)
    if (!tl) return { ...state, structure: removeNoteFromGroups(s, id) } // dropped among unassigned notes
    const without = removeNoteFromGroups(s, id)
    const g = findGroup(without, tl.group.id)!.group
    const tIndex = g.noteIds.indexOf(target.id)
    return {
      ...state,
      structure: insertNoteInGroup(without, tl.group.id, tIndex + (target.position === 'after' ? 1 : 0), id),
    }
  }
  fail('invalid-move', 'メモはParagraph Groupの中に配置してください')
}

// ---------------------------------------------------------------------------

function apply(state: DomainState, cmd: Command, ctx: CommandContext, info: CommandInfo): DomainState {
  switch (cmd.type) {
    case 'batch': {
      let st = state
      for (const c of cmd.commands) st = apply(st, c, ctx, info)
      return st
    }
    case 'note.create': {
      const title = checkTitle(state, cmd.title)
      const note = newNote(ctx, title, cmd.body ?? '', cmd.tags ?? [])
      info.createdId = note.id
      let st = putNote(state, note)
      if (cmd.groupId) {
        if (!findGroup(st.structure, cmd.groupId)) fail('not-found', 'Paragraph Groupが見つかりません')
        const g = findGroup(st.structure, cmd.groupId)!.group
        st = { ...st, structure: insertNoteInGroup(st.structure, cmd.groupId, g.noteIds.length, note.id) }
      }
      if (cmd.canvasPos) st = setNotePos(st, note.id, cmd.canvasPos)
      return st
    }
    case 'note.import': {
      const title = validateTitle(state.notes, cmd.title)
        ? uniqueTitle(state.notes, normalizeTitle(cmd.title))
        : normalizeTitle(cmd.title)
      if (validateTitle(state.notes, title))
        fail('title', TITLE_ERROR_MESSAGES[validateTitle(state.notes, title)!])
      const note = newNote(ctx, title, cmd.body, cmd.tags)
      info.createdId = note.id
      let st = putNote(state, note)
      if (cmd.canvasPos) st = setNotePos(st, note.id, cmd.canvasPos)
      return st
    }
    case 'note.duplicate': {
      const src = requireNote(state, cmd.id)
      const note = newNote(ctx, uniqueTitle(state.notes, src.title), src.body, src.tags)
      info.createdId = note.id
      let st = putNote(state, note)
      if (cmd.canvasPos) st = setNotePos(st, note.id, cmd.canvasPos)
      return st
    }
    case 'note.rename': {
      const note = requireNote(state, cmd.id)
      const title = checkTitle(state, cmd.title, cmd.id)
      if (title === note.title) return state
      const now = ctx.now()
      const notes = { ...state.notes }
      let updated = 0
      for (const n of Object.values(state.notes)) {
        if (!n.body.includes('[[')) continue
        const r = renameWikiLinks(n.body, note.title, title)
        if (r.count) {
          notes[n.id] = touch(notes[n.id], { body: r.text }, now)
          updated += r.count
        }
      }
      notes[note.id] = touch(notes[note.id], { title }, now)
      info.updatedLinks = updated
      return { ...state, notes }
    }
    case 'note.updateBody': {
      const note = requireNote(state, cmd.id)
      if (cmd.baseRev !== null && cmd.baseRev !== note.rev)
        fail('conflict', 'このメモは別の場所で更新されています。最新の内容を確認してください')
      if (note.body === cmd.body) return state
      return putNote(state, touch(note, { body: cmd.body }, ctx.now()))
    }
    case 'note.setTags': {
      const note = requireNote(state, cmd.id)
      const tags = normalizeTags(cmd.tags)
      if (tags.join('\u0000') === note.tags.join('\u0000')) return state
      return putNote(state, touch(note, { tags }, ctx.now()))
    }
    case 'note.archive': {
      let st = state
      const now = ctx.now()
      for (const id of cmd.ids) {
        const note = requireNote(st, id)
        if (note.archived) continue
        const loc = findNoteLocation(st.structure, id)
        st = { ...st, structure: removeNoteFromGroups(st.structure, id) }
        st = putNote(
          st,
          touch(
            note,
            { archived: true, lastPlacement: loc ? { groupId: loc.group.id, index: loc.index } : null },
            now,
          ),
        )
      }
      return st
    }
    case 'note.unarchive': {
      let st = state
      const now = ctx.now()
      for (const id of cmd.ids) {
        const note = requireNote(st, id)
        if (!note.archived) continue
        st = putNote(st, touch(note, { archived: false, lastPlacement: null }, now))
        const lp = note.lastPlacement
        if (cmd.restorePlacement && lp && findGroup(st.structure, lp.groupId)) {
          st = { ...st, structure: insertNoteInGroup(st.structure, lp.groupId, lp.index, id) }
        }
      }
      return st
    }
    case 'note.trash': {
      let st = state
      for (const id of cmd.ids) {
        requireNote(st, id)
        const notes = { ...st.notes }
        delete notes[id]
        st = { ...st, notes, structure: removeNoteFromGroups(st.structure, id) }
      }
      return pruneCanvas(st, new Set(allGroups(st.structure).map((g) => g.group.id)))
    }
    case 'note.restore': {
      if (state.notes[cmd.note.id]) fail('invalid', '同じIDのメモが既に存在します')
      let title = normalizeTitle(cmd.note.title)
      if (validateTitle(state.notes, title)) title = uniqueTitle(state.notes, title || 'Untitled', 'restored')
      info.createdId = cmd.note.id
      return putNote(state, { ...cmd.note, title, archived: false, lastPlacement: null, rev: 1 })
    }
    case 'note.move':
      return moveNote(state, cmd.id, cmd.target)
    case 'section.create': {
      const title = nodeTitle(cmd.title, '章節')
      const node: SectionNode = { kind: 'section', id: ctx.newId(), title, children: [] }
      info.createdId = node.id
      const parent: ParentRef = cmd.parentId ? { type: 'section', id: cmd.parentId } : { type: 'root' }
      if (cmd.parentId && !findSection(state.structure, cmd.parentId))
        fail('not-found', '親の章節が見つかりません')
      const len = childrenOf(state.structure, parent).length
      return { ...state, structure: insertNode(state.structure, parent, cmd.index ?? len, node) }
    }
    case 'section.rename': {
      const title = nodeTitle(cmd.title, '章節')
      if (!findSection(state.structure, cmd.id)) fail('not-found', '章節が見つかりません')
      return { ...state, structure: updateSection(state.structure, cmd.id, (s) => ({ ...s, title })) }
    }
    case 'section.delete': {
      const loc = findSection(state.structure, cmd.id)
      if (!loc) fail('not-found', '章節が見つかりません')
      // Children move up to the parent at the section's position; groups that would land at the
      // document root go to the unplaced pool. Notes are never deleted.
      const children = loc.section.children
      const liftable = loc.parent.type === 'root' ? children.filter((c) => c.kind === 'section') : children
      const orphanGroups =
        loc.parent.type === 'root' ? (children.filter((c) => c.kind === 'group') as GroupNode[]) : []
      let s = updateChildren(state.structure, loc.parent, (list) => {
        const next = [...list]
        const i = next.findIndex((c) => c.kind === 'section' && c.id === cmd.id)
        next.splice(i, 1, ...liftable)
        return next
      })
      if (orphanGroups.length) s = { ...s, unplacedGroups: [...s.unplacedGroups, ...orphanGroups] }
      return { ...state, structure: s }
    }
    case 'section.move':
      return moveSection(state, cmd.id, cmd.target)
    case 'group.create': {
      const title = nodeTitle(cmd.title, 'Paragraph Group')
      let s = state.structure
      const noteIds: NoteId[] = []
      for (const nid of cmd.noteIds ?? []) {
        const n = requireNote(state, nid)
        if (n.archived) fail('invalid-move', 'アーカイブ済みのメモは配置できません')
        s = removeNoteFromGroups(s, nid)
        noteIds.push(nid)
      }
      const node: GroupNode = { kind: 'group', id: ctx.newId(), title, noteIds }
      info.createdId = node.id
      if (cmd.sectionId) {
        const loc = findSection(s, cmd.sectionId)
        if (!loc) fail('not-found', '章節が見つかりません')
        s = insertNode(s, { type: 'section', id: cmd.sectionId }, loc.section.children.length, node)
      } else s = { ...s, unplacedGroups: [...s.unplacedGroups, node] }
      let st: DomainState = { ...state, structure: s }
      if (cmd.canvasPos) st = setGroupPos(st, node.id, cmd.canvasPos)
      return st
    }
    case 'group.rename': {
      const title = nodeTitle(cmd.title, 'Paragraph Group')
      if (!findGroup(state.structure, cmd.id)) fail('not-found', 'Paragraph Groupが見つかりません')
      return { ...state, structure: updateGroup(state.structure, cmd.id, (g) => ({ ...g, title })) }
    }
    case 'group.delete': {
      if (!findGroup(state.structure, cmd.id)) fail('not-found', 'Paragraph Groupが見つかりません')
      const [s] = detachNode(state.structure, 'group', cmd.id)
      const st = { ...state, structure: s }
      return pruneCanvas(st, new Set(allGroups(s).map((g) => g.group.id)))
    }
    case 'group.move':
      return moveGroup(state, cmd.id, cmd.target)
    case 'canvas.setGroupPos':
      if (!findGroup(state.structure, cmd.id)) fail('not-found', 'Paragraph Groupが見つかりません')
      return setGroupPos(state, cmd.id, roundPoint(cmd.pos))
    case 'canvas.setNotePos':
      requireNote(state, cmd.id)
      return setNotePos(state, cmd.id, roundPoint(cmd.pos))
    case 'canvas.setGroupExpanded':
      return updateMainCanvas(state, (c) => {
        const set = new Set(c.collapsed)
        for (const id of cmd.ids) {
          if (cmd.expanded) set.delete(id)
          else set.add(id)
        }
        return { ...c, collapsed: [...set] }
      })
    case 'canvas.setViewport':
      return updateMainCanvas(state, (c) => ({
        ...c,
        viewport: {
          x: Math.round(cmd.viewport.x),
          y: Math.round(cmd.viewport.y),
          zoom: Math.round(cmd.viewport.zoom * 1000) / 1000,
        },
      }))
  }
}

function roundPoint(p: Point): Point {
  return { x: Math.round(p.x), y: Math.round(p.y) }
}

export function applyCommand(state: DomainState, cmd: Command, ctx: CommandContext): CommandResult {
  const info: CommandInfo = {}
  try {
    const next = apply(state, cmd, ctx, info)
    if (next !== state) {
      const violations = checkInvariants(next)
      if (violations.length)
        return { ok: false, error: { code: 'invariant', message: violations[0].message } }
    }
    return { ok: true, state: next, info }
  } catch (e) {
    if (e instanceof CmdError) return { ok: false, error: { code: e.code, message: e.message } }
    throw e
  }
}
