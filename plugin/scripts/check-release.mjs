import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** A release.sh tag is the version itself, without a prefix. */
export function checkVersions(tag, manifest, pkg) {
  if (!/^\d+\.\d+\.\d+$/.test(tag) || tag !== manifest.version || tag !== pkg.version) {
    throw new Error('Release tag, manifest.json and package.json versions must match.')
  }
}

export function checkBuild(names, javascript) {
  for (const name of ['main.js', 'main.css']) {
    if (!names.includes(name)) throw new Error(`Missing release asset: ${name}`)
  }
  if (names.some((name) => !['main.js', 'main.css', 'styles.css'].includes(name))) {
    throw new Error('Unexpected build output: release must remain a single JavaScript bundle.')
  }
  for (const marker of ['__abeleTest', 'sourceMappingURL']) {
    if (javascript.includes(marker)) throw new Error(`Development marker in release: ${marker}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = JSON.parse(readFileSync('../manifest.json', 'utf8'))
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  checkVersions(process.env.TAG ?? '', manifest, pkg)
  checkBuild(readdirSync('build'), readFileSync('build/main.js', 'utf8'))
  console.log(`Verified production release ${manifest.version}`)
}
