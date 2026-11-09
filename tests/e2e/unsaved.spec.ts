// Unsaved edits are never lost on close, workspace switch or note switch (DAT-05, ADR-031, ADR-032).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launch, setupEnv, type Env } from './fixtures'

type Hooks = { closeChoice: 'cancel' | 'discard' | null; closePrompts: number }

async function setCloseChoice(app: ElectronApplication, choice: Hooks['closeChoice']): Promise<void> {
  await app.evaluate((_e, c) => {
    ;(globalThis as unknown as { __facetTest: Hooks }).__facetTest.closeChoice = c
  }, choice)
}
const closePrompts = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __facetTest: Hooks }).__facetTest.closePrompts)

/** Close the window the way the user does (title bar ×), not through app.quit(). */
async function closeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
}

/** Open note n7, then make a local edit that conflicts with an external one. */
async function makeConflict(env: Env, page: Page): Promise<string> {
  await page.locator(`[data-testid="canvas-note"][data-note-id="${env.zao.noteIds.n7}"]`).click()
  const file = path.join(env.zao.dir, 'notes', `${env.zao.noteIds.n7}.md`)
  await page.getByTestId('note-body').click()
  await page.keyboard.press('Control+End')
  await writeFile(file, '# Analytical procedure\n\nExternal version.')
  await page.keyboard.type(' local typing')
  await expect(page.getByRole('alert').filter({ hasText: '別の場所' })).toBeVisible({ timeout: 8000 })
  return file
}

test('closing right after typing saves the body before the window closes', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await page.locator(`[data-testid="canvas-note"][data-note-id="${env.zao.noteIds.n7}"]`).click()
  await page.getByTestId('note-body').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' typed just before closing')
  const closed = app.waitForEvent('close')
  await closeWindow(app) // well within the 500 ms autosave delay
  await closed
  const md = await readFile(path.join(env.zao.dir, 'notes', `${env.zao.noteIds.n7}.md`), 'utf8')
  expect(md).toContain('typed just before closing')
})

test('closing with a conflict asks first; "back" keeps the window and the text', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  const file = await makeConflict(env, page)
  await setCloseChoice(app, 'cancel')
  await closeWindow(app)
  await expect.poll(() => closePrompts(app)).toBe(1)
  await expect(page.getByTestId('note-body')).toContainText('local typing')
  expect(app.windows().length).toBe(1)
  expect(await readFile(file, 'utf8')).toBe('# Analytical procedure\n\nExternal version.')
  // Resolving the conflict (overwrite with my version) lets the window close without a prompt.
  await page.getByRole('button', { name: '自分の内容で上書き' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '別の場所' })).toHaveCount(0)
  const closed = app.waitForEvent('close')
  await closeWindow(app)
  await closed
  expect(await readFile(file, 'utf8')).toContain('local typing')
})

test('discarding on close leaves the external version on disk', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  const file = await makeConflict(env, page)
  await setCloseChoice(app, 'discard')
  const closed = app.waitForEvent('close')
  await closeWindow(app)
  await closed
  expect(await readFile(file, 'utf8')).toBe('# Analytical procedure\n\nExternal version.')
})

test('a conflict blocks switching workspace, and the draft survives selecting another note', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await makeConflict(env, page)
  await page.getByTestId('workspace-select').selectOption(env.chamber.workspaceId)
  await expect(page.getByTestId('toast').last()).toContainText('保存できていない変更があります')
  await expect(page.getByTestId('workspace-select')).toHaveValue(env.zao.workspaceId)
  await expect(page.getByTestId('note-body')).toContainText('local typing')

  // Another note, then back: the unsaved text and the conflict banner are still there.
  await page.locator(`[data-testid="canvas-note"][data-note-id="${env.zao.noteIds.n1}"]`).click()
  await expect(page.getByTestId('note-body')).not.toContainText('local typing')
  // (The click also opens the note's Canvas panel, which shows the same draft.)
  await page.locator(`[data-testid="canvas-note"][data-note-id="${env.zao.noteIds.n7}"]`).click()
  const right = page.getByTestId('right-pane')
  const panel = page.getByTestId('canvas-body-panel')
  await expect(page.getByTestId('note-body')).toContainText('local typing')
  await expect(right.getByRole('alert').filter({ hasText: '別の場所' })).toBeVisible()
  await expect(panel.getByRole('alert').filter({ hasText: '別の場所' })).toBeVisible()

  // Taking the external version in one editor clears the draft in both; switching works again.
  await right.getByRole('button', { name: '最新を読み込む' }).click()
  await expect(page.getByTestId('note-body')).toContainText('External version.')
  await expect(panel.getByTestId('canvas-body')).toContainText('External version.')
  await expect(page.getByRole('alert').filter({ hasText: '別の場所' })).toHaveCount(0)
  await page.getByTestId('workspace-select').selectOption(env.chamber.workspaceId)
  await expect(page.getByTestId('workspace-select')).toHaveValue(env.chamber.workspaceId)
  await app.close()
})
