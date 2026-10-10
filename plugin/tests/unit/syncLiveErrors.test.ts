import { expect, it, vi } from 'vitest'
import { SyncDriver } from '../e2e/helpers/syncDriver'
vi.mock('../e2e/helpers/syncVault', () => ({
  waitFor: async (_label: string, check: () => unknown) => check(),
}))
it('identifies the failed connection and its safe product reason instead of a generic attention message', async () => {
  const driver = new SyncDriver(
    () =>
      ({
        evalAwait: () => [{ id: 'connection-one', status: 'error', error: 'The server is full.' }],
      }) as never
  )
  await expect(driver.waitIdle()).rejects.toThrow('connection-one: The server is full.')
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
