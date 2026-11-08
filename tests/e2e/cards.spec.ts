import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { launch, setupEnv } from './fixtures'

test('UI-12 Cards: square grid, search, grouping, outline filter incl. parent chapters', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('tab-Cards').click()
  const card = page.getByTestId('memo-card').first()
  const b = (await card.boundingBox())!
  expect(Math.abs(b.width - b.height)).toBeLessThan(2)
  // Multi-tag notes appear under each tag but are the same note.
  await expect(page.locator(`[data-testid="memo-card"][data-note-id="${env.zao.noteIds.n1}"]`)).toHaveCount(2)
  // Search
  await page.getByTestId('cards-search').fill('microprobe')
  await expect(page.locator('[data-testid="memo-card"]')).toHaveCount(1)
  await page.getByTestId('cards-search').fill('')
  // Group by outline + filter by parent chapter (includes subsections).
  await page.getByTestId('cards-groupby').selectOption('outline')
  await page.getByTestId('cards-filter').selectOption(env.zao.sectionIds.results)
  const titles = await page.getByTestId('card-group').locator('h3').allTextContents()
  expect(titles.map((t) => t.replace(/\s*\d+$/, ''))).toEqual([
    '3. Results › 3.1. Zoning patterns',
    '3. Results › 3.2. Diffusion timescales',
  ])
  await expect(page.getByTestId('memo-card')).toHaveCount(3)
  // Unassigned filter combined with search.
  await page.getByTestId('cards-filter').selectOption('unassigned')
  await expect(page.getByTestId('memo-card')).toHaveCount(2)
  await page.getByTestId('cards-search').fill('蔵王')
  await expect(page.getByTestId('memo-card')).toHaveCount(1)
  // Left Sections selection drives the filter.
  await page.getByTestId('cards-search').fill('')
  await page.locator(`[data-section-id="${env.zao.sectionIds.discussion}"]`).click()
  await expect(page.getByTestId('memo-card')).toHaveCount(2)
  // Sort by title
  await page.getByTestId('section-all').click()
  await page.getByTestId('cards-groupby').selectOption('none')
  await page.getByTestId('cards-sort').selectOption('title')
  const first = await page.getByTestId('memo-card').first().locator('h4').textContent()
  expect(first).toBe('Analytical procedure')
  await app.close()
})

test('Search all workspaces: results show workspace and open it there; copy is independent', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('global-search-button').click()
  await page.getByTestId('global-search-input').fill('recharge frequency')
  const results = page.getByTestId('global-search-view').getByTestId('memo-card')
  await expect(results).toHaveCount(2)
  await expect(page.getByTestId('card-workspace'))
    .toHaveText(['Zao · Diffusion Chronometry', 'Magma Chamber · Thermal Modeling'].sort() as never, {
      timeout: 3000,
    })
    .catch(async () => {
      const ws = await page.getByTestId('card-workspace').allTextContents()
      expect(ws.sort()).toEqual(['Magma Chamber · Thermal Modeling', 'Zao · Diffusion Chronometry'])
    })
  // Copy the Chamber note into Zao → independent copy with a new id.
  await page.locator(`[data-note-id="${env.chamber.noteIds.m3}"]`).getByTestId('copy-to-current').click()
  await expect(page.getByTestId('toast').last()).toContainText('Recharge frequency (copy)')
  // Open the Chamber result → switches workspace.
  await page.locator(`[data-testid="memo-card"][data-note-id="${env.chamber.noteIds.m3}"]`).click()
  await expect(page.getByTestId('workspace-select')).toHaveValue(env.chamber.workspaceId)
  await expect(page.getByTestId('note-title')).toHaveValue('Recharge frequency')
  const index = JSON.parse(await readFile(path.join(env.zao.dir, 'notes-index.json'), 'utf8'))
  expect(Object.keys(index.notes)).toHaveLength(11)
  expect(Object.keys(index.notes)).not.toContain(env.chamber.noteIds.m3)
  await app.close()
})

test('DAT-01 duplicate titles rejected in a workspace, allowed across workspaces', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('tool-new').click()
  await page.getByTestId('prompt-input').fill('reverse ZONING')
  await page.getByTestId('prompt-ok').click()
  await expect(page.getByTestId('toast').last()).toContainText('同じタイトル')
  // Rename an existing note to a duplicate is refused too.
  await page.getByTestId('note-title').fill('Diffusion timescales')
  await page.getByTestId('note-title').press('Enter')
  await expect(page.locator('.field-error')).toContainText('同じタイトル')
  // "Recharge frequency" exists in both sample workspaces (allowed).
  await page.getByTestId('workspace-select').selectOption(env.chamber.workspaceId)
  await page.getByTestId('tab-Cards').click()
  await expect(page.locator(`[data-note-id="${env.chamber.noteIds.m3}"]`).first()).toContainText(
    'Recharge frequency',
  )
  await app.close()
})

test('DAT-02 WikiLink completion, navigation, backlinks, rename cascade, broken link detection', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('tab-Cards').click()
  await page.locator(`[data-testid="memo-card"][data-note-id="${env.zao.noteIds.n4}"]`).first().click()
  await expect(page.getByTestId('backlinks')).toContainText('Recharge frequency')
  // Completion inserts a link to an existing title.
  await page.locator(`[data-testid="memo-card"][data-note-id="${env.zao.noteIds.n2}"]`).first().click()
  const body = page.getByTestId('note-body')
  await body.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' [[Temperature unc')
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Temperature uncertainty')
  await page.waitForTimeout(200) // CodeMirror ignores keys during its short interaction delay
  await page.keyboard.press('Enter')
  await expect(body).toContainText('[[Temperature uncertainty]]')
  // Navigate via the WikiLinks list.
  await page.getByRole('button', { name: '↗ Temperature uncertainty' }).click()
  await expect(page.getByTestId('note-title')).toHaveValue('Temperature uncertainty')
  await expect(page.getByTestId('backlinks')).toContainText('Diffusion timescales')
  // Rename updates referring notes' files.
  await page.getByTestId('note-title').fill('Thermal uncertainty')
  await page.getByTestId('note-title').press('Enter')
  await expect(page.getByTestId('toast').last()).toContainText('1件のWikiLink')
  await page.waitForTimeout(400)
  const md = await readFile(path.join(env.zao.dir, 'notes', `${env.zao.noteIds.n2}.md`), 'utf8')
  expect(md).toContain('[[Thermal uncertainty]]')
  // Broken link is flagged.
  await body.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' [[No such note]] ')
  await page.keyboard.press('Escape')
  await expect(page.locator('.link-chip.broken')).toContainText('No such note')
  await app.close()
})

test('Archive and delete with undo and trash restore', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('tab-Cards').click()
  await page.locator(`[data-testid="memo-card"][data-note-id="${env.zao.noteIds.n9}"]`).first().click()
  await page.getByTestId('tab-Canvas').click()
  await page.getByTestId('tool-delete').click()
  await page.getByTestId('confirm-ok').click()
  await expect(
    page.locator(`[data-testid="canvas-unassigned"][data-note-id="${env.zao.noteIds.n9}"]`),
  ).toHaveCount(0)
  await page.getByTestId('tab-Cards').click()
  await page.getByTestId('open-trash').click()
  await page.getByTestId('trash-restore').click()
  await page.keyboard.press('Escape')
  await expect(
    page.locator(`[data-testid="memo-card"][data-note-id="${env.zao.noteIds.n9}"]`).first(),
  ).toBeVisible()
  const md = await readFile(path.join(env.zao.dir, 'notes', `${env.zao.noteIds.n9}.md`), 'utf8')
  expect(md).toContain('# Unplaced insight')
  await app.close()
})
