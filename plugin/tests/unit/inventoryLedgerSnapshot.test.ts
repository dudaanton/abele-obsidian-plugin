import { expect, it } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import type { StateEntry } from '@abele/sync-sdk/core'

it('shares fallback ledger enumeration only inside an inventory with an unchanged entry revision', async () => {
  const app = buildFakeVault([{ path: 'sample.md', content: 'sample' }])
  let revision = 0,
    walks = 0
  const rows: StateEntry[] = []
  const ledger = {
    [Symbol.for('abele.sync.local-scan-state-revision-v1')]: async () => revision,
    async *all() {
      walks++
      yield* rows
    },
  }
  const fs = new ObsidianFileSystem(app as never, { ledger: ledger as never })
  const pass = Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1'))
  await pass.call(fs, async () => {
    await Array.fromAsync(fs.list())
    await Array.fromAsync(fs.list())
    expect(walks).toBe(1)
    revision++
    await Array.fromAsync(fs.list())
    expect(walks).toBe(2)
  })
  await pass.call(fs, () => Array.fromAsync(fs.list()))
  expect(walks).toBe(3)
  Reflect.deleteProperty(ledger, Symbol.for('abele.sync.local-scan-state-revision-v1'))
  await pass.call(fs, async () => {
    await Array.fromAsync(fs.list())
    await Array.fromAsync(fs.list())
    expect(walks).toBe(5)
  })
})
