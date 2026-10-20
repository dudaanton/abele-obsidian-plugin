// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../../scripts/vendor-sync.mjs', import.meta.url))
const temporary: string[] = []
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixtureEntry(exitCode = 0) {
  const root = mkdtempSync(join(tmpdir(), 'sample-sync-compatibility-'))
  temporary.push(root)
  copyFileSync(entry, join(root, 'vendor-sync.mjs'))
  writeFileSync(
    join(root, 'prepare-sync-fixture.mjs'),
    `console.log(JSON.stringify(process.argv.slice(2)));\nconsole.log('ABELE_SYNC_DIR=/sample/fixture');\nprocess.exitCode = ${exitCode};\n`
  )
  return join(root, 'vendor-sync.mjs')
}

it('delegates fixture arguments unchanged and emits one fixture marker', () => {
  const result = spawnSync(
    process.execPath,
    [fixtureEntry(), '/sample/repo with spaces', 'abc123', 'fixture'],
    { encoding: 'utf8' }
  )
  expect(result.status).toBe(0)
  expect(result.stdout.trim().split('\n')).toEqual([
    JSON.stringify(['/sample/repo with spaces', 'abc123']),
    'ABELE_SYNC_DIR=/sample/fixture',
  ])
})

it('preserves a fixture preparation failure', () => {
  const result = spawnSync(process.execPath, [fixtureEntry(7), '/sample/repo', 'abc123', 'fixture'])
  expect(result.status).toBe(7)
})

it.each([
  [],
  ['/sample/repo', 'abc123'],
  ['/sample/repo', 'abc123', 'vendor'],
  ['/sample/repo', 'abc123', 'unknown'],
])('rejects non-fixture mode arguments %j', (...args) => {
  const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('shared code now comes from @abele/sync-sdk')
  expect(result.stdout).not.toContain('ABELE_SYNC_DIR=')
})

it.each([
  ['', 'abc123', 'fixture'],
  ['/sample/repo', '', 'fixture'],
  ['/sample/repo', 'abc123', 'fixture', 'extra'],
])('rejects invalid fixture arguments %j', (...args) => {
  const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Usage:')
  expect(result.stdout).not.toContain('ABELE_SYNC_DIR=')
})
