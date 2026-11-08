// Single definition of the IPC surface: channel names, argument schemas and the typed API.
import { z } from 'zod'
import type { Command, CommandError, CommandInfo } from '../domain/commands'
import type { StatePatch } from '../domain/history'
import type { Reference, TrashEntry, WorkspaceId, WorkspaceSnapshot, WorkspaceSummary, NoteId } from '../domain/types'

export const zId = z.string().min(1).max(64)
const zText = z.string().max(5_000_000)
const zTitle = z.string().max(500)
const zPoint = z.object({ x: z.number().finite(), y: z.number().finite() })
const zPos = z.enum(['before', 'after', 'inside'])
const zTarget = z.union([
  z.object({ kind: z.enum(['section', 'group', 'note']), id: zId, position: zPos }),
  z.object({ kind: z.literal('unassigned') }),
  z.object({ kind: z.literal('root') }),
])
const zTags = z.array(z.string().max(200)).max(200)
const zIds = z.array(zId).min(1).max(10_000)

export const zCommand: z.ZodType<Command> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('note.create'), title: zTitle, body: zText.optional(), tags: zTags.optional(), groupId: zId.optional(), canvasPos: zPoint.optional() }),
    z.object({ type: z.literal('note.rename'), id: zId, title: zTitle }),
    z.object({ type: z.literal('note.updateBody'), id: zId, body: zText, baseRev: z.number().int().nullable() }),
    z.object({ type: z.literal('note.setTags'), id: zId, tags: zTags }),
    z.object({ type: z.literal('note.archive'), ids: zIds }),
    z.object({ type: z.literal('note.unarchive'), ids: zIds, restorePlacement: z.boolean().optional() }),
    z.object({ type: z.literal('note.trash'), ids: zIds }),
    z.object({ type: z.literal('note.duplicate'), id: zId, canvasPos: zPoint.optional() }),
    z.object({ type: z.literal('note.import'), title: zTitle, body: zText, tags: zTags, canvasPos: zPoint.optional() }),
    z.object({ type: z.literal('note.move'), id: zId, target: zTarget }),
    z.object({ type: z.literal('section.create'), title: zTitle, parentId: zId.nullable(), index: z.number().int().min(0).optional() }),
    z.object({ type: z.literal('section.rename'), id: zId, title: zTitle }),
    z.object({ type: z.literal('section.delete'), id: zId }),
    z.object({ type: z.literal('section.move'), id: zId, target: zTarget }),
    z.object({ type: z.literal('group.create'), title: zTitle, sectionId: zId.nullable(), noteIds: z.array(zId).max(10_000).optional(), canvasPos: zPoint.optional() }),
    z.object({ type: z.literal('group.rename'), id: zId, title: zTitle }),
    z.object({ type: z.literal('group.delete'), id: zId }),
    z.object({ type: z.literal('group.move'), id: zId, target: zTarget }),
    z.object({ type: z.literal('canvas.setGroupPos'), id: zId, pos: zPoint }),
    z.object({ type: z.literal('canvas.setNotePos'), id: zId, pos: zPoint }),
    z.object({ type: z.literal('canvas.setGroupExpanded'), ids: zIds, expanded: z.boolean() }),
    z.object({ type: z.literal('canvas.setViewport'), viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().positive().finite() }) }),
    z.object({ type: z.literal('batch'), label: z.string().max(200).optional(), commands: z.array(zCommand).min(1).max(1000) }),
  ]),
) as z.ZodType<Command>

export const zPanes = z.object({ leftOpen: z.boolean(), rightOpen: z.boolean() })

export const zVaultLocations = z.record(zId, z.string().max(4096))

export type CommandResponse =
  | { ok: true; patch: StatePatch; info: CommandInfo; canUndo: boolean; canRedo: boolean; trash: TrashEntry[] }
  | { ok: false; error: CommandError }

export interface InitialState {
  workspaces: WorkspaceSummary[]
  activeWorkspaceId: WorkspaceId | null
  panes: { leftOpen: boolean; rightOpen: boolean }
  version: string
  e2e: boolean
}

export interface GlobalSearchHit {
  workspaceId: WorkspaceId
  workspaceName: string
  noteId: NoteId
  title: string
  snippet: string
  tags: string[]
  score: number
}

export interface VaultValidation {
  ok: boolean
  path: string
  message: string
}

export interface SaveLocationsResult {
  ok: boolean
  results: Record<WorkspaceId, VaultValidation>
  workspaces: WorkspaceSummary[]
}

export interface AddWorkspaceResult {
  ok: boolean
  message: string
  workspace?: WorkspaceSummary
  workspaces: WorkspaceSummary[]
}

export type WorkspaceEvent =
  | { type: 'external-change'; workspaceId: WorkspaceId; patch: StatePatch; changedNoteIds: NoteId[]; message: string }
  | { type: 'reloaded'; workspaceId: WorkspaceId; snapshot: WorkspaceSnapshot; message: string }
  | { type: 'bibliography'; workspaceId: WorkspaceId; snapshot: WorkspaceSnapshot }
  | { type: 'error'; workspaceId: WorkspaceId; message: string }

export interface FacetApi {
  getInitialState(): Promise<InitialState>
  openWorkspace(id: WorkspaceId): Promise<{ ok: true; snapshot: WorkspaceSnapshot } | { ok: false; message: string }>
  execute(id: WorkspaceId, cmd: Command): Promise<CommandResponse>
  undo(id: WorkspaceId): Promise<CommandResponse>
  redo(id: WorkspaceId): Promise<CommandResponse>
  restoreFromTrash(id: WorkspaceId, noteId: NoteId): Promise<CommandResponse>
  copyNoteToWorkspace(from: WorkspaceId, noteId: NoteId, to: WorkspaceId): Promise<{ ok: boolean; message: string; noteId?: NoteId }>
  searchAll(query: string): Promise<GlobalSearchHit[]>
  exportManuscript(id: WorkspaceId, markdown: string): Promise<{ ok: boolean; message: string; path?: string }>
  copyText(text: string): Promise<void>
  reloadBibliography(id: WorkspaceId): Promise<WorkspaceSnapshot | null>
  chooseBibliography(id: WorkspaceId): Promise<WorkspaceSnapshot | null>
  openBibliographyFolder(id: WorkspaceId): Promise<void>
  browseFolder(defaultPath?: string): Promise<string | null>
  validateVaultPath(id: WorkspaceId, path: string): Promise<VaultValidation>
  saveVaultLocations(paths: Record<WorkspaceId, string>): Promise<SaveLocationsResult>
  addWorkspace(path: string, name: string): Promise<AddWorkspaceResult>
  removeWorkspace(id: WorkspaceId): Promise<WorkspaceSummary[]>
  setPanes(panes: { leftOpen: boolean; rightOpen: boolean }): Promise<void>
  setActiveWorkspace(id: WorkspaceId): Promise<void>
  onWorkspaceEvent(cb: (e: WorkspaceEvent) => void): () => void
}

export { CH } from './channels'

export type { Reference }
