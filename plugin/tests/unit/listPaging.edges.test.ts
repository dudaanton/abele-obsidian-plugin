import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { usePagedList } from '@/composables/usePagedList'
import { DEFAULT_TAIL_PAGE_SIZE, useTailPagedList } from '@/composables/useTailPagedList'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
} from '../helpers/fakeIntersectionObserver'

const items = (n: number) => Array.from({ length: n }, (_, i) => `row-${i}`)
let scope: EffectScope
beforeEach(() => {
  scope = effectScope()
  resetFakeIntersectionObservers()
  installFakeIntersectionObserver()
})
afterEach(() => {
  scope.stop()
  resetFakeIntersectionObservers()
})

describe('head paging — persistence boundaries', () => {
  it('clamps zero initial pages and records growth/reset only once per change', async () => {
    const record = vi.fn()
    const paged = scope.run(() => usePagedList(() => items(21), 20, { initial: 0, record }))!
    expect(paged.visible.value).toHaveLength(20)
    expect(record).not.toHaveBeenCalled()
    paged.showMore()
    await nextTick()
    expect(record.mock.calls).toEqual([[2]])
    paged.showMore()
    await nextTick()
    expect(record.mock.calls).toEqual([[2]])
    paged.reset()
    await nextTick()
    expect(record.mock.calls).toEqual([[2], [1]])
  })

  it('retains the expanded window across source replacement and shrinkage until explicitly reset', () => {
    const source = ref(items(100))
    const paged = scope.run(() => usePagedList(() => source.value, 20))!
    paged.showMore()
    source.value = items(3)
    expect(paged.visible.value).toEqual(source.value)
    expect(paged.total.value).toBe(3)
    expect(paged.hasMore.value).toBe(false)
    source.value = items(200)
    expect(paged.visible.value).toHaveLength(40)
  })

  it('gives each successive search its own saved window, even when the source was empty', async () => {
    const source = ref(items(100))
    const record = vi.fn()
    const paged = scope.run(() => usePagedList(() => source.value, 20, { initial: 3, record }))!
    paged.followSearch(['absent'])
    source.value = []
    await nextTick()
    expect(record).not.toHaveBeenCalled()
    paged.followSearch([])
    source.value = items(100)
    await nextTick()
    expect(paged.visible.value).toHaveLength(60)
    paged.showMore()
    await nextTick()
    paged.followSearch(['next'])
    await nextTick()
    paged.showMore()
    await nextTick()
    paged.followSearch([])
    await nextTick()
    expect(paged.visible.value).toHaveLength(80)
    expect(record.mock.calls.flat()).toEqual([3, 4, 4])
  })
})

describe('tail paging — delayed sources and anchoring', () => {
  it('waits for a nonempty source, uses thirty by default, and keeps streamed changes visible', async () => {
    const source = ref<string[]>([])
    const paged = scope.run(() => useTailPagedList(() => source.value))!
    source.value = items(100)
    await nextTick()
    expect(DEFAULT_TAIL_PAGE_SIZE).toBe(30)
    expect(paged.hidden.value).toBe(70)
    source.value.push('new reply')
    source.value[100] = 'new reply continuing'
    await nextTick()
    expect(paged.visible.value).toEqual([...items(100).slice(70), 'new reply continuing'])
    expect(paged.total.value).toBe(101)
    paged.showFrom(-20)
    expect(paged.hidden.value).toBe(0)
    expect(paged.hasMore.value).toBe(false)
  })

  it('keeps the held index when a source is replaced by one of the same length', async () => {
    const source = ref(items(10))
    const paged = scope.run(() => useTailPagedList(() => source.value, 3))!
    paged.showFrom(2)
    source.value = items(10).map((s) => `other-${s}`)
    await nextTick()
    expect(paged.visible.value).toEqual(source.value.slice(2))
  })

  // Reset and shrink must anchor the newly shown page before any later append.
  it('waits for a new source after shrinking to empty and resetting', async () => {
    const source = ref(items(20))
    const paged = scope.run(() => useTailPagedList(() => source.value, 3))!
    source.value = []
    await nextTick()
    paged.reset()
    source.value = items(10)
    await nextTick()
    expect(paged.visible.value).toEqual(items(10).slice(7))
    source.value.push('reply')
    await nextTick()
    expect(paged.visible.value).toEqual([...items(10).slice(7), 'reply'])
  })

  it.each(['reset', 'shrink'] as const)(
    'keeps the first visible row on append after %s',
    async (action) => {
      const source = ref(items(20))
      const paged = scope.run(() => useTailPagedList(() => source.value, 3))!
      paged.showMore()
      if (action === 'reset') paged.reset()
      else source.value = items(10)
      await nextTick()
      const before = [...paged.visible.value]
      source.value.push('reply')
      await nextTick()
      expect(paged.visible.value).toEqual([...before, 'reply'])
    }
  )
})
