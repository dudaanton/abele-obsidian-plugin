/**
 * The e2e tier's global teardown on a phone gives the phone back last. Every call made after
 * the phone is dropped goes to the phone again, and the driver takes the phone anew for it —
 * for a process that is about to exit, so the next run meets a lock left behind.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: string[] = []

vi.mock('../e2e/helpers/target', () => ({ onPhone: () => true }))
vi.mock('../e2e/helpers/phone', () => ({ driver: vi.fn() }))
vi.mock('../e2e/helpers/phoneHost', () => ({
  assertPhoneReady: vi.fn(),
  installBuild: vi.fn(),
  startHost: vi.fn(),
  takePhone: vi.fn(),
  stopHost: () => calls.push('stopHost'),
  dropPhone: () => calls.push('dropPhone'),
}))
vi.mock('../e2e/helpers/obsidianCli', () => ({
  isObsidianRunning: () => (calls.push('isObsidianRunning'), true),
  hasTestApi: () => (calls.push('hasTestApi'), false),
  closeStrayWindows: () => calls.push('closeStrayWindows'),
  evalJson: () => (calls.push('evalJson'), {}),
  evalRaw: () => (calls.push('evalRaw'), 'ok'),
  restoreDesktopWindow: async () => void calls.push('restoreDesktopWindow'),
  setBackgroundThrottling: () => calls.push('setBackgroundThrottling'),
  setFocusEmulation: () => calls.push('setFocusEmulation'),
}))

describe('the e2e global teardown on a phone', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('does not probe the phone again after releasing a failed setup', async () => {
    const { setup } = await import('../e2e/helpers/globalSetup')
    await expect(setup()).rejects.toThrow('development build')
    expect(calls).toContain('hasTestApi')
    expect(calls[calls.length - 1]).toBe('dropPhone')
  })

  it('drops the phone after every other call', async () => {
    const { teardown } = await import('../e2e/helpers/globalSetup')
    await teardown()
    expect(calls).toContain('dropPhone')
    expect(calls[calls.length - 1]).toBe('dropPhone')
  })

  it('drops the phone even when a call before it throws', async () => {
    const { teardown } = await import('../e2e/helpers/globalSetup')
    const cli = await import('../e2e/helpers/obsidianCli')
    vi.spyOn(cli, 'closeStrayWindows').mockImplementation(() => {
      throw new Error('no answer')
    })
    await teardown().catch(() => undefined)
    expect(calls[calls.length - 1]).toBe('dropPhone')
  })
})
