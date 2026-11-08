// On-disk schemas (zod). Every file FACET reads is validated before use.
import { z } from 'zod'
import type { GroupNode, SectionNode } from '../../shared/domain/types'

export const zProject = z.object({
  schemaVersion: z.literal(1),
  workspaceId: z.string().min(1).max(64),
  name: z.string().min(1).max(500),
  createdAt: z.string(),
  bibliography: z.string().max(4096).optional(),
})
export type ProjectFile = z.infer<typeof zProject>

export const zNoteMeta = z.object({
  file: z.string().min(1).max(1024),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  archived: z.boolean().default(false),
  lastPlacement: z.object({ groupId: z.string(), index: z.number().int().min(0) }).nullable().default(null),
})
export type NoteMetaFile = z.infer<typeof zNoteMeta>

export const zNotesIndex = z.object({
  schemaVersion: z.literal(1),
  notes: z.record(z.string(), zNoteMeta),
})
export type NotesIndexFile = z.infer<typeof zNotesIndex>

const zGroup: z.ZodType<GroupNode> = z.object({
  kind: z.literal('group'),
  id: z.string().min(1),
  title: z.string(),
  noteIds: z.array(z.string()),
})

const zSection: z.ZodType<SectionNode> = z.lazy(() =>
  z.object({
    kind: z.literal('section'),
    id: z.string().min(1),
    title: z.string(),
    children: z.array(z.union([zSection, zGroup])),
  }),
) as z.ZodType<SectionNode>

export const zStructure = z.object({
  schemaVersion: z.literal(1),
  root: z.object({ children: z.array(z.union([zSection, zGroup])) }),
  unplacedGroups: z.array(zGroup).default([]),
})

const zPoint = z.object({ x: z.number(), y: z.number() })

export const zCanvasState = z.object({
  schemaVersion: z.literal(1),
  canvases: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).nullable().default(null),
        groups: z.record(z.string(), zPoint).default({}),
        collapsed: z.array(z.string()).default([]),
        looseNotes: z.record(z.string(), zPoint).default({}),
      }),
    )
    .min(1),
})

export const zTrashIndex = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      deletedAt: z.string(),
      file: z.string(),
      meta: zNoteMeta,
    }),
  ),
})
export type TrashIndexFile = z.infer<typeof zTrashIndex>

export const zSettings = z.object({
  schemaVersion: z.literal(1),
  workspaces: z.array(z.object({ id: z.string().min(1), name: z.string(), vaultPath: z.string() })).default([]),
  lastWorkspaceId: z.string().nullable().default(null),
  panes: z.object({ leftOpen: z.boolean(), rightOpen: z.boolean() }).default({ leftOpen: true, rightOpen: true }),
  window: z
    .object({
      bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
      maximized: z.boolean(),
    })
    .default({ bounds: null, maximized: false }),
})
export type SettingsFile = z.infer<typeof zSettings>
