import { expect, it, vi } from 'vitest'
import type { FileSystem } from '@abele/sync-sdk/core'
import { nativeInstallBatch, INSTALL_PROOF, type InstallBatchHost } from '@/sync/nativeInstallBatch'
import { ExchangeTrace } from '@/sync/exchangeTrace'
import { assertPullEvidence } from '../helpers/smallPullBounds'

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

it('certifies batch placement only after every independent intent has retired', async () => {
  const { host: batchHost } = host()
  const trace = new ExchangeTrace()
  await trace.nativeBatch(
    items.map((item) => item.path),
    async (proof) =>
      nativeInstallBatch(batchHost, items, async (view, flush) => {
        proof(Reflect.get(view, INSTALL_PROOF))
        for (const item of items) {
          const finish = trace.beginPull(item.size, item.path, 1)
          const stage = await view.beginAtomicWrite!(item.path, item.mtime, null)
          await stage.append(0, new Uint8Array(item.size))
          await stage.seal({ sha: item.sha, size: item.size })
          await stage.commit()
          await view.discardStage!(stage.id)
          finish(true)
        }
        await flush()
        expect(Reflect.get(view, INSTALL_PROOF)().retired).toBe(0)
        return true
      })
  )
  for (let i = 0; i < items.length; i++)
    trace.record(`GET /v2/files/sample-${i}/content`, Date.now(), 'complete')
  const evidence = trace.snapshot().firstSync.pulls
  expect(evidence.native).toMatchObject({
    files: 2,
    staged: 2,
    publications: 2,
    retired: 2,
    smallWrites: 2,
  })
  expect(() => assertPullEvidence(evidence, { small: 2, large: 0, requests: 2 })).not.toThrow()
})

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
