import { createHash } from 'node:crypto'
import { readFileSync, lstatSync, realpathSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVER_TEST_COMMIT } from './server-test-fixtures.mjs'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
export function verifySyncInputs(root = plugin) {
  root = realpathSync(root)
  const provenance = read(join(root, 'vendor/sync/provenance.json'))
  const names = ['@abele/sync-core', '@abele/sync-protocol']
  if (
    !/^[a-f0-9]{40}$/.test(provenance.commit ?? '') ||
    !/^[a-f0-9]{64}$/.test(provenance.lockSha256 ?? '') ||
    !provenance.packages ||
    Object.keys(provenance.packages).length !== names.length ||
    names.some((name) => !provenance.packages[name])
  )
    throw new Error('Incomplete sync input provenance')
  const manifest = read(join(root, 'package.json'))
  const lock = read(join(root, 'package-lock.json'))
  for (const [name, input] of Object.entries(provenance.packages)) {
    if (
      !/^[a-f0-9]{40}$/.test(input.tree ?? '') ||
      !input.files ||
      ['package.json', 'dist/index.js', 'dist/index.d.ts'].some((path) => !input.files[path])
    ) {
      throw new Error(`Incomplete sync package inventory: ${name}`)
    }
    const reference = `file:vendor/sync/${input.archive}`
    if (manifest.dependencies[name] !== reference)
      throw new Error(`Unpinned sync dependency: ${name}`)
    if (sha(join(root, 'vendor/sync', input.archive)) !== input.sha256)
      throw new Error(`Sync archive checksum mismatch: ${name}`)
    const locked = lock.packages[`node_modules/${name}`]
    if (locked?.resolved !== reference || locked?.integrity !== input.integrity || locked?.link)
      throw new Error(`Unpinned sync lock entry: ${name}`)
    const installed = join(root, 'node_modules', name)
    if (lstatSync(installed).isSymbolicLink() || realpathSync(installed) !== resolve(installed))
      throw new Error(`Linked sync package refused: ${name}`)
    for (const [path, expected] of Object.entries(input.files)) {
      if (sha(join(installed, path)) !== expected)
        throw new Error(`Installed sync input mismatch: ${name}/${path}`)
    }
  }
  return provenance
}

/** Explicit immutable server fixture; absent/wrong input is a failure, never a fallback. */
export function verifySyncFixture(dir, expected = SERVER_TEST_COMMIT) {
  if (!dir) throw new Error('ABELE_SYNC_DIR must name an explicitly prepared sync fixture')
  const root = realpathSync(dir)
  const path = join(root, '.abele-sync-fixture.json')
  if (!existsSync(path)) throw new Error('Sync fixture has no clean-archive build provenance')
  const fixture = read(path)
  if (fixture.commit !== expected)
    throw new Error('Sync fixture revision does not match the required server input')
  if (sha(join(root, 'package-lock.json')) !== fixture.lockSha256)
    throw new Error('Sync fixture lockfile changed')
  if (
    !fixture.files ||
    !fixture.files['packages/server/dist/index.js'] ||
    !fixture.files['packages/cli/dist/index.js']
  )
    throw new Error('Sync fixture is incomplete')
  for (const [file, checksum] of Object.entries(fixture.files)) {
    if (sha(join(root, file)) !== checksum) throw new Error(`Sync fixture input changed: ${file}`)
  }
  return root
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifySyncInputs()
  console.log('sync inputs: pinned archives and installed payloads verified')
}
