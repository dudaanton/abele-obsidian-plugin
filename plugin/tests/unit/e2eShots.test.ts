/**
 * Where e2e pictures go: one directory per name, under ABELE_E2E_SHOTS when a run sets it (so
 * runs side by side keep their pictures apart), otherwise under /tmp as before.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shotDir } from '../e2e/helpers/shots'

describe('the directory for e2e pictures', () => {
  const before = process.env.ABELE_E2E_SHOTS
  afterEach(() => {
    if (before === undefined) delete process.env.ABELE_E2E_SHOTS
    else process.env.ABELE_E2E_SHOTS = before
  })

  it('is under /tmp when the run names none', () => {
    delete process.env.ABELE_E2E_SHOTS
    expect(shotDir('abele-phone')).toBe('/tmp/abele-phone')
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
    expect(shotDir('abele-tablet')).toBe('/tmp/abele-tablet')
  })

  it('refuses a picture file name, which it would make into a directory', () => {
    delete process.env.ABELE_E2E_SHOTS
    expect(() => shotDir('sample-picture.png')).toThrow(/name, not a directory/)
  })
})
