// @vitest-environment node
import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'

it('keeps the pending-write guard active with fake timers, accepting only cancelled or completed writes', () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const run = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      'tests/fixtures/harness/vitest.config.ts',
    ],
    { cwd: root, encoding: 'utf8', timeout: 25_000 }
  )
  const output = stripVTControlCharacters(run.stdout + run.stderr)
  expect(run.status, output).toBe(1)
  expect(output).toContain('1 failed | 2 passed')
  expect(output).toContain('1 delayed write(s) still waiting')
  expect(output).toContain('left pending')
}, 30_000)
