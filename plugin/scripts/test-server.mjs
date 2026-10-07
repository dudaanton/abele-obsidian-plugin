#!/usr/bin/env node
/** Run the server-backed fast tier without hand-setting fixture variables. */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifySyncFixture, verifySyncInputs } from './verify-sync-inputs.mjs'
import { serverTestFixtures, serverTestFixtureRevisions } from './server-test-fixtures.mjs'

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

export function selectServerTests(argv) {
  const args = [...argv]
  const repository = args[0] && !args[0].startsWith('--') ? args.shift() : undefined
  if (args.length && args.shift() !== '--tests')
    throw new Error(
      'Usage: npm run test:server -- [sync-repository] [--tests registered-test-files...]'
    )
  const registered = [...new Set(Object.values(serverTestFixtures).flat())]
  if (args.some((file) => !registered.includes(file)))
    throw new Error('Only registered server-backed tests may be selected')
  const files = args.length ? [...new Set(args)] : registered
  const variables = Object.entries(serverTestFixtures)
    .filter(([, tests]) => tests.some((file) => files.includes(file)))
    .map(([variable]) => variable)
  return { repository, files, variables }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { commit } = verifySyncInputs()
  const { repository, files, variables } = selectServerTests(process.argv.slice(2))
  const env = { ...process.env },
    built = new Map()
  for (const variable of variables) {
    const expected = serverTestFixtureRevisions[variable] ?? commit
    let fixture = env[variable] || (expected === commit ? env.ABELE_SYNC_DIR : undefined)
    if (!fixture && repository) {
      fixture = built.get(expected)
      if (!fixture) {
        // Export exact committed source, never use the repository's mutable dist.
        const output = execFileSync(
          process.execPath,
          [join(plugin, 'scripts/vendor-sync.mjs'), resolve(repository), expected, 'fixture'],
          { cwd: plugin, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }
        )
        process.stdout.write(output)
        fixture = output.match(/^ABELE_SYNC_DIR=(.+)$/m)?.[1]
        built.set(expected, fixture)
      }
    }
    if (!fixture) fixture = locateSyncFixture(scratch, expected)
    if (!fixture)
      throw new Error(
        'No matching prepared fixture; run npm run test:server -- <sync-repository> to build the required archives.'
      )
    // Explicit wrong revisions or changed archives are errors, never fallback candidates.
    env[variable] = verifySyncFixture(fixture, expected)
  }
  const result = spawnSync(
    process.execPath,
    [join(plugin, 'node_modules/vitest/vitest.mjs'), 'run', ...files, '--maxWorkers=2'],
    { cwd: plugin, env, stdio: 'inherit' }
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
