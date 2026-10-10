// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { SyncDriver } from '../e2e/helpers/syncDriver'

describe('waiting for a real sync state snapshot', () => {
  it('deletes an engine-written file before Obsidian indexes it', async () => {
    const driver = new SyncDriver(() => {
      throw new Error('No live vault expected')
    })
    let body = ''
    vi.spyOn(driver, 'run').mockImplementation((code) => {
      body = code
      return true as never
    })
    driver.remove(['Shared/remote.md'])
    let exists = true
    const remove = vi.fn(async () => {
      exists = false
    })
    const app = {
      vault: {
        getAbstractFileByPath: () => null,
        adapter: { exists: async () => exists, stat: async () => ({ type: 'file' }), remove },
      },
    }
    await new Function('app', `return (async()=>{${body}})()`)(app)
    expect(remove).toHaveBeenCalledWith('Shared/remote.md')
    expect(exists).toBe(false)
  })
  it('rejects a failed explicit sync rather than reporting a later idle observation as success', async () => {
    const driver = new SyncDriver(() => {
      throw new Error('No live vault expected')
    })
    vi.spyOn(driver, 'long').mockRejectedValue(new Error('Sync interrupted'))
    const idle = vi.spyOn(driver, 'waitIdle')
    await expect(driver.syncNow()).rejects.toThrow('Sync interrupted')
    expect(idle).not.toHaveBeenCalled()
  })
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
