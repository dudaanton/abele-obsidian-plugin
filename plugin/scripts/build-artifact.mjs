import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  sourceIdentity,
  historyIdentity,
  sha256,
  inputIdentity,
  atomicJson,
} from './build-inputs.mjs'
import { runtimeElements, reportBundle } from './build-report.mjs'
import { checkBuild } from './release-checks.mjs'
import { assertNoTestingModules } from './production-test-guard.mjs'
import { gitAt } from './changelog-git.mjs'

const assets = ['main.js', 'main.css', 'manifest.json', 'build-report.json']
export function writeArtifact(root, dir, mode, report, provenance = undefined) {
  writeFileSync(resolve(dir, 'manifest.json'), readFileSync(resolve(root, 'manifest.json')))
  atomicJson(resolve(dir, 'build-report.json'), report)
  const files = Object.fromEntries(
    assets.map((name) => [name, sha256(readFileSync(resolve(dir, name)))])
  )
  atomicJson(resolve(dir, 'build-manifest.json'), {
    schema: 1,
    mode,
    provenance: provenance ?? { inputs: inputIdentity(root), git: historyIdentity(root) },
    files,
  })
}

function matchingHistory(root, recorded, current, promotionTag, version) {
  if (JSON.stringify(recorded) === JSON.stringify(current)) return true
  // A candidate contains the committed pending bump. Attaching exactly its lightweight
  // version tag leaves generateChangelog's catalog unchanged; every other tag change is a miss.
  if (
    !promotionTag ||
    promotionTag !== version ||
    !/^\d+\.\d+\.\d+$/.test(promotionTag) ||
    recorded?.revision !== current.revision ||
    recorded?.tree !== current.tree ||
    recorded?.history !== current.history ||
    !Array.isArray(recorded?.tagRefs)
  )
    return false
  const ref = `refs/tags/${promotionTag}`
  const tag = current.tagRefs.find((item) => item.ref === ref)
  if (
    !tag ||
    tag.object !== current.revision ||
    tag.peeled ||
    recorded.tagRefs.some((item) => item.ref === ref)
  )
    return false
  const previous = current.tagRefs.filter((item) => item.ref !== ref)
  return (
    JSON.stringify(previous) === JSON.stringify(recorded.tagRefs) &&
    recorded.tags === sha256(JSON.stringify(previous)) &&
    gitAt(root, ['show', '-s', '--format=%s', current.revision]) ===
      `chore: bump version to ${promotionTag}`
  )
}

export function verifyArtifact(root, dir, mode, { promotionTag } = {}) {
  const manifest = JSON.parse(readFileSync(resolve(dir, 'build-manifest.json'), 'utf8'))
  if (manifest.schema !== 1 || manifest.mode !== mode)
    throw new Error('Artifact mode or schema mismatch')
  const names = readdirSync(dir).sort()
  if (JSON.stringify(names) !== JSON.stringify([...assets, 'build-manifest.json'].sort()))
    throw new Error('Unexpected artifact output')
  if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify([...assets].sort()))
    throw new Error('Artifact checksum inventory mismatch')
  for (const name of assets) {
    if (sha256(readFileSync(resolve(dir, name))) !== manifest.files[name])
      throw new Error(`Artifact checksum mismatch: ${name}`)
  }
  if (
    manifest.provenance?.inputs?.source !== sourceIdentity(root) ||
    !matchingHistory(
      root,
      manifest.provenance?.git,
      historyIdentity(root),
      promotionTag,
      JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')).version
    )
  )
    throw new Error('Artifact provenance does not match source revision and history')
  if (sha256(readFileSync(resolve(root, 'manifest.json'))) !== manifest.files['manifest.json'])
    throw new Error('Artifact version metadata mismatch')
  const javascript = readFileSync(resolve(dir, 'main.js'), 'utf8')
  const report = JSON.parse(readFileSync(resolve(dir, 'build-report.json'), 'utf8'))
  if (mode === 'production') checkBuild(report.files, javascript)
  if (
    report.mainJsBytes !== Buffer.byteLength(javascript) ||
    report.stylesBytes !== readFileSync(resolve(dir, 'main.css')).length ||
    JSON.stringify(report.runtimeElements) !== JSON.stringify(runtimeElements(javascript)) ||
    JSON.stringify([...report.files].sort()) !== '["main.css","main.js"]'
  )
    throw new Error('Artifact report does not match emitted bytes')
  return report
}

/** Every real build writes its report from the very graph that produced the emitted bytes. */
export function buildArtifactPlugin(root, mode) {
  let provenance
  let outDir
  return {
    name: 'abele-build-evidence',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    buildStart() {
      provenance = { inputs: inputIdentity(root), git: historyIdentity(root) }
    },
    writeBundle(_options, bundle) {
      if (mode === 'production') {
        assertNoTestingModules(bundle)
        const js = bundle['main.js']
        checkBuild(Object.keys(bundle), js?.code ?? '')
      }
      const report = reportBundle(bundle)
      if (
        JSON.stringify(provenance.inputs) !== JSON.stringify(inputIdentity(root)) ||
        JSON.stringify(provenance.git) !== JSON.stringify(historyIdentity(root))
      )
        throw new Error('Build inputs changed during emission')
      writeArtifact(root, outDir, mode, report, provenance)
    },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const dir = resolve(process.argv[2] ?? 'build')
  verifyArtifact(root, dir, process.argv[3] ?? 'production', {
    promotionTag: process.env.ABELE_PROMOTION_TAG,
  })
  console.log(
    `Verified ${process.argv[3] ?? 'production'} artifact ${sha256(readFileSync(resolve(dir, 'build-manifest.json')))}`
  )
}
