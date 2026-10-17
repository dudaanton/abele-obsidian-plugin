import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyArtifact } from './build-artifact.mjs'
import { atomicJson, sha256 } from './build-inputs.mjs'
import { catalogAssetNames } from './release-checks.mjs'

/** The portable release package carries plugin assets and optional language downloads. Richer build/size evidence
 * stays in the independent production CI artifact, not the published asset inventory. */
export function exportReleaseArtifact(root, source, target, options = {}) {
  verifyArtifact(root, source, 'production', options)
  if (existsSync(target) && readdirSync(target).length)
    throw new Error('Release artifact destination must be empty')
  mkdirSync(target, { recursive: true })
  for (const [emitted, published] of [
    ['main.js', 'main.js'],
    ['main.css', 'styles.css'],
    ['manifest.json', 'manifest.json'],
    ...catalogAssetNames.map((name) => [name, name]),
  ])
    copyFileSync(resolve(source, emitted), resolve(target, published))
  const files = Object.fromEntries(
    ['main.js', 'styles.css', 'manifest.json', ...catalogAssetNames].map((name) => [
      name,
      sha256(readFileSync(resolve(target, name))),
    ])
  )
  const build = JSON.parse(readFileSync(resolve(source, 'build-manifest.json'), 'utf8'))
  atomicJson(resolve(target, 'provenance.json'), { revision: build.provenance.git.revision, files })
  writeFileSync(
    resolve(target, 'SHA256SUMS'),
    Object.entries(files)
      .map(([name, hash]) => `${hash}  ${name}\n`)
      .join('')
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  if (process.argv.length !== 4)
    throw new Error('Usage: export-release-artifact.mjs source destination')
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  exportReleaseArtifact(root, resolve(process.argv[2]), resolve(process.argv[3]), {
    promotionTag: process.env.ABELE_PROMOTION_TAG,
  })
  console.log('Exported verified release assets, checksums and provenance')
}
