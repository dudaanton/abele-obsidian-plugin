import { expect, it, vi } from 'vitest'
import type { FileSystem } from '@abele/sync-sdk/core'
import { nativeInstallBatch, type InstallBatchHost } from '@/sync/nativeInstallBatch'

const items = [
  { path: 'Notes/First/sample-1.md', size: 4, sha: 'a'.repeat(64), mtime: 1 },
  { path: 'Notes/Second/sample-2.md', size: 4, sha: 'b'.repeat(64), mtime: 1 },
]

function host() {
  let stage = 0
  const effects: string[] = []
  const native = {
    syncFile: vi.fn(async () => {}),
    syncPath: vi.fn(async (path: string) => {
      effects.push('flush ' + path)
    }),
    installExclusive: vi.fn(async () => {}),
    sameObject: vi.fn(async () => true),
  }
  const value = {
    fs: { stat: async () => null } as unknown as FileSystem,
    disk: { stat: async () => null, remove: async () => {} },
    native,
    io: {
      create: vi.fn(async () => {}),
      append: vi.fn(async () => {}),
      fingerprint: vi.fn(async (id: string) => {
        const item = items[Number(id.slice(-1))]
        return { sha: item.sha, size: item.size }
      }),
    },
    journal: {
      currentForTargets: async () => [],
      persist: async (work: () => void) => work(),
      add: () => {},
      replace: () => {},
      drop: () => {},
    },
    freeName: async () => `.sample-stage/stage-${stage++}`,
    ownsStage: () => true,
    assertReady: () => {},
    validate: () => {},
    parents: vi.fn(async (path: string) => {
      effects.push('parents ' + path)
    }),
    publish: vi.fn(async (_from: string, to: string) => {
      effects.push('publish ' + to)
    }),
    installed: () => {},
  }
  return { host: value as unknown as InstallBatchHost, native, effects, parents: value.parents }
}

it('an interrupted batch that published nothing creates no vault folders and flushes nothing', async () => {
  const { host: batchHost, effects } = host()
  const paused = new Error('sync paused')
  await expect(
    nativeInstallBatch(batchHost, items, async (view) => {
      for (const item of items) await view.beginAtomicWrite!(item.path, item.mtime, null)
      throw paused
    })
  ).rejects.toBe(paused)
  // Private stages may exist, but no destination folder or durability barrier follows a pause.
  expect(effects.filter((effect) => !effect.startsWith('parents .sample-stage/'))).toEqual([])
})

it('an interrupted batch still makes its already published names durable', async () => {
  const { host: batchHost, effects } = host()
  const paused = new Error('sync paused')
  await expect(
    nativeInstallBatch(batchHost, items, async (view) => {
      const stages = []
      for (const item of items)
        stages.push(await view.beginAtomicWrite!(item.path, item.mtime, null))
      await stages[0].append(0, new Uint8Array(4))
      await stages[0].seal({ sha: items[0].sha, size: items[0].size })
      await stages[0].commit()
      throw paused
    })
  ).rejects.toBe(paused)
  expect(effects.filter((effect) => !effect.startsWith('parents .sample-stage/'))).toEqual([
    'parents Notes/First/sample-1.md',
    'publish Notes/First/sample-1.md',
    'flush Notes/First/sample-1.md',
    'flush .sample-stage/stage-0',
  ])
})
