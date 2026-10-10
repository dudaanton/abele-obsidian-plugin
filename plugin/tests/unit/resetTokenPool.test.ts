import { expect, it } from 'vitest'
import { resetTokenPool } from '../../src/testing/resetTokenPool'

function fixture() {
  const calls: string[] = []
  const ports = {
    vault: 'leased-pool',
    stop: async () => {
      calls.push('stop')
    },
    databases: () => ['owned-ledger', 'owned-reviews', 'owned-ledger'],
    forget: async () => {
      calls.push('forget')
    },
    removeDatabase: async (name: string) => {
      calls.push('delete:' + name)
    },
    restart: async () => {
      calls.push('restart')
    },
  }
  return { calls, ports }
}
it('requires the exact leased vault and explicit confirmation before any effect', async () => {
  const { calls, ports } = fixture()
  await expect(
    resetTokenPool(ports, { vault: 'other', confirm: 'reset-sync-token-state' })
  ).rejects.toThrow()
  await expect(resetTokenPool(ports, { vault: 'leased-pool', confirm: '' })).rejects.toThrow()
  expect(calls).toEqual([])
})
it('drains engines before deleting only explicitly owned token databases', async () => {
  const { calls, ports } = fixture()
  await resetTokenPool(ports, { vault: ports.vault, confirm: 'reset-sync-token-state' })
  expect(calls).toEqual([
    'stop',
    'delete:owned-ledger',
    'delete:owned-reviews',
    'forget',
    'restart',
  ])
})
it('retains registry ownership for retry and stays stopped when deletion fails', async () => {
  const { calls, ports } = fixture()
  ports.removeDatabase = async (name) => {
    calls.push('delete:' + name)
    if (name === 'owned-ledger') throw new Error('blocked')
  }
  await expect(
    resetTokenPool(ports, { vault: ports.vault, confirm: 'reset-sync-token-state' })
  ).rejects.toThrow('Token pool reset failed')
  expect(calls).toEqual(['stop', 'delete:owned-ledger', 'delete:owned-reviews'])
})
