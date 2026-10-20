// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { syncPlacementPlugin } from '../../scripts/sync-placement.mjs'

const root = resolve('node_modules/@abele/sync-sdk')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const paths: string[] = []
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})
function sample(installedVersion = version, module = 'cycle.js') {
  const temp = mkdtempSync(join(tmpdir(), 'sample-placement-'))
  paths.push(temp)
  const pkg = join(temp, 'node_modules/sample/node_modules/@abele/sync-sdk')
  mkdirSync(join(pkg, 'dist/internal/core'), { recursive: true })
  const id = join(pkg, 'dist/internal/core', module)
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: '@abele/sync-sdk', version: installedVersion })
  )
  const input = readFileSync(join(root, 'dist/internal/core', module), 'utf8')
  writeFileSync(id, input)
  return { id, input, temp, pkg }
}
it.each([
  'cycle.js',
  'scanner.js',
  'localPaths.js',
  'pullRun.js',
  'pullPlace.js',
  'pullRecovery.js',
  'pusher.js',
  'v2Directories.js',
  'v2Client.js',
])('passes %s through a second plugin instance and query id unchanged', (module) => {
  const { id, input } = sample(version, module)
  const first = syncPlacementPlugin().transform(input, id)!
  expect(first.code).toContain('abele-sync-placement-v1:')
  expect(syncPlacementPlugin().transform(first.code, id + '?v=sample')).toEqual(first)
})
it('handles a symlinked installation without sharing transform state', () => {
  const { id, input, temp, pkg } = sample()
  const alias = join(temp, 'alias/node_modules/@abele/sync-sdk')
  mkdirSync(join(temp, 'alias/node_modules/@abele'), { recursive: true })
  symlinkSync(pkg, alias)
  const plugin = syncPlacementPlugin()
  expect(plugin.transform(input, join(alias, 'dist/internal/core/cycle.js'))).toEqual(
    plugin.transform(input, id)
  )
})
it('reports a stale nested installation before trying placement boundaries', () => {
  const { id } = sample('0.0.0-stale')
  expect(() => syncPlacementPlugin().transform('', id)).toThrow(
    `installed @abele/sync-sdk 0.0.0-stale does not match the pinned ${version}; run npm ci`
  )
})
it.each([0, 2])('fails closed with the file, boundary and count %i', (count) => {
  const { id } = sample()
  expect(() => syncPlacementPlugin().transform('async cycle() {'.repeat(count), id)).toThrow(
    `Unsupported sync placement boundary in ${id}: "async cycle() {"; found ${count}, expected 1`
  )
})
it('rejects damaged marked output', () => {
  const { id, input } = sample()
  const output = syncPlacementPlugin().transform(input, id)!
  expect(() => syncPlacementPlugin().transform(output.code + '\nchanged', id)).toThrow(/marker/i)
})
it('rejects modified installed bytes even with the pinned version', () => {
  const { id, input } = sample()
  writeFileSync(id, input + '\nchanged')
  expect(() => syncPlacementPlugin().transform(input, id)).toThrow(/integrity.*run npm ci/i)
})
