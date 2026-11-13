import { expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import {
  MemoryFileSystem,
  MemoryStateStore,
  TransferBudget,
  scan,
  sha256,
} from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ProgressiveLocalScan, SCAN_HASH_READY } from '@/sync/progressiveLocalScan'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ExecutableReview } from '@/sync/executableReview'
import { ignoreFor } from '@/sync/scope'
import { deferred } from '../helpers/deferred'

async function checkIncomingPriority(writeMs: number): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] })
  const settle = async <T>(work: Promise<T>): Promise<T> => {
    let done = false
    void work.then(
      () => {
        done = true
      },
      () => {
        done = true
      }
    )
    while (!done) {
      await vi.advanceTimersByTimeAsync(1)
      await flushPromises()
    }
    return work
  }
  const scenario = async (compete: boolean) => {
    const budget = new TransferBudget({ maxActiveTransfers: 2 })
    const local = new MemoryFileSystem(),
      incoming = new MemoryFileSystem()
    const bytes = new Uint8Array([1]),
      sha = await sha256(bytes)
    for (let n = 0; n < 12000; n++) await local.writeAtomic(`Local/sample-${n}.md`, bytes, 1000)
    let lane = Promise.resolve(),
      reads = 0,
      active = 0,
      peak = 0
    let receivingActive = false,
      readsDuringIncoming = 0
    const ready = new Set<string>()
    const io = (milliseconds: number) => {
      const work = lane.then(
        () => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
      )
      lane = work
      return work
    }
    Object.defineProperty(local, 'trustedIndexIdentities', { value: true })
    Object.defineProperty(local, SCAN_HASH_READY, {
      configurable: true,
      value: async (info: { path: string }) => ready.has(info.path),
    })
    Object.assign(local, {
      fingerprint: async (path: string) => {
        if (ready.has(path)) return { sha, size: 1, mtime: 1000 }
        reads++
        if (receivingActive) readsDuringIncoming++
        active++
        peak = Math.max(peak, active)
        try {
          await io(20)
          ready.add(path)
          return { sha, size: 1, mtime: 1000 }
        } finally {
          active--
        }
      },
    })
    const write = incoming.conditionalFile.bind(incoming)
    vi.spyOn(incoming, 'conditionalFile').mockImplementation(async (...args) => {
      await io(writeMs)
      return write(...args)
    })
    const entered = deferred<void>(),
      release = deferred<void>()
    const scope = { kind: 'folder' as const, id: 'sample-root', path: 'Incoming' }
    const items = Array.from({ length: 1000 }, (_, n) => ({
      path: `Incoming/sample-${n}.md`,
      file_id: `sample-file-${n}`,
      version_id: 'sample-version',
      kind: 'note',
      size: 1,
      sha,
      mtime: 1000,
    }))
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      if (path === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000000, quota_bytes: null },
        })
      if (path === '/v2/manifest') return Response.json({ items, cursor: 1, next: null })
      if (path === '/v2/changes') return Response.json({ items: [], cursor: 1, next: null })
      if (path.includes('/content')) {
        entered.resolve()
        await release.promise
        return new Response(bytes)
      }
      throw Error('Unexpected route: ' + path)
    })
    const make = (fs: MemoryFileSystem, id: string) => {
      const metadata = new MemoryStateStore()
      return new TokenEngineRuntime({
        id,
        encoded: encodeAccessToken({
          v: 1,
          address: 'https://sync.example',
          key: 'a'.repeat(43),
          scope,
        }),
        fs,
        state: new MemoryStateStore(),
        transferBudget: budget,
        fetch,
        reviews: {
          executables: new ExecutableReview(metadata),
          attachments: new AttachmentConsent(metadata),
          close: () => {},
        },
        changed: () => {},
        failed: () => {},
        covers: async () => false,
        scopeInput: async () => ({ key: 'sample', ignore: ignoreFor('.obsidian', null) }),
      })
    }
    const receive = make(incoming, 'sample-receive'),
      background = make(local, 'sample-discovery')
    const discovery = Reflect.get(background, 'localContentScan') as ProgressiveLocalScan
    let discoveryWork = Promise.resolve<unknown>(undefined)
    const started = Date.now()
    let elapsedMs = 0
    receivingActive = true
    const work = receive.sync().then(() => {
      receivingActive = false
      elapsedMs = Date.now() - started
    })
    try {
      await entered.promise
      if (compete) {
        discoveryWork = (async () => {
          const state = new MemoryStateStore()
          do {
            discovery.begin()
            await scan(discovery.fileSystem(local), state, { excluded: () => false })
            if (writeMs === 1 || !receivingActive) break
            await new Promise<void>((resolve) => setTimeout(resolve, 1000))
          } while (receivingActive)
        })()
      }
      release.resolve()
      await settle(Promise.all([work, discoveryWork]))
      expect((await Array.fromAsync(incoming.list())).length).toBe(1000)
      const discoveryReads = readsDuringIncoming
      if (compete) {
        const beforeIdle = reads
        discovery.begin()
        await settle(
          scan(discovery.fileSystem(local), new MemoryStateStore(), { excluded: () => false })
        )
        expect(reads).toBeGreaterThan(beforeIdle)
        expect(peak).toBe(8)
      }
      return { elapsedMs, discoveryReads }
    } finally {
      release.resolve()
      await settle(Promise.allSettled([work, discoveryWork]))
      await receive.close()
      await background.close()
    }
  }
  try {
    const baseline = await scenario(false),
      contended = await scenario(true)
    console.log('synthetic incoming priority', { baseline, contended })
    if (writeMs === 1) {
      expect(contended.discoveryReads).toBe(0)
      expect(contended.elapsedMs).toBeLessThanOrEqual(baseline.elapsedMs)
    } else {
      expect(contended.discoveryReads).toBeGreaterThan(0)
      expect(contended.elapsedMs).toBeLessThanOrEqual(baseline.elapsedMs * 1.1)
    }
  } finally {
    vi.useRealTimers()
  }
}

it(
  'keeps 1000 incoming installations at uncontended throughput beside a 12k cold inventory',
  () => checkIncomingPriority(1),
  30000
)

it(
  'gives discovery a minimum share during long incoming transfers with less than ten percent overhead',
  () => checkIncomingPriority(10),
  30000
)
