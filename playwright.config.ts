import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  // On GitHub Actions, failures are also shown as annotations (readable without gh login).
  reporter: process.env.GITHUB_ACTIONS ? [['list'], ['github']] : [['list']],
  use: { trace: 'retain-on-failure' },
})
