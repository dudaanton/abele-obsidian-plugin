/**
 * Where e2e pictures go: one directory per name, under ABELE_E2E_SHOTS when a run sets it (so
 * runs side by side keep their pictures apart), otherwise under /tmp as before.
 *
 * The /tmp cases never touch the real /tmp: a check machine may run the suite where nothing
 * outside its own job directory is writable. They ask which directory would be made instead.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shotDir, shotPath } from '../e2e/helpers/shots'

it.each([false, true])(
  'imports helpers without creating shot roots (phone override: %s)',
  async (override) => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-import-'))
    const shots = join(root, 'missing-shots')
    try {
      vi.stubEnv('ABELE_E2E_SHOTS', shots)
      vi.stubEnv('ABELE_PHONE_SHOTS', override ? join(root, 'missing-phone-shots') : undefined)
      vi.resetModules()
      await import('../e2e/helpers/globalSetup')
      const { SHOTS } = await import('../e2e/helpers/phoneHost')
      expect(SHOTS).toBe(override ? join(root, 'missing-phone-shots') : join(shots, 'abele-iphone'))
      expect(existsSync(shots)).toBe(false)
      expect(existsSync(join(root, 'missing-phone-shots'))).toBe(false)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
      rmSync(root, { recursive: true, force: true })
    }
  }
)

describe('the directory for e2e pictures', () => {
  const before = process.env.ABELE_E2E_SHOTS
  afterEach(() => {
    if (before === undefined) delete process.env.ABELE_E2E_SHOTS
    else process.env.ABELE_E2E_SHOTS = before
  })

  it('is under /tmp when the run names none', () => {
    delete process.env.ABELE_E2E_SHOTS
    expect(shotPath('abele-phone')).toBe('/tmp/abele-phone')
  })

  it('is under the directory the run names, and made there', () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-shots-'))
    try {
      process.env.ABELE_E2E_SHOTS = join(root, 'batch-1')
      const dir = shotDir('sample-pictures')
      expect(dir).toBe(join(root, 'batch-1', 'sample-pictures'))
      // A device writes into it directly, with nothing on the way to make it first.
      expect(existsSync(dir)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ignores an empty setting', () => {
    process.env.ABELE_E2E_SHOTS = ''
    expect(shotPath('abele-tablet')).toBe('/tmp/abele-tablet')
  })

  it('refuses a picture file name, which it would make into a directory', () => {
    delete process.env.ABELE_E2E_SHOTS
    expect(() => shotPath('sample-picture.png')).toThrow(/name, not a directory/)
    expect(() => shotDir('sample-picture.png')).toThrow(/name, not a directory/)
  })
})
