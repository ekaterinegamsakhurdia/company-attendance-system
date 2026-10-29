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

// Search-engine files that need the site's address. The address comes from VITE_SITE_URL (set it to the final
// domain in the host's environment settings) or, on Render, from RENDER_EXTERNAL_URL. Without an address the
// absolute-URL tags (canonical, share image, sitemap) are left out instead of pointing somewhere wrong.
function seo() {
  const raw = (process.env.VITE_SITE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '')
  const site = /^https?:\/\/[^\s/]+$/i.test(raw) ? raw : ''
  const description = "Looper Agency Attendance: clock in and out, track working hours, book vacation and days off, and see the whole team's calendar in one place."
  const graph = [
    { '@type': 'Organization', '@id': site ? `${site}/#org` : undefined, name: 'Looper Agency', alternateName: 'Looper', url: site || undefined, logo: site ? `${site}/icon-512.png` : undefined },
    { '@type': 'WebSite', name: 'Looper Agency Attendance', alternateName: ['Looper Agency attendance system', 'Looper attendance'], url: site ? `${site}/` : undefined, inLanguage: 'en', publisher: site ? { '@id': `${site}/#org` } : undefined },
    { '@type': 'WebApplication', name: 'Looper Agency Attendance', description, applicationCategory: 'BusinessApplication', operatingSystem: 'Any', url: site ? `${site}/` : undefined, image: site ? `${site}/og-image.png` : undefined, author: { '@type': 'Organization', name: 'Looper Agency' } },
  ]
  return {
    name: 'looper-seo',
    transformIndexHtml(html) {
      const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll('<', '\\u003c')
      return html
        .replace(/<!--site-->([\s\S]*?)<!--\/site-->/g, site ? '$1' : '')
        .replaceAll('%SITE_URL%', site)
        .replace('<!--json-ld-->', `<script type="application/ld+json">${jsonLd}</script>`)
    },
    generateBundle() {
      // The sign-in / password pages are for people, not for search results.
      const robots = ['User-agent: *', 'Allow: /', 'Disallow: /set-password', ...(site ? [`Sitemap: ${site}/sitemap.xml`] : []), '']
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots.join('\n') })
      if (site) {
        const lastmod = new Date().toISOString().slice(0, 10)
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${site}/</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>1.0</priority></url>\n</urlset>\n`,
        })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), seo()],
  define: { __BUILD_STAMP__: JSON.stringify(buildStamp()) },
  build: {
    rolldownOptions: {
      output: {
        // Keep the three dashboards (and their tabs) out of the first download: the landing page and the sign-in page
        // only need the libraries and the small shared pieces; a signed-in person fetches the dashboard code next.
        codeSplitting: {
          groups: [
            { name: 'vendor', test: /node_modules/, priority: 20 },
            { name: 'core', test: /src[\\/](components|hooks|lib|services)[\\/]/, priority: 15 },
            { name: 'dashboards', test: /src[\\/]views[\\/](?!Landing|Login|SetPassword)/, priority: 10 },
          ],
        },
      },
    },
  },
})
