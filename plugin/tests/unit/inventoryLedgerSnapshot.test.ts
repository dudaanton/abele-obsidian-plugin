import { expect, it, vi } from 'vitest'
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

it.each([
  { limit: 'elapsed time', count: 1000, rowMs: 1, maximumSlice: 8 },
  { limit: 'row count', count: 33000, rowMs: 0, maximumSlice: 4096 },
])(
  'yields during ledger snapshot collection at the $limit limit',
  async ({ count, rowMs, maximumSlice }) => {
    const app = buildFakeVault([])
    let collected = 0,
      ticks = 0,
      walks = 0
    const checkpoints: number[] = []
    const rows = Array.from({ length: count }, (_, i) => ({
      path: `sample-${i}.md`,
      wirePath: `sample-${i}.md`,
      fileId: `sample-${i}`,
      versionId: 'v1',
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1,
    }))
    const ledger = {
      [Symbol.for('abele.sync.local-scan-state-revision-v1')]: async () => 0,
      async *all() {
        walks++
        for (const row of rows) {
          collected++
          ticks += rowMs
          yield row
        }
      },
    }
    const fs = new ObsidianFileSystem(app as never, { ledger: ledger as never })
    const pass = Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1'))
    const read = () => Array.fromAsync<StateEntry>(Reflect.get(fs, 'ledgerEntries').call(fs))
    const previous = Object.getOwnPropertyDescriptor(window, 'scheduler')
    Object.defineProperty(window, 'scheduler', {
      configurable: true,
      value: {
        yield: async () => {
          checkpoints.push(collected)
          await new Promise((resolve) => setTimeout(resolve, 0))
        },
      },
    })
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => ticks)
    try {
      await pass.call(fs, async () => {
        expect(await read()).toEqual(rows)
        const collection = checkpoints.filter((at) => at < count)
        expect(collection.length).toBeGreaterThan(0)
        let last = 0
        for (const at of [...collection, count]) {
          expect(at - last).toBeLessThanOrEqual(maximumSlice)
          last = at
        }
        expect(await read()).toEqual(rows)
        expect(walks).toBe(1)
      })
    } finally {
      clock.mockRestore()
      if (previous) Object.defineProperty(window, 'scheduler', previous)
      else Reflect.deleteProperty(window, 'scheduler')
    }
  }
)

it('rechecks the entry revision after yielding during snapshot collection', async () => {
  const app = buildFakeVault([])
  let revision = 0,
    walks = 0,
    collected = 0,
    changed = false
  const rows = Array.from({ length: 5000 }, (_, i) => ({
    path: `sample-${i}.md`,
    wirePath: `sample-${i}.md`,
    fileId: `sample-${i}`,
    versionId: 'v1',
    sha: 'a'.repeat(64),
    size: 1,
    mtime: 1,
  }))
  const ledger = {
    [Symbol.for('abele.sync.local-scan-state-revision-v1')]: async () => revision,
    async *all() {
      walks++
      for (const row of rows) {
        collected++
        yield row
      }
    },
  }
  const fs = new ObsidianFileSystem(app as never, { ledger: ledger as never })
  const pass = Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1'))
  const read = () => Array.fromAsync<StateEntry>(Reflect.get(fs, 'ledgerEntries').call(fs))
  const previous = Object.getOwnPropertyDescriptor(window, 'scheduler')
  Object.defineProperty(window, 'scheduler', {
    configurable: true,
    value: {
      yield: async () => {
        if (!changed) {
          expect(collected).toBeLessThan(rows.length)
          revision++
          changed = true
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
      },
    },
  })
  try {
    await pass.call(fs, async () => {
      expect(await read()).toEqual(rows)
      expect(changed).toBe(true)
      expect(await read()).toEqual(rows)
      expect(walks).toBe(2)
      expect(await read()).toEqual(rows)
      expect(walks).toBe(2)
    })
  } finally {
    if (previous) Object.defineProperty(window, 'scheduler', previous)
    else Reflect.deleteProperty(window, 'scheduler')
  }
})
