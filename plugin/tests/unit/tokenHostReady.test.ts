// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { tokenHostReady } from '../e2e/helpers/tokenHostReady'
import { ASYNC_SYNC_PRELUDE, SYNC_PRELUDE } from '../e2e/helpers/syncDriver'

it('waits for delayed host initialization before invoking the reset once', async () => {
  vi.useFakeTimers()
  try {
    let host: { reset(): void } | null = null
    const reset = vi.fn()
    const plugin = {
      get tokenEngines() {
        return host
      },
    }
    expect(() =>
      new Function('app', 'window', SYNC_PRELUDE)({ plugins: { plugins: { abele: plugin } } }, {})
    ).toThrow('Token host is not ready')
    const run = new Function(
      'app',
      'window',
      `return (async()=>{${ASYNC_SYNC_PRELUDE};return host})()`
    )
    const job = run({ plugins: { plugins: { abele: plugin } } }, {}).then(
      (ready: { reset(): void }) => ready.reset()
    )
    await vi.advanceTimersByTimeAsync(5000)
    expect(reset).not.toHaveBeenCalled()
    host = { reset }
    await vi.advanceTimersByTimeAsync(100)
    await job
    expect(reset).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

it('fails a token host that never initializes without invoking any reset', async () => {
  vi.useFakeTimers()
  try {
    const job = expect(tokenHostReady(() => null, 1000)).rejects.toThrow(
      'Token host startup did not complete'
    )
    await vi.advanceTimersByTimeAsync(1000)
    await job
  } finally {
    vi.useRealTimers()
  }
})

it('reports completed plugin startup without a token host as a product failure', async () => {
  await expect(
    tokenHostReady(
      () => null,
      90000,
      () => true
    )
  ).rejects.toThrow('Token host unavailable after plugin startup completed')
})

it('surfaces a recorded token setup error through the actual asynchronous action prelude', async () => {
  const plugin = {
    tokenEngines: null,
    tokenHostStartup: { state: 'failed', error: 'Sample review storage unavailable' },
  }
  const run = new Function('app', 'window', `return (async()=>{${ASYNC_SYNC_PRELUDE}})()`)
  await expect(run({ plugins: { plugins: { abele: plugin } } }, {})).rejects.toThrow(
    'Token host initialization failed: Sample review storage unavailable'
  )
})
