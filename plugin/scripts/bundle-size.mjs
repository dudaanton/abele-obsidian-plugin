#!/usr/bin/env node
/** Measure verified emitted production bytes, reusing the build/report when present.
 * Usage: node scripts/bundle-size.mjs [--artifact directory] [--json]
 * Report attribution is approximate; see build-report.mjs. Run outside Vitest so the
 * runner's environment cannot change the bundle that gets measured and shipped. */
import { build } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, realpathSync } from 'node:fs'
import { verifyArtifact } from './build-artifact.mjs'
export { packageOf, runtimeElements } from './build-report.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export async function readProductionReport(pluginRoot, artifact, buildProduction = build) {
  const dir = path.resolve(pluginRoot, artifact ?? 'build')
  if (!artifact && !existsSync(path.join(dir, 'build-manifest.json'))) {
    await buildProduction({
      root: pluginRoot,
      configFile: path.join(pluginRoot, 'vite.config.mts'),
      mode: 'production',
      logLevel: 'silent',
    })
  }
  // An existing artifact must verify: never silently replace the just-built check input.
  return verifyArtifact(path.resolve(pluginRoot, '..'), dir, 'production')
}

export async function measureBundle(artifact) {
  return readProductionReport(root, artifact)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
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
