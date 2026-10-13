import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'

// A short build stamp shown at the bottom of every page, so it is easy to tell which
// version a browser is really running. RENDER_GIT_COMMIT is set by Render during builds.
function buildStamp() {
  let sha = (process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || '').slice(0, 7)
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      sha = 'dev'
    }
  }
  return `${sha} · ${new Date().toISOString().slice(0, 10)}`
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __BUILD_STAMP__: JSON.stringify(buildStamp()) },
})
