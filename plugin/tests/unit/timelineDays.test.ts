import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import dayjs from 'dayjs'
import { useTimelineDays } from '@/composables/useTimelineDays'
import {
  installFakeIntersectionObserver,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

describe('timeline date loading', () => {
  it('includes an earlier description match arriving after a known title match', async () => {
    const scope = effectScope()
    const days = ref<[string, string[]][]>([['2030-06-15', ['sample-title-match']]])
    const terms = ref<string[]>([])
    const window = scope.run(() =>
      useTimelineDays(
        () => days.value,
        () => '2030-06-15',
        () => terms.value,
        20,
        {
          initial: 1,
          record: () => {},
        }
      )
    )!
    try {
      terms.value = ['sample']
      await nextTick()
      expect(window.visible.value.map(([day]) => day)).toEqual(['2030-06-15'])
      days.value = [['2030-06-08', ['sample-description-match']], ...days.value]
      await nextTick()
      expect(window.visible.value.map(([day]) => day)).toEqual(['2030-06-08', '2030-06-15'])
      expect(window.folded.value).toEqual([])
      terms.value = []
      await nextTick()
      expect(window.visible.value.map(([day]) => day)).toEqual(['2030-06-15'])
    } finally {
      scope.stop()
    }
  })

  it('forgets expanded future pages when the label window resets, but never records search pages', async () => {
    installFakeIntersectionObserver()
    const scope = effectScope()
    const terms = ref<string[]>([])
    const record = vi.fn()
    const window = scope.run(() =>
      useTimelineDays(
        () =>
          Array.from({ length: 80 }, (_, i): [string, string[]] => [
            dayjs('2030-06-15').add(i, 'day').format('YYYY-MM-DD'),
            [],
          ]),
        () => '2030-06-15',
        () => terms.value,
        20,
        { initial: 3, record }
      )
    )!
    const sentinel = document.createElement('div')
    document.body.append(sentinel)
    window.sentinel.value = sentinel
    try {
      await nextTick()
      expect(window.visible.value).toHaveLength(60)
      window.reset()
      await nextTick()
      expect(window.visible.value).toHaveLength(20)
      expect(record).toHaveBeenLastCalledWith(1)
      record.mockClear()
      terms.value = ['sample']
      await nextTick()
      scrollIntoView(sentinel)
      await nextTick()
      window.reset()
      await nextTick()
      expect(record).not.toHaveBeenCalled()
    } finally {
      scope.stop()
      sentinel.remove()
    }
  })

  it('batches arriving historical tasks instead of rebuilding every date for each task', async () => {
    const scope = effectScope()
    const days = ref<[string, string[]][]>([])
    const source = vi.fn(() => days.value)
    const window = scope.run(() =>
      useTimelineDays(
        source,
        () => '2030-06-15',
        () => [],
        20,
        {
          initial: 1,
          record: () => {},
        }
      )
    )!
    try {
      expect(source).toHaveBeenCalledTimes(1)
      for (let i = 0; i < 100; i++) days.value = [['2030-06-14', [`sample-item-${i}`]]]
      // Loading a relation set mutates many tasks in one turn. A synchronous source watch
      // defeats Vue's batching and turns the complete date-map rebuild into quadratic work.
      expect(source).toHaveBeenCalledTimes(1)
      await nextTick()
      expect(source).toHaveBeenCalledTimes(2)
      expect(window.folded.value).toEqual([['2030-06-14', ['sample-item-99']]])
      expect(window.visible.value).toEqual([])
      days.value = [...days.value, ['2030-06-15', ['sample-today']]]
      await nextTick()
      expect(window.visible.value).toEqual([['2030-06-15', ['sample-today']]])
    } finally {
      scope.stop()
    }
  })
})
