// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { SyncDriver } from '../e2e/helpers/syncDriver'
import * as diagnostics from '../e2e/helpers/syncDiagnostics'

describe('waiting for a real sync state snapshot', () => {
  it('serializes transfer counts and bytes into diagnostics without replacing them with a state label', () => {
    const transfer = {
      stage: 'Downloading',
      completed: 2,
      total: 8,
      totalKnown: true,
      bytes: 1024,
      totalBytes: 4096,
    }
    const app = {
      setting: { activeTab: null },
      plugins: {
        plugins: {
          abele: {
            tokenEngines: {
              ui: {
                rows: { value: [{ id: 'sample', status: 'syncing' }] },
                activity: { value: { sample: { transfer } } },
              },
            },
          },
        },
      },
    }
    const snapshot = new Function(
      'app',
      'document',
      'window',
      'performance',
      diagnostics.SYNC_SNAPSHOT + ';return syncSnapshot()'
    )(app, { querySelectorAll: () => [] }, {}, { timeOrigin: 0 })
    expect(snapshot.connections[0].statusText).toBe('Downloading · 2 of 8 files · 1 of 4 KB')
    expect(snapshot.connections[0].transfer).toEqual(transfer)
  })
  it('passes a caller timeout to the connect action and includes transfer progress in both waits', async () => {
    const driver = new SyncDriver(() => {
      throw new Error('No live vault expected')
    })
    const long = vi.spyOn(driver, 'long').mockResolvedValue('sample-connection')
    await driver.connect('sample-token', undefined, 150000)
    expect(long.mock.calls[0][3]).toBe(150000)
    expect(long.mock.calls[0][1]).toContain('activity.transfer')
  })
  it('captures a pending long operation before the test timeout can remove its connection', async () => {
    vi.useFakeTimers()
    let finished = false
    const cli = {
      evalAwait: vi.fn((code: string) =>
        code.includes('return true})()') ? true : finished ? { ok: true, value: 'done' } : null
      ),
    }
    const capture = vi.spyOn(diagnostics, 'captureSyncProgress').mockImplementation(() => {})
    const driver = new SyncDriver(() => cli as never)
    try {
      const result = driver.long('large attachment', 'await slowOperation()', false, 600000)
      await vi.advanceTimersByTimeAsync(30500)
      expect(capture).toHaveBeenCalledWith(cli, 'large attachment')
      expect(driver.ended).toBe(false)
      finished = true
      await vi.advanceTimersByTimeAsync(500)
      expect(await result).toBe('done')
    } finally {
      capture.mockRestore()
      vi.useRealTimers()
    }
  })
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
    // The wait runs in the page now, in the same action as the sync: run what syncNow sends
    // against a connection that goes syncing, idle, syncing again.
    const driver = new SyncDriver(() => {
      throw new Error('No live vault expected')
    })
    const states = ['syncing', 'idle', 'syncing']
    let status = 'syncing'
    const svc = {
      rows: {
        get value() {
          return [{ id: 'sample', status, paused: false, address: 'https://sync.example' }]
        },
      },
      activity: { value: {} },
      sync: async () => {},
    }
    // A new cycle starts the moment the wait is satisfied.
    const poll = async (fn: () => unknown) => {
      for (;;) {
        status = states.shift() ?? status
        if (await fn()) {
          status = 'syncing'
          return true
        }
      }
    }
    vi.spyOn(driver, 'long').mockImplementation(async (_what, body) =>
      new Function('svc', 'poll', `return (async()=>{${body}})()`)(svc, poll)
    )
    const settled = await driver.syncNow()
    expect(settled[0].status).toBe('idle')
    expect(status).toBe('syncing')
  })
})
