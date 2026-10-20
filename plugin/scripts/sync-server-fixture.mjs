import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { SERVER_TEST_COMMIT } from './server-test-fixtures.mjs'
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const read = (file) => JSON.parse(readFileSync(file, 'utf8'))

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
