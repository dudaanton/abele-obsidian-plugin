// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { Puller } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pullRun.js'
import { V2EngineClient } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { ExchangeTrace } from '@/sync/exchangeTrace'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'

it('confines and maps successful-write receipts through folder adapters', async () => {
  const key = Symbol.for('abele.sync.written-stat-v1')
  const receipt = vi.fn(async () => ({ size: 1, mtime: 1000 }))
  const mapped = new LocalFolderPlacement('remote', 'local').fileSystem({ [key]: receipt } as never)
  const fs = scopedFileSystem(
    mapped,
    (path) => {
      if (!path.startsWith('remote/')) throw new Error('outside scope')
    },
    (path) => path.startsWith('remote/')
  )
  const wrote = { size: 1, mtime: 1000 }
  expect(await Reflect.get(fs, key)('remote/sample.md', wrote)).toEqual(wrote)
  expect(receipt).toHaveBeenCalledWith('local/sample.md', wrote)
  receipt.mockClear()
  await expect(Reflect.get(fs, key)('private/sample.md', wrote)).rejects.toThrow('outside scope')
  expect(receipt).not.toHaveBeenCalled()
})

it('attributes a prefetched request to placement without counting HTTP twice', () => {
  const trace = new ExchangeTrace()
  trace.record('GET /v2/files/sample/content', Date.now(), 'complete')
  trace.beginPull(1, 'notes/sample.md', 1)(true)
  const pulls = trace.snapshot().firstSync.pulls
  expect(pulls.contentRequests).toBe(1)
  expect(pulls.small.sum.requests).toBe(1)
  expect(pulls.overlap).toBe(false)
})

it('persists restored departures once per manifest page', async () => {
  const client = new V2EngineClient(
    encodeAccessToken({
      v: 1,
      address: 'https://sync.example.invalid',
      key: 'a'.repeat(43),
      scope: { kind: 'folder', id: 'sample-root', path: '/' },
    }),
    {}
  )
  const state = new MemoryStateStore()
  const write = vi.spyOn(state, 'setMeta')
  Reflect.set(client, 'ports', { state })
  const items = Array.from({ length: 32 }, (_, i) => ({
    path: `notes/sample-${i}.md`,
    file_id: `sample-${i}`,
    sha: 'a'.repeat(64),
    kind: 'note',
  }))
  for (const item of items) Reflect.get(client, 'departed').add(item.path)
  vi.spyOn(Reflect.get(client, 'http'), 'json').mockResolvedValue({ items, cursor: 32, next: null })
  await client.manifest(null, 5000)
  expect(write.mock.calls).toEqual([['v2-departures', '[]']])
})

it('requests the maximum manifest page without changing feed pages', async () => {
  const manifest = vi.fn(async () => ({ items: [], head_seq: 1, next: null }))
  const changes = vi.fn(async () => ({ items: [], head_seq: 1, next_since: 1 }))
  const puller = new Puller(
    { manifest, changes } as never,
    {} as never,
    new MemoryStateStore(),
    {} as never,
    { cursor: 0 } as never
  )
  await puller.run()
  expect(manifest).toHaveBeenCalledWith(null, 5000)
  expect(changes).toHaveBeenCalledWith(1, 1000)
})

it('does not rewrite departure metadata for every new manifest file', async () => {
  const client = new V2EngineClient(
    encodeAccessToken({
      v: 1,
      address: 'https://sync.example.invalid',
      key: 'a'.repeat(43),
      scope: { kind: 'folder', id: 'sample-root', path: '/' },
    }),
    {}
  )
  const state = new MemoryStateStore()
  const write = vi.spyOn(state, 'setMeta')
  Reflect.set(client, 'ports', { state })
  for (let i = 0; i < 32; i++)
    await Reflect.get(client, 'fileItem').call(
      client,
      { path: `notes/sample-${i}.md`, file_id: `sample-${i}`, sha: 'a'.repeat(64), kind: 'note' },
      1
    )
  expect(write).not.toHaveBeenCalled()
})

it('fetches verified small versions eight at a time without opening large versions', async () => {
  let active = 0,
    maximum = 0,
    closed = 0
  const changes = await Promise.all(
    Array.from({ length: 20 }, async (_, i) => {
      const bytes = new Uint8Array([i])
      return {
        file_id: `sample-${i}`,
        version_id: 'v1',
        path: `notes/sample-${i}.md`,
        op: 'create',
        sha: await sha256(bytes),
        size: 1,
        bytes,
      }
    })
  )
  const openVersion = vi.fn(async (id: string) => {
    const change = changes.find((one) => one.file_id === id)!
    active++
    maximum = Math.max(maximum, active)
    return {
      size: 1,
      signal: new AbortController().signal,
      read: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return change.bytes
      },
      assertUnchanged: async () => {},
      close: async () => {
        active--
        closed++
      },
    }
  })
  const fs = Object.assign(new MemoryFileSystem(), { beginAtomicWrite() {}, reopenStage() {} })
  const puller = new Puller(
    { openVersion } as never,
    fs as never,
    new MemoryStateStore(),
    { dirty: new Set(), filter: { excluded: () => false } } as never,
    {} as never
  )
  const fetched = await Reflect.get(puller, 'prefetch').call(
    puller,
    [
      ...changes,
      { ...changes[0], file_id: 'sample-large', sha: 'f'.repeat(64), size: 1024 * 1024 + 1 },
    ],
    new Map()
  )
  expect(maximum).toBe(8)
  expect(closed).toBe(20)
  expect(openVersion).toHaveBeenCalledTimes(20)
  expect(fetched.size).toBe(20)
  for (const change of changes) expect(fetched.get(change.sha)).toEqual(change.bytes)
})

it.each(['corrupt', 'offline', 'aborted'] as const)(
  'closes every concurrent source before returning after %s',
  async (outcome) => {
    let active = 0
    const close = vi.fn(async () => {
      active--
    })
    const changes = Array.from({ length: 20 }, (_, i) => ({
      file_id: `sample-${i}`,
      version_id: 'v1',
      path: `notes/sample-${i}.md`,
      op: 'create',
      sha: 'a'.repeat(64),
      size: 1,
    }))
    const sourceSignal = new AbortController()
    if (outcome === 'aborted') sourceSignal.abort(new Error('sample aborted'))
    const openVersion = async () => {
      active++
      return {
        size: 1,
        signal: sourceSignal.signal,
        close,
        read: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1))
          if (outcome === 'offline') throw new Error('sample offline')
          return new Uint8Array([1])
        },
        assertUnchanged: async () => {},
      }
    }
    const puller = new Puller(
      { openVersion } as never,
      Object.assign(new MemoryFileSystem(), { beginAtomicWrite() {}, reopenStage() {} }) as never,
      new MemoryStateStore(),
      { dirty: new Set(), filter: { excluded: () => false } } as never,
      {} as never
    )
    const result = Reflect.get(puller, 'prefetch').call(puller, changes, new Map())
    if (outcome === 'corrupt') expect((await result).size).toBe(0)
    else await expect(result).rejects.toThrow(`sample ${outcome}`)
    expect(active).toBe(0)
    expect(close).toHaveBeenCalled()
  }
)
