import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { launch, setupEnv } from './fixtures'

async function zoom(page: Page): Promise<number> {
  return parseInt((await page.getByTestId('zoom-text').textContent())!, 10)
}

async function viewportTransform(page: Page): Promise<string> {
  return (await page.locator('.react-flow__viewport').getAttribute('style')) ?? ''
}

test('UI-04 Canvas Tools only at the top of the canvas centre pane', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  const tools = page.getByTestId('canvas-tools')
  await expect(tools).toBeVisible()
  for (const name of ['new', 'copy', 'paste', 'group', 'select', 'delete', 'archive', 'citation'])
    await expect(page.getByTestId(`tool-${name}`)).toBeVisible()
  const tb = (await tools.boundingBox())!
  const center = (await page.getByTestId('center-pane').boundingBox())!
  const left = (await page.getByTestId('left-pane').boundingBox())!
  const right = (await page.getByTestId('right-pane').boundingBox())!
  expect(Math.round(tb.y)).toBe(Math.round(center.y))
  expect(tb.x).toBeGreaterThanOrEqual(left.x + left.width - 1)
  expect(tb.x + tb.width).toBeLessThanOrEqual(right.x + 1)
  for (const t of ['Outline', 'Cards', 'Reference']) {
    await page.getByTestId(`tab-${t}`).click()
    await expect(page.getByTestId('canvas-tools')).toHaveCount(0)
  }
  await app.close()
})

test('UI-05 pan, cursor-anchored zoom, fit all, 100%, fit group', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  const stage = page.getByTestId('canvas-stage')
  await page.waitForTimeout(300)
  const box = (await stage.boundingBox())!
  // Pan by dragging the background.
  const t0 = await viewportTransform(page)
  await page.mouse.move(box.x + 40, box.y + box.height - 60)
  await page.mouse.down()
  await page.mouse.move(box.x + 140, box.y + box.height - 20, { steps: 6 })
  await page.mouse.up()
  const t1 = await viewportTransform(page)
  expect(t1).not.toBe(t0)
  // Zoom with the wheel keeps the point under the cursor fixed.
  const group = page.getByTestId('canvas-group').first()
  const g0 = (await group.boundingBox())!
  await page.mouse.move(g0.x + 10, g0.y + 10)
  const z0 = await zoom(page)
  await page.mouse.wheel(0, -300)
  await page.waitForTimeout(300)
  expect(await zoom(page)).toBeGreaterThan(z0)
  const g1 = (await group.boundingBox())!
  expect(Math.abs(g1.x - g0.x)).toBeLessThan(12)
  expect(Math.abs(g1.y - g0.y)).toBeLessThan(12)
  // 100%
  await page.getByTestId('zoom-100').click()
  await page.waitForTimeout(300)
  expect(await zoom(page)).toBe(100)
  // ± buttons
  await page.getByTestId('zoom-out').click()
  await page.waitForTimeout(250)
  expect(await zoom(page)).toBeLessThan(100)
  // Fit all: every node visible inside the stage.
  await page.getByTestId('fit-all').click()
  await page.waitForTimeout(350)
  for (const el of await page
    .locator('[data-testid="canvas-group"], [data-testid="canvas-unassigned"]')
    .all()) {
    const b = (await el.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(box.x - 1)
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1)
  }
  // Fit group: selected group fills the view.
  const p5 = page.locator(`[data-testid="canvas-group"][data-group-id="${env.zao.groupIds.p5}"]`)
  await p5.getByTestId('group-head').click()
  await page.getByTestId('fit-group').click()
  await page.waitForTimeout(350)
  const fitted = (await p5.boundingBox())!
  expect(fitted.width).toBeGreaterThan(box.width * 0.3)
  expect(fitted.x).toBeGreaterThan(box.x)
  await app.close()
})

test('UI-06 All: free layout with Unassigned cards; section: auto tree; moving does not change outline order', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await expect(page.getByTestId('canvas-group')).toHaveCount(5)
  await expect(page.getByTestId('canvas-unassigned')).toHaveCount(2)
  await expect(page.getByTestId('canvas-unassigned').first()).toContainText('Unassigned')
  await expect(page.getByTestId('group-crumb').first()).toContainText('1. Introduction › 1.1. Background')
  const before = await readFile(path.join(env.zao.dir, 'structure.json'), 'utf8')
  // Drag a group by its header → position saved, structure unchanged.
  const head = page.getByTestId('canvas-group').first().getByTestId('group-head')
  const hb = (await head.boundingBox())!
  await page.mouse.move(hb.x + 30, hb.y + 10)
  await page.mouse.down()
  await page.mouse.move(hb.x + 230, hb.y + 160, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const canvas = JSON.parse(await readFile(path.join(env.zao.dir, 'canvas-state.json'), 'utf8'))
  expect(canvas.canvases[0].groups[env.zao.groupIds.p1].x).not.toBe(120)
  expect(await readFile(path.join(env.zao.dir, 'structure.json'), 'utf8')).toBe(before)
  // Section scope → tree layout (not a zoomed All view).
  await page.locator(`[data-section-id="${env.zao.sectionIds.results}"]`).click()
  await expect(page.getByTestId('canvas-status')).toContainText('Auto tree layout')
  await expect(page.getByTestId('tree-header')).toHaveCount(3)
  await expect(page.getByTestId('canvas-group')).toHaveCount(2)
  await expect(page.getByTestId('canvas-unassigned')).toHaveCount(0)
  await page.getByTestId('section-all').click()
  await expect(page.getByTestId('canvas-status')).toContainText('Free layout')
  await app.close()
})

test('UI-07 note previews are clamped to ~5 lines with title and a path to full editing', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  const card = page.locator(`[data-testid="canvas-unassigned"][data-note-id="${env.zao.noteIds.n9}"]`)
  await expect(card).toContainText('Unplaced insight')
  const body = card.locator('.chip-body')
  const lineHeight = await body.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
  const h = (await body.boundingBox())!.height
  expect(h / lineHeight).toBeLessThanOrEqual(5.2)
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await expect(page.getByTestId('canvas-note').first().locator('b')).toBeVisible()
  await card.dblclick()
  await expect(page.getByTestId('note-title')).toHaveValue('Unplaced insight')
  await expect(page.getByTestId('note-body')).toContainText('Line seven')
  await app.close()
})

test('Canvas: drag a note chip into another group changes membership', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('fit-all').click()
  await page.waitForTimeout(300)
  const chip = page.locator(`[data-testid="canvas-note"][data-note-id="${env.zao.noteIds.n7}"]`)
  const target = page.locator(
    `[data-testid="canvas-group"][data-group-id="${env.zao.groupIds.p5}"] .para-footer`,
  )
  await chip.dragTo(target)
  await expect(
    page.locator(
      `[data-testid="canvas-group"][data-group-id="${env.zao.groupIds.p5}"] [data-note-id="${env.zao.noteIds.n7}"]`,
    ),
  ).toBeVisible()
  const s = JSON.parse(await readFile(path.join(env.zao.dir, 'structure.json'), 'utf8'))
  expect(JSON.stringify(s).split(env.zao.noteIds.n7).length - 1).toBe(1)
  await app.close()
})

test('UI-07 / UI-16 Canvas: click expands the full text below a note for editing, without moving the canvas', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('fit-all').click()
  await page.waitForTimeout(1000) // let the viewport save settle
  const p2 = page.locator(`[data-testid="canvas-group"][data-group-id="${env.zao.groupIds.p2}"]`)
  const chip = page.locator(`[data-testid="canvas-note"][data-note-id="${env.zao.noteIds.n7}"]`)
  const panel = page.getByTestId('canvas-body-panel')
  const body = panel.getByTestId('canvas-body')
  await chip.click()
  await expect(panel).toHaveCount(1)
  await expect(chip).toHaveAttribute('aria-expanded', 'true')
  await expect(p2.getByTestId('canvas-body-panel')).toHaveCount(1)
  const cb = (await chip.boundingBox())!
  expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(cb.y + cb.height - 1)
  await expect(body).toContainText('electron microprobe analyses')

  // Edits sync to the right pane and the file.
  await body.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' Canvas edit.')
  await expect(page.getByTestId('right-pane').getByTestId('note-body')).toContainText('Canvas edit.')
  const noteFile = path.join(env.zao.dir, 'notes', `${env.zao.noteIds.n7}.md`)
  await expect.poll(() => readFile(noteFile, 'utf8')).toContain('Canvas edit.')

  // Selecting text by dragging and scrolling over the editor neither move the node, pan nor zoom.
  const canvasFile = path.join(env.zao.dir, 'canvas-state.json')
  const savedCanvas = await readFile(canvasFile, 'utf8')
  const transform = await viewportTransform(page)
  const groupBox = (await p2.boundingBox())!
  const bb = (await body.boundingBox())!
  await page.mouse.move(bb.x + 6, bb.y + 8)
  await page.mouse.down()
  await page.mouse.move(bb.x + 160, bb.y + 40, { steps: 6 })
  await page.mouse.up()
  const zoomBefore = await zoom(page)
  await page.mouse.wheel(0, -400)
  await page.waitForTimeout(900)
  expect(await zoom(page)).toBe(zoomBefore)
  expect(await viewportTransform(page)).toBe(transform)
  const after = (await p2.boundingBox())!
  expect(Math.abs(after.x - groupBox.x) + Math.abs(after.y - groupBox.y)).toBeLessThan(1)
  expect(await readFile(canvasFile, 'utf8')).toBe(savedCanvas)
  expect(await readFile(noteFile, 'utf8')).toContain('Canvas edit.')

  // Clicking again collapses.
  await chip.click()
  await expect(panel).toHaveCount(0)

  // Unassigned cards expand too (one note at a time), and widen for editing.
  const loose = page.locator(`[data-testid="canvas-unassigned"][data-note-id="${env.zao.noteIds.n9}"]`)
  const narrow = (await loose.boundingBox())!.width
  await chip.click()
  await loose.locator('strong').click()
  await expect(panel).toHaveCount(1)
  await expect(loose.getByTestId('canvas-body-panel')).toBeVisible()
  await expect(body).toContainText('Line seven')
  expect((await loose.boundingBox())!.width).toBeGreaterThan(narrow)
  await page.getByTestId('canvas-body-close').click()
  await expect(panel).toHaveCount(0)

  // Multi-select mode only selects.
  await page.getByTestId('tool-select').click()
  await chip.click()
  await expect(panel).toHaveCount(0)
  await page.getByTestId('tool-select').click()

  // The Outline shows the edit made on the Canvas.
  await page.getByTestId('tab-Outline').click()
  await page.locator(`[data-testid="outline-note"][data-id="${env.zao.noteIds.n7}"]`).dblclick()
  await expect(page.getByTestId('inline-editor').getByTestId('inline-body')).toContainText('Canvas edit.')
  await app.close()
})

test('UI-16 Canvas section tree: an expanded note pushes later rows down; collapsing its group closes it', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.locator(`[data-section-id="${env.zao.sectionIds.results}"]`).click()
  await expect(page.getByTestId('canvas-status')).toContainText('Auto tree layout')
  const p3 = page.locator(`[data-testid="canvas-group"][data-group-id="${env.zao.groupIds.p3}"]`)
  const nextRow = page.getByTestId('tree-header').filter({ hasText: '3.2.' })
  const before = (await nextRow.boundingBox())!.y
  await p3.locator(`[data-testid="canvas-note"][data-note-id="${env.zao.noteIds.n1}"]`).click()
  await expect(p3.getByTestId('canvas-body-panel')).toBeVisible()
  await expect.poll(async () => (await nextRow.boundingBox())!.y).toBeGreaterThan(before + 10)
  const g = (await p3.boundingBox())!
  expect((await nextRow.boundingBox())!.y).toBeGreaterThanOrEqual(g.y + g.height)
  // Collapsing the Paragraph Group closes the editor; expanding the group does not reopen it.
  await p3.getByTestId('group-expand').click()
  await expect(page.getByTestId('canvas-body-panel')).toHaveCount(0)
  await p3.getByTestId('group-expand').click()
  await expect(p3.getByTestId('canvas-note')).toHaveCount(1)
  await expect(page.getByTestId('canvas-body-panel')).toHaveCount(0)
  await app.close()
})
