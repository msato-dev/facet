import { expect, test, type Page } from '@playwright/test'
import { launch, setupEnv } from './fixtures'

async function paneEdges(page: Page) {
  const left = await page.getByTestId('left-pane').boundingBox()
  const right = await page.getByTestId('right-pane').boundingBox()
  return {
    leftRight: Math.round(left!.x + left!.width),
    rightLeft: Math.round(right!.x),
    leftW: Math.round(left!.width),
    rightW: Math.round(right!.width),
  }
}

test('UI-01 common header: brand + expansion, 4 tabs, Search, Settings; workspace switch above Sections', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  await expect(page.getByTestId('brand')).toContainText('FACET')
  await expect(page.getByTestId('brand')).toContainText('FACET Arranges Concepts, Evidence, and Text')
  const tabs = await page.getByRole('tab').allTextContents()
  expect(tabs).toEqual(['Canvas', 'Outline', 'Cards', 'Reference'])
  expect(tabs).not.toContain('Manuscript')
  const search = await page.getByTestId('global-search-button').boundingBox()
  const gear = await page.getByTestId('settings-button').boundingBox()
  expect(gear!.x).toBeGreaterThan(search!.x + search!.width - 1)
  expect(Math.abs(gear!.y - search!.y)).toBeLessThan(6)
  const ws = await page.getByTestId('workspace-select').boundingBox()
  const sections = await page.getByTestId('sections').boundingBox()
  expect(ws!.y).toBeLessThan(sections!.y)
  // Workspace switcher lives in the left pane, not in the tab row.
  await expect(page.getByTestId('left-pane').getByTestId('workspace-select')).toBeVisible()
  await expect(page.getByTestId('nav').getByTestId('workspace-select')).toHaveCount(0)
  await app.close()
})

test('UI-02 three panes keep borders on tab switch; independent collapse with rails', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  const before = await paneEdges(page)
  for (const t of ['Outline', 'Cards', 'Reference', 'Canvas']) {
    await page.getByTestId(`tab-${t}`).click()
    expect(await paneEdges(page)).toEqual(before)
  }
  const centerBefore = (await page.getByTestId('center-pane').boundingBox())!.width
  await page.getByTestId('toggle-left').click()
  const leftClosed = (await page.getByTestId('left-pane').boundingBox())!.width
  expect(leftClosed).toBeLessThanOrEqual(31)
  await expect(page.getByTestId('toggle-left')).toBeVisible()
  await expect(page.getByTestId('workspace-select')).toHaveCount(0) // hidden controls are not focusable
  await page.getByTestId('toggle-right').click()
  expect((await page.getByTestId('right-pane').boundingBox())!.width).toBeLessThanOrEqual(31)
  const centerAfter = (await page.getByTestId('center-pane').boundingBox())!.width
  expect(centerAfter).toBeGreaterThan(centerBefore + 400)
  // Collapse state survives tab switches.
  await page.getByTestId('tab-Cards').click()
  expect((await page.getByTestId('left-pane').boundingBox())!.width).toBeLessThanOrEqual(31)
  // Toggling panes does not change selection or scope.
  await page.getByTestId('toggle-left').click()
  await page.getByTestId('toggle-right').click()
  expect(await paneEdges(page)).toEqual(before)
  await app.close()
})

test('UI-03 right pane is Note Editor only on every tab', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  for (const t of ['Canvas', 'Outline', 'Cards', 'Reference']) {
    await page.getByTestId(`tab-${t}`).click()
    const right = page.getByTestId('right-pane')
    await expect(right.getByTestId('note-editor')).toBeVisible()
    await expect(right.getByRole('tab')).toHaveCount(0)
    await expect(right.getByText('Manuscript', { exact: true })).toHaveCount(0)
    await expect(right.getByText('Reference', { exact: true })).toHaveCount(0)
  }
  await app.close()
})
