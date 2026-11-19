import { expect, it, vi } from 'vitest'
import { nativeInputProbe } from '../e2e/helpers/nativeInput'
import { script, endScript, followScript, handoffScript } from '../e2e/helpers/chatScrollMatrix'
import { wideScript } from '../e2e/helpers/chatScrollWide'

vi.mock('../e2e/helpers/shots', () => ({
  shotDir: () => '/sample-shots',
  shotPath: () => '/sample-shots',
}))

it('keeps all default matrix variants free of measurement setup and asynchronous teardown', () => {
  for (const source of [
    script('long', 'idle', false),
    endScript('long', 'text', true),
    followScript(false),
    handoffScript(true),
    wideScript(),
  ]) {
    for (const marker of [
      'scrollBlocking',
      'blocking.',
      'cpuPending',
      'sampleCpu',
      'Performance.getMetrics',
      'extendInputDeadline',
    ])
      expect(source.includes(marker), marker).toBe(false)
  }
  expect(nativeInputProbe(script('long', 'idle', false))).toContain(
    'const inputGesture = nativeDispatch.gesture'
  )
})

it('emits direct blocking guards only for an explicitly measured matrix', () => {
  const source = script('long', 'idle', false, 8000, true)
  expect(source).toContain('blocking.install(require)')
  expect(source).toContain('report.blockingCalls = blocking.calls')
  expect(source).toContain('blocking.stop()')
  expect(source).not.toContain('sampleCpu')
  expect(source).not.toContain('cpuPending')
})

it.each([false, true])('assembles gesture-scoped chat probes with touch=%s', (phone) => {
  for (const source of [
    script('short', 'running-tool', phone),
    script('long', 'idle', phone, 8000, true),
    endScript('long', 'text', phone),
    followScript(phone),
    handoffScript(phone),
    ...(!phone ? [wideScript()] : []),
  ]) {
    const wrapped = nativeInputProbe(source)
    // Probe variants splice async phases and cleanup code into the full scenario.
    // Validate the final renderer program, including the injected awaited teardown.
    expect(() => new Function(`return ${wrapped}`)).not.toThrow()
  }
})
