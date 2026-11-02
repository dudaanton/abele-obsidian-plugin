import { expect, it, vi } from 'vitest'
import { assertNoLinkedAncestors } from '@/sync/vaultPathLinks'

it('derives repeated path prefixes once while checking every live ancestor each time', async () => {
  const split = vi.spyOn(String.prototype, 'split')
  let checks = 0,
    derivations = 0
  const path = 'Sample-prefix-budget/Chapter/sample.md'
  try {
    for (let i = 0; i < 2048; i++)
      await assertNoLinkedAncestors(path, async () => {
        checks++
        return false
      })
    derivations = split.mock.calls.filter(([separator]) => separator === '/').length
  } finally {
    split.mockRestore()
  }
  expect(checks).toBe(2048 * 3)
  expect(derivations).toBe(1)
  // Cached strings never cache a filesystem answer: a newly linked parent still stops sync.
  await expect(
    assertNoLinkedAncestors(path, async (part) => part.endsWith('/Chapter'))
  ).rejects.toThrow('symbolic link')
})
