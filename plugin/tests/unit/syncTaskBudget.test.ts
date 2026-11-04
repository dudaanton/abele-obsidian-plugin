// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { SyncTaskBudget } from '@/sync/syncTaskBudget'
import { deferred } from '../helpers/deferred'

it('releases a cancelled metadata checkpoint before its scheduled continuation runs', async () => {
  const scheduled = deferred()
  vi.stubGlobal('window', { scheduler: { yield: () => scheduled.promise } })
  const controller = new AbortController()
  let cancelled = false
  const pending = new SyncTaskBudget().account(1024 * 1024, controller.signal)!
  const settled = pending.catch(() => {
    cancelled = true
  })
  try {
    controller.abort(new Error('sample stop'))
    await new Promise((resolve) => setImmediate(resolve))
    expect(cancelled).toBe(true)
  } finally {
    scheduled.resolve()
    await settled
    vi.unstubAllGlobals()
  }
})

it('can yield without a window global', async () => {
  expect(typeof window).toBe('undefined')
  await expect(new SyncTaskBudget().account(1024 * 1024)).resolves.toBeUndefined()
})

it('uses the worker timer when message channels are unavailable', async () => {
  const schedule = vi.fn((callback: () => void) => setTimeout(callback, 0))
  vi.stubGlobal('MessageChannel', undefined)
  vi.stubGlobal('self', { setTimeout: schedule })
  try {
    await new SyncTaskBudget().account(1024 * 1024)
    expect(schedule).toHaveBeenCalledOnce()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('bounds host yields for a large metadata inventory while still yielding', async () => {
  const yieldHost = vi.fn(async () => {})
  vi.stubGlobal('window', { scheduler: { yield: yieldHost } })
  const budget = new SyncTaskBudget()
  try {
    for (let i = 0; i < 33000; i++) await budget.metadataRow()
    expect(yieldHost.mock.calls.length).toBeGreaterThan(0)
    expect(yieldHost.mock.calls.length).toBeLessThan(80)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('does not allocate an awaitable for every unchanged metadata row', async () => {
  const budget = new SyncTaskBudget()
  let awaitables = 0
  for (let i = 0; i < 33000; i++) {
    const pause = budget.metadataRow()
    if (pause) {
      awaitables++
      await pause
    }
  }
  expect(awaitables).toBeLessThan(80)
})
