#!/usr/bin/env node
/** Measure verified emitted production bytes, building only when no artifact was requested.
 * Usage: node scripts/bundle-size.mjs [--artifact directory] [--json]
 * Report attribution is approximate; see build-report.mjs. Run outside Vitest so the
 * runner's environment cannot change the bundle that gets measured and shipped. */
import { build } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyArtifact } from './build-artifact.mjs'
export { packageOf, runtimeElements } from './build-report.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export async function measureBundle(artifact) {
  if (!artifact) {
    await build({
      root,
      configFile: path.join(root, 'vite.config.mts'),
      mode: 'production',
      logLevel: 'silent',
    })
  }
  return verifyArtifact(
    path.resolve(root, '..'),
    path.resolve(root, artifact ?? 'build'),
    'production'
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const at = process.argv.indexOf('--artifact')
  if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--')))
    throw new Error('--artifact requires a directory')
  const report = await measureBundle(
    at === -1 ? process.env.ABELE_BUILD_ARTIFACT : process.argv[at + 1]
  )
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(report))
  else {
    const kb = (n) => `${(n / 1024).toFixed(0).padStart(6)} KB`
    console.log(`main.js ${kb(report.mainJsBytes)}   styles ${kb(report.stylesBytes)}`)
    for (const p of report.byPackage.slice(0, 30))
      console.log(`${kb(p.bytes)}  ${(p.share * 100).toFixed(1).padStart(5)}%  ${p.name}`)
  }
}
