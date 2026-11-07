import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
execFileSync(
  process.execPath,
  [
    resolve(plugin, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    'tests/scale/unit.config.ts',
    '--maxWorkers=2',
  ],
  { cwd: plugin, stdio: 'inherit' }
)

const tests = readdirSync(resolve(plugin, 'tests/scale'))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => resolve(plugin, 'tests/scale', name))
execFileSync(process.execPath, ['--test', ...tests], {
  cwd: resolve(plugin, '..'),
  stdio: 'inherit',
})
