import { beforeEach, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { fakePrism } from '../mocks/prism'
const { load } = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('obsidian', async (original) => ({ ...(await original<object>()), loadPrism: load }))
beforeEach(() => {
  vi.resetModules()
  load.mockReset().mockResolvedValue(fakePrism)
})
it('does not initialize host grammars when the comparison module is imported', async () => {
  await import('@/components/diffSyntax')
  await flushPromises()
  expect(load).not.toHaveBeenCalled()
})
it('does not initialize grammars for a comparison beyond its highlighting limit', async () => {
  const { lineTokens, MAX_HIGHLIGHTED } = await import('@/components/diffSyntax')
  expect(lineTokens('x'.repeat(MAX_HIGHLIGHTED + 1), 'sample.ts')).toBeNull()
  expect(load).not.toHaveBeenCalled()
})
it('loads once on first use and reactively colors the waiting comparison', async () => {
  const { lineTokens } = await import('@/components/diffSyntax')
  const tokens = computed(() => lineTokens('const value = 1', 'sample.ts'))
  expect(tokens.value).toBeNull()
  expect(load).toHaveBeenCalledTimes(1)
  await flushPromises()
  expect(tokens.value?.[0]).toEqual(
    expect.arrayContaining([expect.objectContaining({ cls: 'token keyword' })])
  )
  lineTokens('const other = 2', 'sample.ts')
  expect(load).toHaveBeenCalledTimes(1)
})
