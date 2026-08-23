/**
 * Contract for the paging composable the footer lists share.
 *
 * These are the guarantees the lists depend on: the window starts at one page, never hands
 * out more than has been revealed, preserves the source order exactly, and is derived from
 * the source rather than copied out of it.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { effectScope, ref } from 'vue'
import { usePagedList, DEFAULT_PAGE_SIZE } from '@/composables/usePagedList'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
} from '../helpers/fakeIntersectionObserver'

/** Runs the composable inside a scope, as a component would. */
function inScope<T>(fn: () => T): T {
  const scope = effectScope()
  const result = scope.run(fn)
  return result as T
}

const items = (count: number): string[] => Array.from({ length: count }, (_, i) => `item-${i}`)

describe('usePagedList', () => {
  beforeEach(() => {
    resetFakeIntersectionObservers()
    installFakeIntersectionObserver()
  })

  it('starts at a single page', () => {
    const paged = inScope(() => usePagedList(() => items(500), 20))

    expect(paged.visible.value).toHaveLength(20)
    expect(paged.total.value).toBe(500)
    expect(paged.hasMore.value).toBe(true)
  })

  it('defaults to a page size of 20', () => {
    const paged = inScope(() => usePagedList(() => items(500)))

    expect(DEFAULT_PAGE_SIZE).toBe(20)
    expect(paged.visible.value).toHaveLength(DEFAULT_PAGE_SIZE)
  })

  it('preserves source order, taking a prefix and never reordering it', () => {
    const source = items(100)
    const paged = inScope(() => usePagedList(() => source, 20))

    expect(paged.visible.value).toEqual(source.slice(0, 20))

    paged.showMore()
    expect(paged.visible.value).toEqual(source.slice(0, 40))
  })

  it('grows by one page at a time', () => {
    const paged = inScope(() => usePagedList(() => items(100), 20))

    paged.showMore()
    expect(paged.visible.value).toHaveLength(40)

    paged.showMore()
    expect(paged.visible.value).toHaveLength(60)
  })

  it('stops growing once the whole source is shown', () => {
    const paged = inScope(() => usePagedList(() => items(25), 20))

    paged.showMore()
    expect(paged.visible.value).toHaveLength(25)
    expect(paged.hasMore.value).toBe(false)

    // Further requests must not push the window past the end, or a sentinel that stays
    // mounted would inflate the count without ever revealing anything.
    paged.showMore()
    expect(paged.visible.value).toHaveLength(25)
  })

  it('reports no more pages when the source fits in one', () => {
    const paged = inScope(() => usePagedList(() => items(5), 20))

    expect(paged.visible.value).toHaveLength(5)
    expect(paged.hasMore.value).toBe(false)
  })

  it('handles an empty source', () => {
    const paged = inScope(() => usePagedList(() => [], 20))

    expect(paged.visible.value).toEqual([])
    expect(paged.hasMore.value).toBe(false)
  })

  it('tracks a reactive source', () => {
    const source = ref(items(10))
    const paged = inScope(() => usePagedList(() => source.value, 20))

    expect(paged.hasMore.value).toBe(false)

    source.value = items(100)

    expect(paged.visible.value).toHaveLength(20)
    expect(paged.hasMore.value).toBe(true)
  })

  it('collapses back to one page on reset', () => {
    const paged = inScope(() => usePagedList(() => items(100), 20))

    paged.showMore()
    paged.showMore()
    expect(paged.visible.value).toHaveLength(60)

    paged.reset()
    expect(paged.visible.value).toHaveLength(20)
  })

  it('never renders more than the revealed window, however large the source', () => {
    // The point of the composable: cost stays flat as the source grows. A group note on a
    // large vault reaches five figures of relations.
    const paged = inScope(() => usePagedList(() => items(20_000), 20))

    expect(paged.visible.value).toHaveLength(20)
    expect(paged.total.value).toBe(20_000)
  })
})
