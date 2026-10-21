// @vitest-environment node
import { expect, it } from 'vitest'
import { SyncTaskBudget } from '@/sync/syncTaskBudget'

it('can yield without a window global', async () => {
  expect(typeof window).toBe('undefined')
  await expect(new SyncTaskBudget().account(1024 * 1024)).resolves.toBeUndefined()
})
