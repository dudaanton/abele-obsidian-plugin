#!/usr/bin/env node
/** Run the server-backed fast tier without hand-setting fixture variables. */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifySyncFixture, verifySyncInputs } from './verify-sync-inputs.mjs'
import { serverTestFixtures } from './server-test-fixtures.mjs'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = resolve(plugin, '../.scratch/sync-inputs')

export function locateSyncFixture(directory, commit) {
  if (!existsSync(directory)) return undefined
  for (const name of readdirSync(directory).sort()) {
    if (!name.startsWith('fixture-')) continue
    const source = join(directory, name, 'source')
    const marker = join(source, '.abele-sync-fixture.json')
    if (!existsSync(marker)) continue
    if (JSON.parse(readFileSync(marker, 'utf8')).commit === commit)
      return verifySyncFixture(source, commit)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { commit } = verifySyncInputs()
  const [repository, ...extra] = process.argv.slice(2)
  if (extra.length) throw new Error('Usage: npm run test:server -- [sync-repository]')
  let fixture
  if (repository) {
    // Export/build only the exact pinned commit, never the repository's mutable dist.
    const output = execFileSync(
      process.execPath,
      [join(plugin, 'scripts/vendor-sync.mjs'), resolve(repository), commit, 'fixture'],
      { cwd: plugin, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }
    )
    process.stdout.write(output)
    fixture = verifySyncFixture(output.match(/^ABELE_SYNC_DIR=(.+)$/m)?.[1], commit)
  } else {
    fixture = process.env.ABELE_SYNC_DIR
      ? verifySyncFixture(process.env.ABELE_SYNC_DIR, commit)
      : locateSyncFixture(scratch, commit)
  }
  if (!fixture)
    throw new Error(
      'No matching prepared fixture; run npm run test:server -- <sync-repository> to build the pinned archive.'
    )
  const env = { ...process.env }
  for (const variable of Object.keys(serverTestFixtures)) {
    // Preserve explicit inputs and reject changed/wrong-revision archives rather than skipping.
    env[variable] = verifySyncFixture(env[variable] || fixture, commit)
  }
  const result = spawnSync(
    process.execPath,
    [
      join(plugin, 'node_modules/vitest/vitest.mjs'),
      'run',
      ...Object.values(serverTestFixtures).flat(),
    ],
    { cwd: plugin, env, stdio: 'inherit' }
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
