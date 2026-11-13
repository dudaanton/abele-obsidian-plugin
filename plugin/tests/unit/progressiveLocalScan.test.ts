import { expect, it, vi } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, scan, sha256 } from '@abele/sync-sdk/core'
import { ProgressiveLocalScan, SCAN_HASH_READY } from '@/sync/progressiveLocalScan'
import { flushPromises } from '@vue/test-utils'
import {
  FileRetries,
  fileErrors,
} from '../../node_modules/@abele/sync-sdk/dist/internal/core/fileRetry.js'

it('drains issued discovery reads and stops queued work when incoming I/O takes priority', async () => {
  const raw = new MemoryFileSystem()
  for (let n = 0; n < 100; n++) await raw.writeAtomic(`sample-${n}.md`, new Uint8Array([1]), 1000)
  Object.defineProperty(raw, 'trustedIndexIdentities', { value: true })
  const ready = new Set<string>()
  Object.defineProperty(raw, SCAN_HASH_READY, {
    configurable: true,
    value: async (info: { path: string }) => ready.has(info.path),
  })
  let release!: () => void,
    allowed = true,
    reads = 0
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const sha = await sha256(new Uint8Array([1]))
  Object.assign(raw, {
    fingerprint: async (path: string) => {
      if (!ready.has(path)) {
        reads++
        await gate
        ready.add(path)
      }
      return { sha, size: 1, mtime: 1000 }
    },
  })
  const budget = new ProgressiveLocalScan({
    milliseconds: 1000,
    concurrency: 8,
    canRead: () => allowed,
  })
  const fs = budget.fileSystem(raw),
    state = new MemoryStateStore()
  budget.begin()
  const work = scan(fs, state, { excluded: () => false })
  try {
    while (reads < 8) await flushPromises()
    allowed = false
    release()
    await work
    expect(reads).toBe(8)
    expect(budget.pending).toBe(true)
    budget.begin()
    await scan(fs, state, { excluded: () => false })
    expect(reads).toBe(8)
    expect(budget.pending).toBe(true)
    allowed = true
    budget.begin()
    await scan(fs, state, { excluded: () => false })
    expect(reads).toBe(100)
    budget.begin()
    await scan(fs, state, { excluded: () => false })
    expect(budget.pending).toBe(false)
  } finally {
    release()
    await work
  }
})

it('prunes vanished failed paths only after a complete inventory and retains unreadable handoffs', async () => {
  const raw = new MemoryFileSystem()
  Object.defineProperty(raw, 'trustedIndexIdentities', { value: true })
  Object.defineProperty(raw, SCAN_HASH_READY, { configurable: true, value: async () => false })
  for (let i = 0; i < 100; i++) await raw.writeAtomic(`vanished-${i}.md`, new Uint8Array([1]), 1000)
  await raw.writeAtomic('unreadable.md', new Uint8Array([1]), 1000)
  Object.assign(raw, {
    fingerprint: async (path: string) => {
      if (path.startsWith('vanished-')) await raw.remove(path)
      throw Object.assign(new Error('sample read failed'), { code: 'EACCES' })
    },
  })
  const budget = new ProgressiveLocalScan({ milliseconds: 1000, concurrency: 8 })
  const fs = fileErrors(budget.fileSystem(raw))
  budget.begin()
  await scan(fs, new MemoryStateStore(), { excluded: () => false })
  const failed = Reflect.get(budget, 'failed') as Set<string>
  expect(failed.size).toBe(101)
  budget.begin()
  const partial = fs.list()[Symbol.asyncIterator]()
  await partial.next()
  await partial.return?.()
  expect(failed.size).toBe(101)
  const state = new MemoryStateStore()
  const retries = new FileRetries(
    state,
    () => 1000,
    () => {}
  )
  await scan(fs, state, { excluded: () => false }, { retries })
  expect([...failed]).toEqual(['unreadable.md'])
  expect(retries.list()).toMatchObject([{ path: 'unreadable.md', phase: 'scan' }])
  expect(budget.pending).toBe(false)
  await raw.remove('unreadable.md')
  budget.begin()
  await scan(fs, state, { excluded: () => false }, { retries })
  expect(failed.size).toBe(0)
  expect(budget.pending).toBe(false)
})

it('admits a small foreground edit and yields the remaining cold content after the time window', async () => {
  const raw = new MemoryFileSystem()
  for (let i = 0; i < 3; i++) await raw.writeAtomic(`sample-${i}.md`, new Uint8Array([1]), 1000)
  Object.defineProperty(raw, 'trustedIndexIdentities', { value: true })
  const ready = new Set<string>()
  Object.defineProperty(raw, SCAN_HASH_READY, {
    configurable: true,
    value: async (info: { path: string }) => ready.has(info.path),
  })
  const sha = await sha256(new Uint8Array([1]))
  let now = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  Object.assign(raw, {
    fingerprint: async (path: string) => {
      now += 30
      ready.add(path)
      return { sha, size: 1, mtime: 1000 }
    },
  })
  try {
    const budget = new ProgressiveLocalScan({
      milliseconds: 1000,
      concurrency: 8,
      foregroundMilliseconds: 25,
    })
    budget.begin()
    const state = new MemoryStateStore()
    const first = await scan(budget.fileSystem(raw), state, { excluded: () => false })
    expect(first.ops).toHaveLength(1)
    expect(budget.deferredCount).toBe(2)
    budget.begin()
    const next = await scan(budget.fileSystem(raw), state, { excluded: () => false })
    expect(next.ops).toHaveLength(3)
    expect(budget.pending).toBe(false)
  } finally {
    clock.mockRestore()
  }
})

it('hands failed cold discovery to ordinary scan retries across passes without watcher events', async () => {
  const raw = new MemoryFileSystem()
  await raw.writeAtomic('unreadable.md', new Uint8Array([1]), 1000)
  Object.defineProperty(raw, 'trustedIndexIdentities', { value: true })
  Object.defineProperty(raw, SCAN_HASH_READY, { configurable: true, value: async () => false })
  let readable = false
  const fingerprint = vi.fn(async () => {
    if (!readable) throw Object.assign(new Error('sample read denied'), { code: 'EACCES' })
    return { sha: await sha256(new Uint8Array([1])), size: 1, mtime: 1000 }
  })
  Object.assign(raw, { fingerprint })
  const state = new MemoryStateStore()
  let now = 1000
  const log = vi.fn()
  const retries = new FileRetries(state, () => now, log)
  const budget = new ProgressiveLocalScan({ milliseconds: 1000, concurrency: 8 })
  const fs = fileErrors(budget.fileSystem(raw))
  const pass = async () => {
    budget.begin()
    return scan(fs, state, { excluded: () => false }, { retries })
  }
  await pass()
  expect(budget.pending).toBe(true)
  const failed = await pass()
  expect(budget.pending).toBe(false)
  expect(failed.skipped).toContainEqual({ path: 'unreadable.md', reason: 'sample read denied' })
  expect(failed.complete).toBe(false) // Unreadable candidates cannot authorize deletions.
  expect(retries.list()).toMatchObject([
    { path: 'unreadable.md', phase: 'scan', attempts: 1, nextAt: 6000 },
  ])
  expect(log).toHaveBeenCalledWith(expect.stringContaining('sample read denied'))
  const attempts = fingerprint.mock.calls.length
  await pass()
  expect(fingerprint).toHaveBeenCalledTimes(attempts)
  expect(budget.pending).toBe(false)
  now = 6000
  await pass()
  expect(retries.list()).toMatchObject([{ attempts: 2, nextAt: 16000 }])
  expect(budget.pending).toBe(false)
  readable = true
  now = 16000
  const recovered = await pass()
  expect(recovered.ops).toMatchObject([{ op: 'create', path: 'unreadable.md' }])
  expect(retries.list()).toEqual([])
  expect(budget.pending).toBe(false)
})

it('cancels queued discovery without starting more reads or retaining scan workers', async () => {
  const raw = new MemoryFileSystem()
  Object.defineProperty(raw, 'trustedIndexIdentities', { value: true })
  Object.defineProperty(raw, SCAN_HASH_READY, { configurable: true, value: async () => false })
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const fingerprint = vi.fn(async () => {
    entered()
    await pending
    return { sha: 'a'.repeat(64), size: 1, mtime: 1000 }
  })
  Object.assign(raw, { fingerprint })
  for (let i = 0; i < 64; i++) await raw.writeAtomic(`sample-${i}.md`, new Uint8Array([1]), 1000)
  const controller = new AbortController()
  const budget = new ProgressiveLocalScan({ milliseconds: 1000, concurrency: 8 })
  budget.begin(controller.signal)
  const work = scan(
    budget.fileSystem(raw),
    new MemoryStateStore(),
    { excluded: () => false },
    {
      signal: controller.signal,
    }
  )
  const stopped = expect(work).rejects.toThrow()
  try {
    await started
    controller.abort()
    await stopped
    expect(fingerprint.mock.calls.length).toBeLessThanOrEqual(8)
    expect(Reflect.get(budget, 'running')).toBe(0)
  } finally {
    release()
    await Promise.allSettled([work])
  }
})

it('discovers 12k cold indexed files within a minute with bounded parallel reads and task yields', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] })
  const previousScheduler = Object.getOwnPropertyDescriptor(window, 'scheduler')
  const yieldTask = vi.fn(async () => {})
  Object.defineProperty(window, 'scheduler', { configurable: true, value: { yield: yieldTask } })
  const raw = new MemoryFileSystem()
  const hashes = new Map<string, { sha: string; size: number; mtime: number }>()
  const sha = await sha256(new TextEncoder().encode('sample'))
  let active = 0,
    peak = 0,
    reads = 0
  Object.defineProperty(raw, 'trustedIndexIdentities', { value: true })
  Object.defineProperty(raw, SCAN_HASH_READY, {
    configurable: true,
    value: async (info: { path: string }) => hashes.has(info.path),
  })
  Object.assign(raw, {
    fingerprint: async (path: string) => {
      if (hashes.has(path)) return hashes.get(path)!
      active++
      peak = Math.max(peak, active)
      reads++
      // Three six-millisecond adapter operations per cold fingerprint.
      await new Promise((resolve) => setTimeout(resolve, 18))
      active--
      const result = { sha, size: 6, mtime: 1000 }
      hashes.set(path, result)
      return result
    },
  })
  for (let i = 0; i < 12000; i++)
    await raw.writeAtomic(`sample-${i}.md`, new TextEncoder().encode('sample'), 1000)
  const budget = new ProgressiveLocalScan({ milliseconds: 1000, concurrency: 8 })
  const fs = budget.fileSystem(raw)
  const started = Date.now()
  try {
    let passes = 0
    do {
      budget.begin(undefined, passes === 0 ? 1000 : 4000)
      const work = scan(fs, new MemoryStateStore(), { excluded: () => false })
      let settled = false
      void work.finally(() => {
        settled = true
      })
      while (!settled) {
        await vi.runAllTimersAsync()
        await flushPromises()
      }
      await work
      passes++
      if (budget.pending) await vi.advanceTimersByTimeAsync(1000)
    } while (budget.pending && passes < 20)
    expect(budget.pending).toBe(false)
    expect(hashes.size).toBe(12000)
    expect(reads).toBe(12000)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(8)
    expect(active).toBe(0)
    expect(Date.now() - started).toBeLessThan(45000)
    expect(yieldTask).toHaveBeenCalled()
    console.info('synthetic portable discovery', {
      passes,
      elapsedMs: Date.now() - started,
      reads,
      peak,
    })
  } finally {
    if (previousScheduler) Object.defineProperty(window, 'scheduler', previousScheduler)
    else Reflect.deleteProperty(window, 'scheduler')
    vi.useRealTimers()
  }
}, 30000)

it('never defers tracked edits or explicit watcher paths', async () => {
  const raw = new MemoryFileSystem()
  Object.defineProperty(raw, 'trustedIndexIdentities', { value: true })
  Object.defineProperty(raw, SCAN_HASH_READY, { value: async () => false })
  const state = new MemoryStateStore()
  const old = new TextEncoder().encode('before')
  await raw.writeAtomic('tracked.bin', new TextEncoder().encode('edited'), 2000)
  await raw.writeAtomic('fresh.bin', old, 1000)
  await state.put({
    path: 'tracked.bin',
    wirePath: 'tracked.bin',
    fileId: 'sample-id',
    versionId: 'sample-version',
    sha: await sha256(old),
    size: old.length,
    mtime: 1000,
  })
  const budget = new ProgressiveLocalScan(0)
  const found = await scan(
    budget.fileSystem(raw),
    state,
    { excluded: () => false },
    {
      verifyPaths: new Set(['fresh.bin']),
    }
  )
  expect(found.ops.map((op) => op.op).sort()).toEqual(['create', 'modify'])
  expect(budget.pending).toBe(false)
})

it('holds deletion and rename publication until deferred candidates are examined', async () => {
  const raw = new MemoryFileSystem()
  Object.defineProperty(raw, 'trustedIndexIdentities', { value: true })
  const ready = new Set<string>()
  Object.defineProperty(raw, SCAN_HASH_READY, {
    value: async (info: { path: string }) => ready.has(info.path),
  })
  const state = new MemoryStateStore()
  const content = new TextEncoder().encode('sample')
  await state.put({
    path: 'old.bin',
    wirePath: 'old.bin',
    fileId: 'sample-id',
    versionId: 'sample-version',
    sha: await sha256(content),
    size: content.length,
    mtime: 1000,
  })
  await raw.writeAtomic('moved.bin', content, 1000)
  await raw.writeAtomic('new.bin', new TextEncoder().encode('different'), 1000)
  const budget = new ProgressiveLocalScan(1)
  const fs = budget.fileSystem(raw)
  const first = await scan(fs, state, { excluded: () => false })
  expect(first.ops).toEqual([])
  expect(first.dirty.has('old.bin')).toBe(true)
  expect(budget.pending).toBe(true)
  for (const path of first.hashes.keys()) ready.add(path)
  budget.begin()
  const second = await scan(fs, state, { excluded: () => false })
  expect(second.ops.map((op) => op.op).sort()).toEqual(['create', 'move'])
  expect(budget.pending).toBe(false)
})
