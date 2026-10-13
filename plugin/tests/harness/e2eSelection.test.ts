import { afterEach, describe, expect, it, vi } from 'vitest'
import { interimRun, requested } from '../e2e/helpers/target'

describe('e2e run selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('runs every heavy case unless the batch says it is between releases', () => {
    vi.stubEnv('ABELE_E2E_INTERIM', '')
    expect(interimRun()).toBe(false)
    vi.stubEnv('ABELE_E2E_INTERIM', '0')
    expect(interimRun()).toBe(false)
    vi.stubEnv('ABELE_E2E_INTERIM', '1')
    expect(interimRun()).toBe(true)
  })

  it('takes a file asked for only when its variable is exactly 1', () => {
    vi.stubEnv('ABELE_SAMPLE_REQUEST', '')
    expect(requested('ABELE_SAMPLE_REQUEST')).toBe(false)
    vi.stubEnv('ABELE_SAMPLE_REQUEST', 'yes')
    expect(requested('ABELE_SAMPLE_REQUEST')).toBe(false)
    vi.stubEnv('ABELE_SAMPLE_REQUEST', '1')
    expect(requested('ABELE_SAMPLE_REQUEST')).toBe(true)
  })
})
