import { expect, it, vi } from 'vitest'
import { SyncDriver } from '../e2e/helpers/syncDriver'
vi.mock('../e2e/helpers/syncDiagnostics', () => ({
  SYNC_SNAPSHOT: '',
  captureSyncFailure: () => '{"engine":"syncing","holds":60,"screenshot":"sample.png"}',
}))
vi.mock('../e2e/helpers/syncVault', () => ({
  waitFor: async (_label: string, check: () => unknown) => check(),
}))
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
