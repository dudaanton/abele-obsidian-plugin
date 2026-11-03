import { expect, it, vi } from 'vitest'
import { settleSyncPeers } from '../e2e/helpers/syncQuiescence'

it.each([undefined, null, NaN, -1, 1.5])('refuses an invalid server head %s', async (value) => {
  const peer = vi.fn(async () => {})
  await expect(settleSyncPeers(async () => value as number, [peer])).rejects.toThrow('server head')
  expect(peer).not.toHaveBeenCalled()
})

it('runs another complete peer round after the recipient advances the head', async () => {
  let head = 0,
    delivered = 0
  const primary = vi.fn(async () => {
    delivered = head
  })
  const peer = vi.fn(async () => {
    head = 1
  })
  await settleSyncPeers(async () => head, [primary, peer])
  expect(delivered).toBe(1)
  expect(primary).toHaveBeenCalledTimes(2)
  expect(peer).toHaveBeenCalledTimes(2)
})
