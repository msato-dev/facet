import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { launch, setTestHook, setupEnv } from './fixtures'

// UI-16 base (ADR-035): two editors of the same note hand over to each other without a self-conflict.
for (const delay of [0, 250]) {
  test(`UI-16 alternating between the Outline inline editor and the right pane never conflicts (save delay ${delay} ms)`, async () => {
    const env = await setupEnv()
    const { app, page } = await launch(env.userData)
    // A slow save (as on CI) keeps the hand-over open while focus moves on to the next editor.
    await setTestHook(app, 'executeDelayMs', delay)
    await page.getByTestId('tab-Outline').click()
    await page.locator(`[data-testid="outline-note"][data-id="${env.zao.noteIds.n7}"]`).dblclick()
    const inline = page.getByTestId('inline-editor').getByTestId('inline-body')
    const right = page.getByTestId('right-pane').getByTestId('note-body')
    const parts: string[] = []
    for (let i = 1; i <= 3; i++) {
      for (const [name, editor] of [
        ['inline', inline],
        ['right', right],
      ] as const) {
        // Focus moves straight from one editor to the other, well within the 500 ms autosave delay.
        await editor.click()
        // No waiting for the other editor's save: typing right away must still land after its text.
        await page.keyboard.press('Control+End')
        const text = ` ${name}${i}.`
        await page.keyboard.type(text)
        parts.push(text.trim())
      }
    }
    await inline.click()
    await expect(inline).toContainText(parts.at(-1)!)
    await expect(page.getByRole('alert').filter({ hasText: '別の場所' })).toHaveCount(0)
    const file = path.join(env.zao.dir, 'notes', `${env.zao.noteIds.n7}.md`)
    await expect.poll(() => readFile(file, 'utf8'), { timeout: 8000 }).toContain(parts.join(' '))
    await app.close()
  })
}
