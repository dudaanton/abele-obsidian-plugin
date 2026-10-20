// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const temporary: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true })
})

function emptyHome() {
  const home = mkdtempSync(join(tmpdir(), 'sample-sync-home-'))
  temporary.push(home)
  return home
}

it('loads pure sync unit modules without a server checkout or fixture', () => {
  const home = emptyHome()
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      'tests/unit/syncLiveContracts.test.ts',
      'tests/unit/syncPoolPostcondition.test.ts',
      'tests/unit/tokenHostReady.test.ts',
      '--maxWorkers=2',
    ],
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: {
        ...process.env,
        HOME: home,
        ABELE_SYNC_REPOSITORY: join(home, 'missing-server'),
        ABELE_SYNC_DIR: '',
      },
      encoding: 'utf8',
      timeout: 45_000,
    }
  )
  expect(result.error).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
}, 50_000)

it('still reports a missing checkout when fixture preparation is required', async () => {
  const home = emptyHome()
  vi.stubEnv('HOME', home)
  vi.stubEnv('ABELE_SYNC_REPOSITORY', join(home, 'missing-server'))
  vi.stubEnv('ABELE_SYNC_DIR', '')
  vi.resetModules()
  const { siblingMissing } = await import('../e2e/helpers/syncServer')
  expect(() => siblingMissing()).toThrow(
    'Set ABELE_SYNC_REPOSITORY to an existing abele-sync server checkout'
  )
})
