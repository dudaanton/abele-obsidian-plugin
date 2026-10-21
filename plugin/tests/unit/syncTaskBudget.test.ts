// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { SyncTaskBudget } from '@/sync/syncTaskBudget'

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
