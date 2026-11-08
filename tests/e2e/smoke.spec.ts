import { expect, test } from '@playwright/test'
import { launch, setupEnv } from './fixtures'

test('smoke: launches and renders all tabs', async () => {
  const env = await setupEnv()
  const { app, page } = await launch(env.userData)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await expect(page.getByTestId('canvas-view')).toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'test-results/shot-canvas.png' })
  for (const t of ['Outline', 'Cards', 'Reference']) {
    await page.getByTestId(`tab-${t}`).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `test-results/shot-${t.toLowerCase()}.png` })
  }
  expect(errors).toEqual([])
  await app.close()
})
