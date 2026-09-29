/**
 * Where e2e pictures go: one directory per name, under ABELE_E2E_SHOTS when a run sets it (so
 * runs side by side keep their pictures apart), otherwise under /tmp as before.
 */
import { describe, it, expect, afterEach } from 'vitest'
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

  it('is under the directory the run names', () => {
    process.env.ABELE_E2E_SHOTS = '/var/run-pictures/batch-1'
    expect(shotDir('abele-phone')).toBe('/var/run-pictures/batch-1/abele-phone')
  })

  it('ignores an empty setting', () => {
    process.env.ABELE_E2E_SHOTS = ''
    expect(shotDir('abele-tablet')).toBe('/tmp/abele-tablet')
  })
})
