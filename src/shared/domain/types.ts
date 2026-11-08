// Core domain types shared by Main and Renderer. Pure data, no Node/DOM dependencies.

export type NoteId = string
export type SectionId = string
export type GroupId = string
export type WorkspaceId = string

export interface Placement {
  groupId: GroupId
  index: number
}

export interface Note {
  id: NoteId
  title: string
  body: string
  tags: string[]
  createdAt: string
  updatedAt: string
  archived: boolean
  /** Placement remembered when a placed note is archived (ADR-011). */
  lastPlacement: Placement | null
  /** In-memory revision, bumped on every change (including external edits). Not persisted. */
  rev: number
}

export interface GroupNode {
  kind: 'group'
  id: GroupId
  title: string
  noteIds: NoteId[]
}

export interface SectionNode {
  kind: 'section'
  id: SectionId
  title: string
  children: Array<SectionNode | GroupNode>
}

export interface Structure {
  schemaVersion: 1
  root: { children: SectionNode[] }
  /** Paragraph Groups not yet placed in any section (ADR-008). Never exported to the manuscript. */
  unplacedGroups: GroupNode[]
}

export interface Point {
  x: number
  y: number
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface CanvasData {
  id: string
  name: string
  viewport: Viewport | null
  groups: Record<GroupId, Point>
  /** Groups shown collapsed on the canvas (default: expanded). */
  collapsed: GroupId[]
  looseNotes: Record<NoteId, Point>
}

export interface CanvasState {
  schemaVersion: 1
  /** Kept as an array for future multi-canvas support; the MVP UI always uses canvases[0]. */
  canvases: CanvasData[]
}

export interface DomainState {
  notes: Record<NoteId, Note>
  structure: Structure
  canvas: CanvasState
}

export interface Reference {
  key: string
  type: string
  author: string
  year: string
  title: string
  container: string
  doi: string
}

export interface BibIssue {
  kind: 'parse-error' | 'duplicate-key' | 'missing-file' | 'read-error'
  message: string
  line?: number
  key?: string
}

export interface BibliographyState {
  /** Path as configured (relative to the vault, or absolute when chosen via dialog). */
  source: string
  entries: Reference[]
  issues: BibIssue[]
  loadedAt: string | null
}

export interface VaultIssue {
  kind:
    'missing-note-file' | 'imported-orphan' | 'missing-title' | 'invalid-structure-ref' | 'recovered-journal'
  message: string
  noteId?: NoteId
}

export interface TrashEntry {
  id: NoteId
  title: string
  deletedAt: string
}

export interface WorkspaceSnapshot {
  id: WorkspaceId
  name: string
  vaultPath: string
  state: DomainState
  bibliography: BibliographyState
  issues: VaultIssue[]
  trash: TrashEntry[]
  canUndo: boolean
  canRedo: boolean
}

export interface WorkspaceSummary {
  id: WorkspaceId
  name: string
  vaultPath: string
  status: 'ok' | 'error'
  error?: string
}
