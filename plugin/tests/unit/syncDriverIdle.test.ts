// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { SyncDriver } from '../e2e/helpers/syncDriver'

describe('waiting for a real sync state snapshot', () => {
  it('waits for idle and returns that observation even if a new watcher cycle starts next', async () => {
    vi.useFakeTimers()
    const states = ['syncing', 'idle', 'syncing']
    const vault = {
      evalAwait: (expression: string) =>
        expression.includes('.syncNow()')
          ? 'ok'
          : {
              state: states.shift(),
              pending: 0,
              lastError: null,
            },
    }
    const driver = new SyncDriver(() => vault as never)
    try {
      const waiting = driver.syncNow()
      await vi.advanceTimersByTimeAsync(500)
      const settled = await waiting
      expect(settled.state).toBe('idle')
      expect(driver.status().state).toBe('syncing')
      expect(settled.state).toBe('idle')
    } finally {
      vi.useRealTimers()
    }
  })
})
