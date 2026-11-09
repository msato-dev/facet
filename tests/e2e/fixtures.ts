// Builds sample vaults (data from the UI mock) as plain files, plus helpers to launch FACET.
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let seq = 0
function id(prefix: string): string {
  seq++
  return `${prefix}${String(seq).padStart(26 - prefix.length, '0')}`.toLowerCase()
}

interface NoteSpec {
  key: string
  title: string
  body: string
  tags: string[]
}
interface GroupSpec {
  key: string
  title: string
  notes: string[]
  x: number
  y: number
}
interface SectionSpec {
  key: string
  title: string
  groups?: GroupSpec[]
  subs?: SectionSpec[]
}
interface VaultSpec {
  name: string
  notes: NoteSpec[]
  sections: SectionSpec[]
  bib: string
}

export const ZAO: VaultSpec = {
  name: 'Zao · Diffusion Chronometry',
  notes: [
    {
      key: 'n1',
      title: 'Reverse zoning',
      body: 'Reverse zoning in plagioclase records changes in magma conditions.',
      tags: ['Petrology', 'Zoning'],
    },
    {
      key: 'n2',
      title: 'Diffusion timescales',
      body: 'Diffusion timescales become progressively shorter toward eruption.',
      tags: ['Diffusion'],
    },
    {
      key: 'n3',
      title: 'Recharge frequency',
      body: 'This pattern may indicate an increasing frequency of magma recharge. See also [[Mush reactivation]].',
      tags: ['Recharge', 'Diffusion'],
    },
    {
      key: 'n4',
      title: 'Mush reactivation',
      body: 'Repeated thermal inputs can reactivate a crystal-rich mush [@Smith2024].',
      tags: ['Recharge', 'Modeling'],
    },
    {
      key: 'n5',
      title: 'Temperature uncertainty',
      body: 'Temperature uncertainty influences the estimated diffusion timescales.',
      tags: ['Diffusion', 'Uncertainty'],
    },
    {
      key: 'n6',
      title: 'Research motivation',
      body: 'Constraining the timescales of pre-eruptive processes improves our understanding of volcanic unrest.',
      tags: ['Introduction'],
    },
    {
      key: 'n7',
      title: 'Analytical procedure',
      body: 'Zoning profiles were examined using electron microprobe analyses.',
      tags: ['Methods'],
    },
    {
      key: 'n8',
      title: 'Previous work',
      body: 'Previous work has established a link between zoning and recharge [@Tanaka2022].',
      tags: ['Literature'],
    },
    {
      key: 'n9',
      title: 'Unplaced insight',
      body: 'A possible alternative interpretation to revisit before writing.\nLine two of the note.\nLine three.\nLine four.\nLine five.\nLine six should be clipped.\nLine seven.',
      tags: ['Ideas'],
    },
    {
      key: 'n10',
      title: '蔵王の噴火史',
      body: '蔵王火山の最新期の噴火活動について整理する。',
      tags: ['日本語'],
    },
  ],
  sections: [
    {
      key: 'intro',
      title: 'Introduction',
      subs: [
        {
          key: 'background',
          title: 'Background',
          groups: [{ key: 'p1', title: 'Research background', notes: ['n6', 'n8'], x: 120, y: 100 }],
        },
      ],
    },
    {
      key: 'methods',
      title: 'Methods',
      groups: [{ key: 'p2', title: 'Analytical methods', notes: ['n7'], x: 600, y: 155 }],
    },
    {
      key: 'results',
      title: 'Results',
      subs: [
        {
          key: 'zoning',
          title: 'Zoning patterns',
          groups: [{ key: 'p3', title: 'Zoning observations', notes: ['n1'], x: 145, y: 520 }],
        },
        {
          key: 'times',
          title: 'Diffusion timescales',
          groups: [{ key: 'p4', title: 'Diffusion results', notes: ['n2', 'n5'], x: 565, y: 560 }],
        },
      ],
    },
    {
      key: 'discussion',
      title: 'Discussion',
      subs: [
        {
          key: 'recharge',
          title: 'Magma recharge',
          groups: [{ key: 'p5', title: 'Recharge interpretation', notes: ['n3', 'n4'], x: 1000, y: 135 }],
        },
      ],
    },
    { key: 'conclusion', title: 'Conclusions' },
  ],
  bib: `@article{Smith2024,
  author = {Smith, John and Doe, Anna and Roe, Brian},
  title = {Magma recharge and crystal mush reactivation},
  journal = {Journal of Volcanology},
  year = {2024},
  doi = {10.1000/jv.2024.1}
}
@article{Tanaka2022,
  author = {Tanaka, Ken and Sato, Mai},
  title = {Plagioclase zoning and magma dynamics},
  journal = {Contributions to Mineralogy and Petrology},
  year = {2022}
}
`,
}

export const CHAMBER: VaultSpec = {
  name: 'Magma Chamber · Thermal Modeling',
  notes: [
    {
      key: 'm1',
      title: 'Enthalpy formulation',
      body: 'The enthalpy method incorporates the latent heat released during crystallization.',
      tags: ['Modeling', 'Thermal'],
    },
    {
      key: 'm2',
      title: 'Cooling timescales',
      body: 'Cooling timescales depend on chamber geometry and boundary conditions.',
      tags: ['Thermal'],
    },
    {
      key: 'm3',
      title: 'Recharge frequency',
      body: 'Injection events modify the thermal evolution of the reservoir.',
      tags: ['Recharge'],
    },
    {
      key: 'm4',
      title: 'Unplaced model assumption',
      body: 'Test sensitivity to the initial geotherm.',
      tags: ['Modeling'],
    },
  ],
  sections: [
    { key: 'intro', title: 'Introduction' },
    {
      key: 'methods',
      title: 'Methods',
      subs: [
        {
          key: 'fvm',
          title: 'Numerical model',
          groups: [{ key: 'q1', title: 'Model formulation', notes: ['m1', 'm2'], x: 180, y: 150 }],
        },
      ],
    },
    {
      key: 'discussion',
      title: 'Discussion',
      groups: [{ key: 'q2', title: 'Injection conditions', notes: ['m3'], x: 620, y: 350 }],
    },
  ],
  bib: `@article{Annen2008, author={Annen, C.}, title={The geodynamics of igneous bodies}, journal={Journal of Petrology}, year={2008}}\n`,
}

export interface BuiltVault {
  dir: string
  workspaceId: string
  noteIds: Record<string, string>
  groupIds: Record<string, string>
  sectionIds: Record<string, string>
}

export async function buildVault(root: string, folder: string, spec: VaultSpec): Promise<BuiltVault> {
  const dir = path.join(root, folder)
  await mkdir(path.join(dir, 'notes'), { recursive: true })
  await mkdir(path.join(dir, 'references'), { recursive: true })
  const workspaceId = id('w')
  const noteIds: Record<string, string> = {}
  const groupIds: Record<string, string> = {}
  const sectionIds: Record<string, string> = {}
  const index: Record<string, unknown> = {}
  let t = Date.UTC(2026, 0, 1)
  for (const n of spec.notes) {
    const nid = id('n')
    noteIds[n.key] = nid
    await writeFile(path.join(dir, 'notes', `${nid}.md`), `# ${n.title}\n\n${n.body}`)
    const at = new Date((t += 60_000)).toISOString()
    index[nid] = {
      file: `notes/${nid}.md`,
      tags: n.tags,
      createdAt: at,
      updatedAt: at,
      archived: false,
      lastPlacement: null,
    }
  }
  const positions: Record<string, { x: number; y: number }> = {}
  const section = (s: SectionSpec): unknown => {
    const sid = id('s')
    sectionIds[s.key] = sid
    const children: unknown[] = []
    for (const g of s.groups ?? []) {
      const gid = id('g')
      groupIds[g.key] = gid
      positions[gid] = { x: g.x, y: g.y }
      children.push({ kind: 'group', id: gid, title: g.title, noteIds: g.notes.map((k) => noteIds[k]) })
    }
    for (const sub of s.subs ?? []) children.push(section(sub))
    return { kind: 'section', id: sid, title: s.title, children }
  }
  const structure = { schemaVersion: 1, root: { children: spec.sections.map(section) }, unplacedGroups: [] }
  await writeFile(
    path.join(dir, 'project.yml'),
    `schemaVersion: 1\nworkspaceId: ${workspaceId}\nname: "${spec.name}"\ncreatedAt: "2026-01-01T00:00:00.000Z"\n`,
  )
  await writeFile(
    path.join(dir, 'notes-index.json'),
    JSON.stringify({ schemaVersion: 1, notes: index }, null, 2),
  )
  await writeFile(path.join(dir, 'structure.json'), JSON.stringify(structure, null, 2))
  await writeFile(
    path.join(dir, 'canvas-state.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        canvases: [
          {
            id: 'main',
            name: 'Main Canvas',
            viewport: null,
            groups: positions,
            collapsed: [],
            looseNotes: {},
          },
        ],
      },
      null,
      2,
    ),
  )
  await writeFile(path.join(dir, 'references', 'library.bib'), spec.bib)
  return { dir, workspaceId, noteIds, groupIds, sectionIds }
}

export interface Env {
  root: string
  userData: string
  zao: BuiltVault
  chamber: BuiltVault
}

/** Temp root with two registered workspaces (settings.json pre-populated). */
export async function setupEnv(): Promise<Env> {
  const root = await mkdtemp(path.join(tmpdir(), 'facet-e2e-'))
  const userData = path.join(root, 'userData')
  await mkdir(userData, { recursive: true })
  const zao = await buildVault(root, 'zao', ZAO)
  const chamber = await buildVault(root, 'chamber', CHAMBER)
  await writeFile(
    path.join(userData, 'settings.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaces: [
        { id: zao.workspaceId, name: ZAO.name, vaultPath: zao.dir },
        { id: chamber.workspaceId, name: CHAMBER.name, vaultPath: chamber.dir },
      ],
      lastWorkspaceId: zao.workspaceId,
      panes: { leftOpen: true, rightOpen: true },
      window: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, maximized: false },
    }),
  )
  return { root, userData, zao, chamber }
}

export async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  // FACET_EXECUTABLE runs the suite against a packaged build (e.g. the portable EXE) instead of `out/`.
  const packaged = process.env.FACET_EXECUTABLE
  const app = await electron.launch({
    ...(packaged ? { executablePath: packaged } : {}),
    args: packaged
      ? process.platform === 'linux'
        ? ['--no-sandbox']
        : []
      : [path.join(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, FACET_E2E: '1', FACET_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 860 }).catch(() => undefined)
  await page.waitForSelector('[data-testid="nav"]')
  return { app, page }
}

export async function setTestHook(
  app: ElectronApplication,
  key: 'browseResult' | 'saveResult' | 'openFileResult' | 'executeDelayMs',
  value: string | number | null,
): Promise<void> {
  await app.evaluate(
    ({}, [k, v]) => {
      ;(globalThis as unknown as { __facetTest: Record<string, string | number | null> }).__facetTest[
        k as string
      ] = v
    },
    [key, value] as const,
  )
}
