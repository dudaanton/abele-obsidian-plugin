#!/usr/bin/env node
/**
 * Builds the production bundle in memory and says where its bytes go.
 *
 * Usage (from `plugin/`):
 *   node scripts/bundle-size.mjs            # table of the heaviest packages
 *   node scripts/bundle-size.mjs --json     # the whole report as JSON on stdout
 *
 * Nothing is written to `build/`. The per-package split counts each module's code as Rollup
 * rendered it — after tree-shaking, before minification — scaled to the minified total, so it
 * says which package is heavy rather than its size to the kilobyte: already-minified code (the
 * MapLibre worker) reads a little small, hand-written code a little large.
 *
 * Run as its own process on purpose. Inside Vitest the same build comes out ~10 KB larger —
 * the test runner's environment leaks into the build — so `tests/size/` calls this script.
 */
import { build } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** `node_modules/@scope/name/...` → `@scope/name`; our own code by its folder under `src/`. */
export function packageOf(id) {
  const clean = id.replace(/^\0/, '').split('?')[0]
  const nm = clean.lastIndexOf('node_modules/')
  if (nm !== -1) {
    const parts = clean.slice(nm + 'node_modules/'.length).split('/')
    return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
  }
  if (clean.startsWith('virtual:maplibre-worker')) return 'maplibre-gl (worker)'
  const src = clean.indexOf('/src/')
  if (src !== -1) {
    const rest = clean.slice(src + 1).split('/')
    return rest.length > 2 ? `${rest[0]}/${rest[1]}` : rest.join('/')
  }
  return clean
}

export async function measureBundle() {
  const rendered = new Map()
  const collect = {
    name: 'abele-size-collect',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue
        for (const [id, mod] of Object.entries(file.modules)) {
          const name = packageOf(id)
          rendered.set(name, (rendered.get(name) ?? 0) + mod.renderedLength)
        }
      }
    },
  }

  const result = await build({
    root,
    configFile: path.join(root, 'vite.config.mts'),
    mode: 'production',
    logLevel: 'silent',
    plugins: [collect],
    build: { write: false },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output)
  const js = outputs.find((o) => o.type === 'chunk' && o.fileName === 'main.js')
  const css = outputs.find((o) => o.type === 'asset' && o.fileName.endsWith('.css'))
  if (!js) throw new Error('The build produced no main.js')

  const mainJsBytes = Buffer.byteLength(js.code)
  const stylesBytes = css ? Buffer.byteLength(css.source) : 0
  const total = [...rendered.values()].reduce((a, b) => a + b, 0)
  const byPackage = [...rendered.entries()]
    .map(([name, bytes]) => ({
      name,
      bytes: Math.round((bytes / total) * mainJsBytes),
      share: bytes / total,
    }))
    .sort((a, b) => b.bytes - a.bytes)
  return { mainJsBytes, stylesBytes, files: outputs.map((o) => o.fileName), byPackage }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const report = await measureBundle()
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report))
  } else {
    const kb = (n) => `${(n / 1024).toFixed(0).padStart(6)} KB`
    console.log(`main.js ${kb(report.mainJsBytes)}   styles ${kb(report.stylesBytes)}`)
    for (const p of report.byPackage.slice(0, 30))
      console.log(`${kb(p.bytes)}  ${(p.share * 100).toFixed(1).padStart(5)}%  ${p.name}`)
  }
}
