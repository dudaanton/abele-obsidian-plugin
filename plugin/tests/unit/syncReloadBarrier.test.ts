import { describe, expect, it, vi } from 'vitest'
import { pendingTeardown, recordTeardown } from '@/sync/teardownBarrier'
import { appliedPathsOf, keepAppliedPaths } from '@/sync/stagedSettings'

describe('sync across freshly evaluated bundles', () => {
  it('keeps already-written settings across plugin modules but not across new application objects', async () => {
    const app = {}
    keepAppliedPaths(app, ['.obsidian/app.json'])
    vi.resetModules()
    const fresh = await import('@/sync/stagedSettings')
    expect(fresh.appliedPathsOf(app)).toEqual(['.obsidian/app.json'])
    expect(fresh.appliedPathsOf({})).toEqual([])
    fresh.keepAppliedPaths(app, [])
    expect(appliedPathsOf(app)).toEqual([])
  })
  it('does not turn a failed teardown into permission for a new writer', async () => {
    const app = {}
    recordTeardown(app, Promise.reject(new Error('old writer did not stop')))
    await expect(pendingTeardown(app)).rejects.toThrow('old writer did not stop')
  })

  it('makes a new module wait on the old module teardown for the same app only', async () => {
    const app = {}
    let finish!: () => void
    const stopping = new Promise<void>((resolve) => {
      finish = resolve
    })
    recordTeardown(app, stopping)
    vi.resetModules()
    const fresh = await import('@/sync/teardownBarrier')
    let started = false
    const start = fresh.pendingTeardown(app).then(() => {
      started = true
    })
    await Promise.resolve()
    expect(started).toBe(false)
    await fresh.pendingTeardown({})
    finish()
    await start
    expect(started).toBe(true)
    await pendingTeardown(app)
  })
})
