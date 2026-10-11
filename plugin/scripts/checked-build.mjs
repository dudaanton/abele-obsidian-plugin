#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inputIdentity, invalidateTypes, recordTypes, requireTypes } from './build-inputs.mjs'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(plugin, '..')
const require = createRequire(import.meta.url)
const run = (script, args = []) =>
  execFileSync(process.execPath, [script, ...args], { cwd: plugin, stdio: 'inherit' })
const action = process.argv[2]
if (action === 'types') {
  invalidateTypes(root)
  const before = inputIdentity(root)
  run(require.resolve('typescript/bin/tsc'), ['--noEmit', '--skipLibCheck'])
  run(resolve(plugin, 'scripts/check-strict-null.mjs'))
  recordTypes(root, before)
} else if (action === 'build') {
  const mode = process.argv[3] ?? 'production'
  if (!['production', 'sharing-test'].includes(mode)) throw new Error('Unknown build mode')
  requireTypes(root)
  run(resolve(plugin, 'scripts/verify-sync-inputs.mjs'))
  run(resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), [
    'build',
    '--mode',
    mode,
  ])
} else {
  throw new Error('Expected types or build')
}
