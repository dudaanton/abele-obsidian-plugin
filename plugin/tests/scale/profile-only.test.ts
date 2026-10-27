import { describe, expect, it, vi } from 'vitest'

describe('profile-only restart capture', () => {
  it('starts and stops a calibrated CPU profile without other debugger domains', async () => {
    const commands: string[] = []
    const debuggerPort = {
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(async (name: string) => {
        commands.push(name)
        if (name === 'Performance.getMetrics')
          return { metrics: [{ name: 'Timestamp', value: 12.5 }] }
        if (name === 'Profiler.stop') return { profile: { samples: [1] } }
        return {}
      }),
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- The host observer is CommonJS.
    const { startProfileOnly } = require('./profile-only.cjs')
    const capture = await startProfileOnly(debuggerPort)
    const result = await capture.stop()
    expect(debuggerPort.attach).toHaveBeenCalledWith('1.3')
    expect(debuggerPort.detach).toHaveBeenCalledOnce()
    expect(commands).toEqual([
      'Performance.enable',
      'Performance.getMetrics',
      'Profiler.enable',
      'Profiler.start',
      'Profiler.stop',
    ])
    expect(result.profile.samples).toEqual([1])
    expect(result.clock.timestampMs).toBe(12500)
  })
})
