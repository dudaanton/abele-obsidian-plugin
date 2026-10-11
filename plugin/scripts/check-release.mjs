import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { checkVersions } from './release-checks.mjs'
export { checkBuild, checkVersions } from './release-checks.mjs'

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const manifest = JSON.parse(readFileSync('../manifest.json', 'utf8'))
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  checkVersions(process.env.TAG ?? '', manifest, pkg)
  const { verifyArtifact } = await import('./build-artifact.mjs')
  verifyArtifact(resolve('..'), resolve('build'), 'production', {
    promotionTag: process.env.ABELE_PROMOTION_TAG,
  })
  console.log(`Verified production release ${manifest.version}`)
}
