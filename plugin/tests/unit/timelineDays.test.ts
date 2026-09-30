import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useTimelineDays } from '@/composables/useTimelineDays'

describe('timeline date loading', () => {
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
