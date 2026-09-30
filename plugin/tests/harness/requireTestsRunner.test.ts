// @vitest-environment node
import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

it.each([
  ['unavailable', 1],
  ['available', 0],
] as const)('exits honestly for a collected %s test', (name, status) => {
  const root = path.resolve(import.meta.dirname, '../..')
  const run = spawnSync(process.execPath, [
    path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', 'tests/fixtures/harness/vitest.zero.config.ts', '-t', `^${name}$`,
  ], { cwd: root, encoding: 'utf8', timeout: 25_000 })
  const output = run.stdout + run.stderr
  expect(run.status, output).toBe(status)
  if (status === 1) expect(output).toContain('No e2e tests ran')
  else expect(output).not.toContain('No e2e tests ran')
}, 30_000)
