// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { SyncDriver } from '../e2e/helpers/syncDriver'

describe('waiting for a real sync state snapshot', () => {
  it('waits for idle and returns that observation even if a new watcher cycle starts next', async () => {
    vi.useFakeTimers()
    const states = ['syncing', 'idle', 'syncing']
    const driver = new SyncDriver(() => {
      throw new Error('No live vault expected')
    })
    vi.spyOn(driver, 'long').mockResolvedValue(true)
    vi.spyOn(driver, 'rows').mockImplementation(() => [
      { id: 'sample', status: states.shift()!, paused: false, address: 'https://sync.example' },
    ])
    try {
      const waiting = driver.syncNow()
      await vi.advanceTimersByTimeAsync(500)
      const settled = await waiting
      expect(settled[0].status).toBe('idle')
      expect(driver.rows()[0].status).toBe('syncing')
      expect(settled[0].status).toBe('idle')
    } finally {
      vi.useRealTimers()
    }
  })
})
