import { expect, it, vi } from 'vitest'
import { SyncDriver } from '../e2e/helpers/syncDriver'
vi.mock('../e2e/helpers/syncDiagnostics', () => ({
  SYNC_SNAPSHOT: '',
  captureSyncFailure: () => '{"engine":"syncing","holds":60,"screenshot":"sample.png"}',
}))
vi.mock('../e2e/helpers/syncVault', () => ({
  waitFor: async (_label: string, check: () => unknown) => check(),
}))

it('fails a confidential connect stuck at known 0/0 and reports the safe stall reason', async () => {
  vi.useFakeTimers()
  const driver = new SyncDriver(
    () =>
      ({
        evalAwaitPrivate: (code: string) =>
          code.includes('return {result:')
            ? {
                result: null,
                snapshot: {
                  connections: [
                    {
                      id: 'sample',
                      startupTimings: [],
                      transfer: {
                        stage: 'Downloading',
                        completed: 0,
                        total: 0,
                        totalKnown: true,
                        bytes: 0,
                      },
                    },
                  ],
                },
              }
            : null,
      }) as never
  )
  driver.startupStallMs = 60000
  vi.spyOn(driver, 'rows').mockReturnValue([
    { id: 'sample', status: 'syncing', paused: false, address: 'https://example.test' },
  ])
  try {
    const failure = driver.connect('PRIVATE-TOKEN', undefined, 2168000).then(
      () => new Error('Unexpected successful connect'),
      (error: Error) => error
    )
    await vi.advanceTimersByTimeAsync(60000)
    const error = await failure
    expect(error.message).toContain('Sync startup progress stalled')
    expect(error.message).toContain('sample (syncing)')
    expect(error.message).not.toContain('PRIVATE-TOKEN')
    expect(driver.ended).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

it('keeps the browser stall reason but strips private details from confidential connect errors', async () => {
  const driver = new SyncDriver(
    () =>
      ({
        evalAwaitPrivate: () => ({
          ok: false,
          error: 'Sync startup progress stalled: PRIVATE-TOKEN',
        }),
      }) as never
  )
  vi.spyOn(driver, 'rows').mockReturnValue([])
  const error = await driver.connect('PRIVATE-TOKEN').then(
    () => new Error('Unexpected successful connect'),
    (error: Error) => error
  )
  expect(error.message).toContain('Sync startup progress stalled')
  expect(error.message).not.toContain('PRIVATE-TOKEN')
})
it('a timed-out case cannot launch UI actions after teardown has started', async () => {
  const evalAwait = vi.fn(),
    evalAwaitPrivate = vi.fn()
  const driver = new SyncDriver(() => ({ evalAwait, evalAwaitPrivate }) as never)
  driver.retire()
  await expect(driver.long('connect', 'private token', true)).rejects.toThrow('case has ended')
  expect(() => driver.run('create another connection')).toThrow('case has ended')
  expect(evalAwait).not.toHaveBeenCalled()
  expect(evalAwaitPrivate).not.toHaveBeenCalled()
})
it('identifies the failed connection and its safe product reason instead of a generic attention message', async () => {
  const driver = new SyncDriver(
    () =>
      ({
        // The settle runs in the page and answers in the call that starts it.
        evalAwait: () => ({
          ok: true,
          value: [{ id: 'connection-one', status: 'error', error: 'The server is full.' }],
        }),
      }) as never
  )
  await expect(driver.waitIdle()).rejects.toThrow('connection-one: The server is full.')
})
it('captures a private action launch failure without printing its private eval error', async () => {
  const driver = new SyncDriver(
    () =>
      ({
        evalAwait: vi.fn(),
        evalAwaitPrivate: () => {
          throw new Error('PRIVATE-TOKEN')
        },
      }) as never
  )
  await expect(driver.long('connect', 'private body', true)).rejects.toThrow('sample.png')
  await expect(driver.long('connect', 'private body', true)).rejects.not.toThrow('PRIVATE-TOKEN')
})
it('reports the connection state after a confidential connect fails without exposing the pasted token', async () => {
  const driver = new SyncDriver(() => ({}) as never)
  vi.spyOn(driver, 'long').mockRejectedValue(new Error('connect by token failed'))
  vi.spyOn(driver, 'rows').mockReturnValue([
    {
      id: 'second',
      status: 'offline',
      paused: false,
      address: 'https://example.test',
      error: 'The server is not reachable.',
    },
  ])
  await expect(driver.connect('PRIVATE-TOKEN')).rejects.toThrow(
    'second (offline): The server is not reachable.'
  )
})
