import { afterEach, describe, expect, it, vi } from 'vitest'
import { emulationCovered, interimRun, requested, skipReason } from '../e2e/helpers/target'

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

  it('skips the emulated phone only where the real phone in the same batch repeats it', () => {
    const both = "targets('desktop', 'phone')"
    const real = { ABELE_E2E_REAL_PHONE: '1' }
    expect(emulationCovered('/e2e/sampleCase.e2e.test.ts', both, real)).toBe(true)
    // No real phone in this batch, a desktop-only file, or a file whose emulation checks more.
    expect(emulationCovered('/e2e/sampleCase.e2e.test.ts', both, {})).toBe(false)
    expect(emulationCovered('/e2e/sampleCase.e2e.test.ts', "targets('desktop')", real)).toBe(false)
    expect(emulationCovered('/e2e/sampleCase.e2e.test.ts', '', real)).toBe(false)
    expect(emulationCovered('/e2e/footerTaskClick.e2e.test.ts', both, real)).toBe(false)
    expect(emulationCovered('/e2e/codeIndentGuides.e2e.test.ts', both, real)).toBe(false)
    expect(emulationCovered(undefined, both, real)).toBe(false)
  })

  it('records why a case was skipped where the JSON report carries it', () => {
    const task = { meta: {} as Record<string, unknown> }
    skipReason(task, 'skipped: the real phone checks this layout in the same batch')
    expect(task.meta.skipReason).toBe(
      'skipped: the real phone checks this layout in the same batch'
    )
  })
})
