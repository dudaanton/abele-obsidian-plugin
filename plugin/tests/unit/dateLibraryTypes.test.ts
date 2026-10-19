// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('preserves plugin types for standalone consumers without loading the application', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'sample-date-types-'))
  const plugin = fileURLToPath(new URL('../../', import.meta.url))
  try {
    const config = join(scratch, 'tsconfig.json')
    writeFileSync(
      config,
      JSON.stringify({
        extends: resolve(plugin, 'tsconfig.json'),
        compilerOptions: { noEmit: true, skipLibCheck: true },
        include: [
          resolve(plugin, 'tests/unit/dateLibrary.test.ts'),
          resolve(plugin, 'tests/unit/sharedNotesInterop.test.ts'),
        ],
      })
    )
    const require = createRequire(import.meta.url)
    const result = spawnSync(
      process.execPath,
      [require.resolve('typescript/bin/tsc'), '-p', config],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    expect(result.stdout + result.stderr).toBe('')
    expect(result.status).toBe(0)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}, 10_000)
