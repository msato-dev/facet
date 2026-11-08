import { expect, test } from '@playwright/test'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launch, setTestHook, setupEnv } from './fixtures'

test('UI-13 Reference tab searches BibTeX and inserts [@key] at the cursor', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.getByTestId('tab-Reference').click()
  await expect(page.getByTestId('reference-row')).toHaveCount(2)
  await page.getByTestId('reference-search').fill('plagioclase')
  await expect(page.getByTestId('reference-row')).toHaveCount(1)
  await expect(page.getByTestId('reference-row')).toContainText('[@Tanaka2022]')
  // Place the cursor in the middle of the selected note body, then insert via the dialog.
  const body = page.getByTestId('note-body')
  await body.click()
  await page.keyboard.press('Control+Home')
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight')
  await page.getByTestId('insert-citation').click()
  await page.getByTestId('citation-search').fill('Smith')
  await page.getByTestId('citation-choice').first().click()
  await expect(body).toContainText('Reverse[@Smith2024] zoning')
  await page.waitForTimeout(800)
  const md = await readFile(path.join(env.zao.dir, 'notes', `${env.zao.noteIds.n1}.md`), 'utf8')
  expect(md).toContain('Reverse[@Smith2024] zoning')
  // No Reference switcher in the side panes.
  await expect(page.getByTestId('left-pane').getByText('Reference')).toHaveCount(0)
  await expect(page.getByTestId('right-pane').getByRole('tab')).toHaveCount(0)
  await app.close()
})

test('BibTeX errors and duplicate keys are reported; external .bib edits reload', async () => {
  const env = await setupEnv()
  await writeFile(
    path.join(env.zao.dir, 'references', 'library.bib'),
    '@article{A1, title={One}, year={2020}}\n@article{A1, title={Dup}, year={2021}}\n@article{bad, title = {unterminated\n',
  )
  const { app, page } = await launch(env.userData)
  await page.getByTestId('tab-Reference').click()
  await expect(page.getByTestId('bib-issues')).toContainText('A1')
  await expect(page.getByTestId('bib-issues')).toContainText('line')
  await writeFile(
    path.join(env.zao.dir, 'references', 'library.bib'),
    '@article{B2, author={Ono, Y.}, title={Fresh}, year={2025}}\n',
  )
  await expect(page.getByTestId('reference-table')).toContainText('Ono', { timeout: 8000 })
  await expect(page.getByTestId('reference-row')).toHaveCount(1)
  await app.close()
})

test('UI-14 / DAT-06 Settings: gear right of Search, Browse absolute path, Save/Cancel, restored after restart; invalid paths refused', async () => {
  const env = await setupEnv()
  let { app, page } = await launch(env.userData)
  await page.getByTestId('settings-button').click()
  const dlg = page.getByTestId('settings-dialog')
  await expect(dlg.getByText('Vault Locations')).toBeVisible()
  const rows = dlg.getByTestId('vault-row')
  await expect(rows).toHaveCount(2)

  // Invalid: another workspace's vault → refused, old path kept, nothing moved.
  await setTestHook(app, 'browseResult', env.chamber.dir)
  await rows.nth(0).getByTestId('vault-browse').click()
  await expect(rows.nth(0).getByTestId('vault-path')).toHaveValue(env.chamber.dir)
  await dlg.getByTestId('settings-save').click()
  await expect(rows.nth(0).getByTestId('vault-validation')).toContainText('別のWorkspace')
  await expect(page.getByTestId('toast').last()).toContainText('保存しませんでした')
  // Typed relative path → refused.
  await rows.nth(0).getByTestId('vault-path').fill('relative\\path')
  await dlg.getByTestId('settings-save').click()
  await expect(rows.nth(0).getByTestId('vault-validation')).toContainText('絶対パス')
  // Cancel discards.
  await dlg.getByTestId('settings-cancel').click()
  const settings1 = JSON.parse(await readFile(path.join(env.userData, 'settings.json'), 'utf8'))
  expect(settings1.workspaces[0].vaultPath).toBe(env.zao.dir)
  expect((await readdir(env.zao.dir)).sort()).toContain('project.yml')

  // Valid: a copy of the same vault in another folder.
  const moved = path.join(env.root, 'moved-zao')
  await cp(env.zao.dir, moved, { recursive: true })
  await page.getByTestId('settings-button').click()
  await setTestHook(app, 'browseResult', moved)
  await page
    .getByTestId('settings-dialog')
    .getByTestId('vault-row')
    .nth(0)
    .getByTestId('vault-browse')
    .click()
  await page.getByTestId('settings-dialog').getByTestId('settings-save').click()
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect(page.getByTestId('toast').last()).toContainText('保存しました')
  // Original vault untouched.
  expect((await readdir(env.zao.dir)).sort()).toEqual((await readdir(moved)).sort())

  await app.close()
  ;({ app, page } = await launch(env.userData))
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-dialog').getByTestId('vault-path').nth(0)).toHaveValue(
    new RegExp('moved-zao$'),
  )
  await app.close()
})

test('Add workspace initialises an empty folder as a new vault', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  const empty = path.join(env.root, 'new-paper')
  await mkdir(empty)
  await page.getByTestId('settings-button').click()
  await setTestHook(app, 'browseResult', empty)
  await page.getByTestId('add-workspace').click()
  await page.getByTestId('prompt-input').fill('New Paper')
  await page.getByTestId('prompt-ok').click()
  await expect(page.getByTestId('settings-dialog').getByTestId('vault-row')).toHaveCount(3)
  expect((await readdir(empty)).sort()).toEqual([
    'canvas-state.json',
    'notes',
    'notes-index.json',
    'project.yml',
    'references',
    'structure.json',
  ])
  await app.close()
})

test('DAT-05 restart restores vault, outline, canvas positions, settings; external edits are not overwritten', async () => {
  const env = await setupEnv()
  let { app, page } = await launch(env.userData)
  // Close the right pane, move a group on the canvas, reorder in the outline.
  await page.getByTestId('toggle-right').click()
  const head = page
    .locator(`[data-testid="canvas-group"][data-group-id="${env.zao.groupIds.p2}"]`)
    .getByTestId('group-head')
  const hb = (await head.boundingBox())!
  await page.mouse.move(hb.x + 30, hb.y + 8)
  await page.mouse.down()
  await page.mouse.move(hb.x + 130, hb.y + 108, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const canvas = JSON.parse(await readFile(path.join(env.zao.dir, 'canvas-state.json'), 'utf8'))
  const saved = canvas.canvases[0].groups[env.zao.groupIds.p2]
  await page.getByTestId('workspace-select').selectOption(env.chamber.workspaceId)
  await page.waitForTimeout(200)
  await app.close()

  ;({ app, page } = await launch(env.userData))
  await expect(page.getByTestId('workspace-select')).toHaveValue(env.chamber.workspaceId)
  expect((await page.getByTestId('right-pane').boundingBox())!.width).toBeLessThanOrEqual(31)
  await page.getByTestId('workspace-select').selectOption(env.zao.workspaceId)
  const canvas2 = JSON.parse(await readFile(path.join(env.zao.dir, 'canvas-state.json'), 'utf8'))
  expect(canvas2.canvases[0].groups[env.zao.groupIds.p2]).toEqual(saved)

  // External edit while FACET is running → loaded, not overwritten.
  await page.getByTestId('toggle-right').click()
  await page.locator(`[data-testid="canvas-note"][data-note-id="${env.zao.noteIds.n7}"]`).click()
  const file = path.join(env.zao.dir, 'notes', `${env.zao.noteIds.n7}.md`)
  await writeFile(file, '# Analytical procedure\n\nEdited outside FACET.')
  await expect(page.getByTestId('note-body')).toContainText('Edited outside FACET.', { timeout: 8000 })
  expect(await readFile(file, 'utf8')).toBe('# Analytical procedure\n\nEdited outside FACET.')
  await app.close()
})

test('Conflict: local unsaved edit vs external edit shows a conflict banner instead of overwriting', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.locator(`[data-testid="canvas-note"][data-note-id="${env.zao.noteIds.n7}"]`).click()
  const file = path.join(env.zao.dir, 'notes', `${env.zao.noteIds.n7}.md`)
  const body = page.getByTestId('note-body')
  await body.click()
  await page.keyboard.press('Control+End')
  // Write externally, then type before FACET has saved anything.
  await writeFile(file, '# Analytical procedure\n\nExternal version.')
  await page.keyboard.type(' local typing')
  await expect(page.getByRole('alert').filter({ hasText: '別の場所' })).toBeVisible({ timeout: 8000 })
  expect(await readFile(file, 'utf8')).toBe('# Analytical procedure\n\nExternal version.')
  await app.close()
})
