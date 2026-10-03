// @vitest-environment node
import { it, expect, vi } from 'vitest'
import { waitFor } from '../e2e/helpers/syncVault'
it('does not treat an unresolved native convergence promise as success', async () => {
  const callback = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  await waitFor('actual asynchronous convergence', callback, 2000)
  expect(callback).toHaveBeenCalledTimes(2)
})
