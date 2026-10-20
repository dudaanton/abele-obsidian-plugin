#!/usr/bin/env node
// Compatibility entry for harnesses that still request server fixtures here.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [repository, revision, mode, ...extra] = process.argv.slice(2)
if (mode !== 'fixture') {
  console.error(
    'Vendoring is no longer supported: shared code now comes from @abele/sync-sdk. Use fixture mode for the sync server.'
  )
  process.exitCode = 1
} else if (!repository || !revision || extra.length) {
  console.error('Usage: vendor-sync.mjs <repository> <exact revision> fixture')
  process.exitCode = 1
} else {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./prepare-sync-fixture.mjs', import.meta.url)), repository, revision],
    { stdio: 'inherit' }
  )
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
}
