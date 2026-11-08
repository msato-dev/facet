import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Strict CSP is injected for production builds only; the dev server needs inline HMR preambles.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"

function cspPlugin(): Plugin {
  return {
    name: 'facet-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
  }
}

export default defineConfig({
  main: {
    // Bundle every dependency (many are ESM-only) so the packaged app needs no node_modules resolution.
    build: { externalizeDeps: false },
  },
  preload: {
    build: { externalizeDeps: false },
  },
  renderer: {
    plugins: [react(), cspPlugin()],
  },
})
