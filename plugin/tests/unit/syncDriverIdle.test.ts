// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { SyncDriver, SYNC_PRELUDE } from '../e2e/helpers/syncDriver'
import * as diagnostics from '../e2e/helpers/syncDiagnostics'

it('shares using the populated replacement select rather than the detached loading select', async () => {
  const driver = new SyncDriver(() => {
    throw new Error('No live vault expected')
  })
  let body = ''
  vi.spyOn(driver, 'long').mockImplementation(async (_label, code) => {
    body = code
    return 'sample-token' as never
  })
  await driver.share('sample', 'Folder: Shared')
  const old = { options: [] }
  const populated = {
    options: [{ textContent: 'Folder: Shared', value: '1' }],
    value: '',
    ownerDocument: { defaultView: { Event } },
    dispatchEvent: vi.fn(),
  }
  let current: { options: { textContent: string; value: string }[] } = old
  const name = { value: '' },
    issued = { value: 'sample-token' }
  const box = {
    querySelector: (selector: string) =>
      selector === 'select' ? current : selector === 'textarea' ? issued : name,
  }
  let polls = 0
  const poll = async (check: () => boolean) => {
    if (++polls === 2) current = populated
    expect(await check(), 'poll must observe the live populated select').toBeTruthy()
  }
  const execute = new Function(
    'openSyncTab',
    'icon',
    'connectionRow',
    'modal',
    'poll',
    'typeInto',
    'press',
    'closeSettings',
    `return (async()=>{${body}})()`
  )
  expect(
    await execute(
      async () => ({}),
      () => {},
      () => ({}),
      () => box,
      poll,
      (input: HTMLInputElement, text: string) => {
        input.value = text
      },
      async () => {},
      async () => {}
    )
  ).toBe('sample-token')
  expect(name.value).toBe('Sample recipient')
  expect(populated.value).toBe('1')
})

it.each([true, false])(
  'explains a missing indexed note when its disk existence is %s',
  async (disk) => {
    const driver = new SyncDriver(() => {
      throw new Error('No live vault expected')
    })
    let body = ''
    vi.spyOn(driver, 'run').mockImplementation((code) => {
      body = code
      return true as never
    })
    driver.open('Notes/member.md')
    const exists = vi.fn(async () => disk),
      read = vi.fn()
    const app = {
      vault: {
        getFileByPath: () => null,
        getAbstractFileByPath: () => ({}),
        adapter: { exists, read },
      },
    }
    const host = {
      live: new Map([
        [
          'sample',
          {
            trace: {
              snapshot: () => ({
                lastPull: {
                  paths: ['Notes/root.md', 'Notes/member.md'],
                  writes: 2,
                  complete: true,
                },
              }),
            },
          },
        ],
      ]),
    }
    const svc = { rows: { value: [{ id: 'sample', status: 'idle' }] } }
    const execute = new Function('app', 'host', 'svc', `return (async()=>{${body}})()`)
    await expect(execute(app, host, svc)).rejects.toThrow(`"disk":${disk}`)
    await expect(execute(app, host, svc)).rejects.toThrow('"parent":true')
    await expect(execute(app, host, svc)).rejects.toThrow('Notes/member.md')
    expect(read).not.toHaveBeenCalled()
  }
)

describe('waiting for a real sync state snapshot', () => {
  it('keeps the failed sharing condition in confidential diagnostics without exposing the token', async () => {
    const cli = {
      evalAwaitPrivate: () => ({
        ok: false,
        error: 'sample-secret-token',
        waiting: 'enabled Create token button',
      }),
    }
    const capture = vi.spyOn(diagnostics, 'captureSyncFailure').mockReturnValue('sample snapshot')
    try {
      const driver = new SyncDriver(() => cli as never)
      const error = await driver.long('issue sharing token', '', true).catch((error) => error)
      expect(error.message).toContain('waiting for enabled Create token button')
      expect(error.message).not.toContain('sample-secret-token')
    } finally {
      capture.mockRestore()
    }
  })
  it('lets browser waits use the caller budget beyond twenty seconds and names their condition', async () => {
    vi.useFakeTimers()
    const window = { __abeleSyncActionTimeoutMs: 60000 }
    const debug = vi.fn()
    const poll = new Function('app', 'window', 'console', SYNC_PRELUDE + ';return poll')(
      { plugins: { plugins: { abele: { tokenEngines: { ui: {} } } } } },
      window,
      { debug }
    )
    const started = Date.now()
    try {
      const result = expect(
        poll(() => Date.now() - started >= 25000, undefined, 'sharing choices ready')
      ).resolves.toBe(true)
      await vi.advanceTimersByTimeAsync(26000)
      await result
      expect(debug).toHaveBeenCalledWith('[sync wait]', 'sharing choices ready', expect.any(Object))
    } finally {
      vi.useRealTimers()
    }
  })
  it('uses the caller default for both owner connect and share', async () => {
    const driver = new SyncDriver(() => {
      throw new Error('No live vault expected')
    })
    driver.timeoutMs = 150000
    const long = vi.spyOn(driver, 'long').mockResolvedValue('sample')
    await driver.connect('sample-token')
    await driver.share('sample', 'Whole vault')
    expect(long.mock.calls[0][3]).toBe(150000)
    expect(long.mock.calls[1][3]).toBe(150000)
  })
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
    )(app, { querySelectorAll: () => [] }, {}, { timeOrigin: 0, getEntriesByName: () => [] })
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
