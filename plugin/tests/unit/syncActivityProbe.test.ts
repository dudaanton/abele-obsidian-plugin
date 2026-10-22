import { expect, it, vi } from 'vitest'
import { MemoryFileSystem } from '@abele/sync-sdk/core'
import { PathCoordinator, coordinatedFileSystem } from '@/sync/pathCoordinator'
import { TokenOffloadCoordinator } from '@/sync/tokenOffloadCoordinator'
import { ExchangeTrace } from '@/sync/exchangeTrace'
import { installSyncActivityProbe } from '../e2e/helpers/syncActivityProbe'

it('holds comparison through the real delegated filesystem without replacing its fingerprint', async () => {
  const fingerprint = vi.fn(async () => ({ sha: 'b'.repeat(64), size: 1 }))
  const base = Object.assign(new MemoryFileSystem(), { fingerprint })
  await base.writeAtomic('Notes/sample.md', new Uint8Array([1]), 1000)
  const stat = base.stat.bind(base)
  let stats = 0
  // Bound the old recursive microtask loop so its regression cannot hang the test runner.
  base.stat = async (path) => {
    if (++stats > 10) throw new Error('recursive fingerprint delegation')
    return stat(path)
  }
  const locks = new PathCoordinator()
  const fs = coordinatedFileSystem(
    new TokenOffloadCoordinator(locks).fileSystem(base, () => true),
    locks
  )
  const runtime = { options: { fs, fetch: vi.fn<typeof fetch>() }, trace: new ExchangeTrace() }
  // Use the same serialized, closure-free installation as the live renderer eval.
  const install = new Function(
    'return (' + installSyncActivityProbe.toString() + ')'
  )() as typeof installSyncActivityProbe
  const probe = install(runtime)
  const job = runtime.trace.run('fs fingerprint Notes/sample.md', () =>
    fs.fingerprint!('Notes/sample.md')
  )
  void job.catch(() => {})
  try {
    await vi.waitFor(() => expect(probe.compareReached).toBe(true))
    probe.releaseComparison()
    await expect(job).resolves.toEqual({ sha: 'b'.repeat(64), size: 1 })
    expect(fingerprint).toHaveBeenCalledOnce()
    expect(stats).toBe(1)
    expect(base.fingerprint).toBe(fingerprint)
  } finally {
    probe.restore()
    await job.catch(() => {})
  }
})

it('releases a forgotten comparison hold on its watchdog and restores the trace', async () => {
  vi.useFakeTimers()
  const runtime = { options: { fetch: vi.fn<typeof fetch>() }, trace: new ExchangeTrace() }
  const run = runtime.trace.run
  const probe = installSyncActivityProbe(runtime, { maxHoldMs: 10 })
  const job = runtime.trace.run('fs fingerprint Notes/sample.md', async () => 7)
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(probe.compareReached).toBe(true)
    await vi.advanceTimersByTimeAsync(10)
    await expect(job).resolves.toBe(7)
    expect(probe.autoReleased).toBe(true)
  } finally {
    probe.restore()
    expect(runtime.trace.run).toBe(run)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  }
})

it('bounds an upload hold and restores the real transport after a missed capture', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
  const runtime = { options: { fetch: fetcher }, trace: new ExchangeTrace() }
  const probe = installSyncActivityProbe(runtime, { holdUploadAfter: 1, maxHoldMs: 10 })
  const job = runtime.options.fetch('https://sync.example.invalid/v2/uploads/sample/0', {
    method: 'PUT',
  })
  try {
    expect(probe.uploadReached).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10)
    await expect(job).resolves.toBeInstanceOf(Response)
    expect(probe.autoReleased).toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()
  } finally {
    probe.restore()
    expect(runtime.options.fetch).toBe(fetcher)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  }
})
