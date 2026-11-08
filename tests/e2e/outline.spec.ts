import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { launch, setupEnv } from './fixtures'

/** Drag `src` onto a vertical zone of `dst` (0 = top edge, 1 = bottom edge) using HTML5 DnD. */
async function dragTo(page: Page, src: Locator, dst: Locator, zone: number) {
  const b = (await dst.boundingBox())!
  await src.dragTo(dst, {
    targetPosition: { x: Math.min(40, b.width / 2), y: Math.max(1, Math.min(b.height - 1, b.height * zone)) },
  })
  await page.waitForTimeout(250)
}

test('UI-08 full hierarchy incl. single sections, dynamic numbering, collapse & sticky expand/collapse all', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('tab-Outline').click()
  const labels = await page.getByTestId('outline-section').locator('.outline-label').allTextContents()
  expect(labels).toEqual([
    '1. Introduction',
    '1.1. Background',
    '2. Methods',
    '3. Results',
    '3.1. Zoning patterns',
    '3.2. Diffusion timescales',
    '4. Discussion',
    '4.1. Magma recharge',
    '5. Conclusions',
  ])
  // Collapse one section individually.
  const methods = page.locator(`[data-testid="outline-section"][data-id="${env.zao.sectionIds.methods}"]`)
  await methods.getByTestId('collapse-toggle').click()
  await expect(page.locator(`[data-testid="outline-note"][data-id="${env.zao.noteIds.n7}"]`)).toHaveCount(0)
  await page.getByTestId('collapse-all').click()
  await expect(page.getByTestId('outline-group')).toHaveCount(0)
  await page.getByTestId('expand-all').click()
  await expect(page.getByTestId('outline-group')).toHaveCount(5)
  // Toolbar stays visible after scrolling.
  await page.getByTestId('outline-primary').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect(page.getByTestId('expand-all')).toBeInViewport()
  const tb = (await page.getByTestId('outline-toolbar').boundingBox())!
  const primary = (await page.getByTestId('outline-primary').boundingBox())!
  expect(Math.abs(tb.y - primary.y)).toBeLessThan(3)
  // Numbering follows reordering: move Discussion before Introduction.
  await page.getByTestId('outline-primary').evaluate((el) => (el.scrollTop = 0))
  const discussion = page.locator(
    `[data-testid="outline-section"][data-id="${env.zao.sectionIds.discussion}"]`,
  )
  const intro = page.locator(`[data-testid="outline-section"][data-id="${env.zao.sectionIds.intro}"]`)
  await dragTo(page, discussion, intro, 0.1)
  await expect(discussion.locator('.outline-label')).toHaveText('1. Discussion')
  await expect(intro.locator('.outline-label')).toHaveText('2. Introduction')
  await expect(page.locator(`[data-section-id="${env.zao.sectionIds.recharge}"]`)).toContainText(
    '1.1. Magma recharge',
  )
  await app.close()
})

test('UI-09 / DAT-04 drag notes, paragraphs and sections; no cycles, no duplicate placement', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('tab-Outline').click()
  const note = (k: string) => page.locator(`[data-testid="outline-note"][data-id="${env.zao.noteIds[k]}"]`)
  const group = (k: string) => page.locator(`[data-testid="outline-group"][data-id="${env.zao.groupIds[k]}"]`)
  const section = (k: string) =>
    page.locator(`[data-testid="outline-section"][data-id="${env.zao.sectionIds[k]}"]`)

  // Note from Paragraph A (p1) into Paragraph B (p5).
  await dragTo(page, note('n6'), group('p5'), 0.5)
  await expect(
    page.locator(
      `[data-testid="outline-group"][data-id="${env.zao.groupIds.p5}"] + .outline-notes [data-id="${env.zao.noteIds.n6}"]`,
    ),
  ).toHaveCount(1)
  await expect(note('n6')).toHaveCount(1)
  let structure = await readFile(path.join(env.zao.dir, 'structure.json'), 'utf8')
  expect(structure.split(env.zao.noteIds.n6).length - 1).toBe(1)

  // Reorder within a paragraph: n4 before n3.
  await dragTo(page, note('n4'), note('n3'), 0.1)
  const order = await page
    .locator(
      `[data-testid="outline-group"][data-id="${env.zao.groupIds.p5}"] + .outline-notes [data-testid="outline-note"]`,
    )
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))
  expect(order.slice(0, 2)).toEqual([env.zao.noteIds.n4, env.zao.noteIds.n3])

  // Paragraph to another section (with its notes). Collapse unrelated chapters so the target is on screen.
  await section('intro').getByTestId('collapse-toggle').click()
  await section('results').getByTestId('collapse-toggle').click()
  await section('discussion').getByTestId('collapse-toggle').click()
  await dragTo(page, group('p2'), section('conclusion'), 0.5)
  await expect(
    page.locator(`[data-section-block="${env.zao.sectionIds.conclusion}"] [data-id="${env.zao.noteIds.n7}"]`),
  ).toHaveCount(1)

  await page.getByTestId('expand-all').click()
  // Subsection to another parent section.
  await dragTo(page, section('zoning'), section('discussion'), 0.5)
  await expect(section('zoning').locator('.outline-label')).toHaveText('4.2. Zoning patterns')

  // Cycle: a section into its own child is refused.
  await dragTo(page, section('discussion'), section('recharge'), 0.5)
  await expect(page.getByTestId('toast').last()).toContainText('移動できません')
  await expect(section('discussion').locator('.outline-label')).toHaveText('4. Discussion')

  // Unassigned note placed into a paragraph, then back to Unassigned.
  await dragTo(page, note('n9'), group('p3'), 0.5)
  await expect(
    page.locator(`[data-testid="outline-unassigned"] [data-id="${env.zao.noteIds.n9}"]`),
  ).toHaveCount(0)
  await note('n9').dragTo(page.getByTestId('outline-unassigned'), { targetPosition: { x: 20, y: 8 } })
  await expect(
    page.locator(`[data-testid="outline-unassigned"] [data-id="${env.zao.noteIds.n9}"]`),
  ).toHaveCount(1)

  structure = await readFile(path.join(env.zao.dir, 'structure.json'), 'utf8')
  for (const id of Object.values(env.zao.noteIds))
    expect(structure.split(id).length - 1).toBeLessThanOrEqual(1)
  await app.close()
})

test('UI-10 inline note editing in Outline syncs with the right Note Editor and manuscript', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('tab-Outline').click()
  await page.getByTestId('open-manuscript').click()
  const row = page.locator(`[data-testid="outline-note"][data-id="${env.zao.noteIds.n7}"]`)
  await row.dblclick()
  const inline = page.getByTestId('inline-editor')
  await expect(inline).toBeVisible()
  const body = inline.getByTestId('inline-body')
  await body.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' Inline edit works.')
  await expect(page.getByTestId('right-pane').getByTestId('note-body')).toContainText('Inline edit works.')
  await expect(page.getByTestId('manuscript')).toContainText(
    'electron microprobe analyses. Inline edit works.',
    { timeout: 5000 },
  )
  await page.waitForTimeout(900)
  const md = await readFile(path.join(env.zao.dir, 'notes', `${env.zao.noteIds.n7}.md`), 'utf8')
  expect(md).toContain('Inline edit works.')
  // Editing in the right pane is reflected inline.
  const right = page.getByTestId('right-pane').getByTestId('note-body')
  await right.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' Right pane too.')
  await expect(body).toContainText('Right pane too.', { timeout: 4000 })
  await app.close()
})

test('UI-11 / DAT-03 manuscript split, close, fullscreen; paragraphs join without titles, keep citations', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('tab-Outline').click()
  await expect(page.getByTestId('manuscript-split')).toHaveCount(0)
  await page.getByTestId('open-manuscript').click()
  const split = page.getByTestId('manuscript-split')
  await expect(split).toBeVisible()
  const outline = (await page.getByTestId('outline-primary').boundingBox())!
  const ms = (await split.boundingBox())!
  expect(ms.x).toBeGreaterThan(outline.x + outline.width - 2)
  await expect(page.getByTestId('right-pane').getByTestId('manuscript')).toHaveCount(0)
  const doc = split.getByTestId('manuscript')
  await expect(doc.locator('h2').first()).toHaveText('1. Introduction')
  await expect(doc.locator('h3').first()).toHaveText('1.1. Background')
  await expect(doc).toContainText(
    'volcanic unrest. Previous work has established a link between zoning and recharge [@Tanaka2022].',
  )
  await expect(doc).toContainText('See also Mush reactivation. Repeated thermal inputs')
  await expect(doc).not.toContainText('Research background')
  await expect(doc).not.toContainText('Unplaced insight')
  await expect(doc).not.toContainText('[[')
  // Reorder reflects immediately.
  const n6 = page.locator(`[data-testid="outline-note"][data-id="${env.zao.noteIds.n6}"]`)
  const n8 = page.locator(`[data-testid="outline-note"][data-id="${env.zao.noteIds.n8}"]`)
  await dragTo(page, n8, n6, 0.1)
  await expect(doc.locator('p').first()).toHaveText(/^Previous work/)
  // Export .md
  await split.getByTestId('ms-export').click()
  await expect(page.getByTestId('toast').last()).toContainText('エクスポートしました')
  const exported = await readFile(path.join(env.zao.dir, 'exports', 'manuscript.md'), 'utf8')
  expect(exported.startsWith('# 1. Introduction\n\n## 1.1. Background\n\nPrevious work')).toBe(true)
  expect(exported).toContain('[@Smith2024]')
  // Fullscreen and close.
  await split.getByTestId('ms-fullscreen').click()
  await expect(page.getByTestId('manuscript-fullscreen')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('manuscript-fullscreen')).toHaveCount(0)
  await split.getByTestId('ms-close').click()
  await expect(page.getByTestId('manuscript-split')).toHaveCount(0)
  await app.close()
})

test('Undo/redo of an outline move (Ctrl+Z / Ctrl+Y)', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('tab-Outline').click()
  const n6 = page.locator(`[data-testid="outline-note"][data-id="${env.zao.noteIds.n6}"]`)
  const p5 = page.locator(`[data-testid="outline-group"][data-id="${env.zao.groupIds.p5}"]`)
  await dragTo(page, n6, p5, 0.5)
  const inP5 = page.locator(
    `[data-testid="outline-group"][data-id="${env.zao.groupIds.p5}"] + .outline-notes [data-id="${env.zao.noteIds.n6}"]`,
  )
  await expect(inP5).toHaveCount(1)
  await page.getByTestId('outline-toolbar').click({ position: { x: 600, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(inP5).toHaveCount(0)
  await page.keyboard.press('Control+y')
  await expect(inP5).toHaveCount(1)
  await app.close()
})
