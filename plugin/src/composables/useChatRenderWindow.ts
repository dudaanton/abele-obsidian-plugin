import { computed, ref, watch } from 'vue'
import { DEFAULT_TAIL_PAGE_SIZE } from './useTailPagedList'

/** A bounded, bidirectional slice. The caller anchors layout before moving either edge. */
export function useChatRenderWindow<T>(
  source: () => readonly T[],
  following: () => boolean,
  pageSize = DEFAULT_TAIL_PAGE_SIZE,
  capacity = pageSize * 3
) {
  if (pageSize < 1 || capacity < pageSize) throw new RangeError('Invalid chat window size')
  const total = computed(() => source().length)
  const first = ref(Math.max(0, total.value - pageSize))
  const last = ref(total.value)
  const start = computed(() => Math.min(first.value, total.value))
  const end = computed(() => Math.min(last.value, total.value))
  const visible = computed(() => source().slice(start.value, end.value))
  const hasOlder = computed(() => start.value > 0)
  const hasNewer = computed(() => end.value < total.value)

  const reset = () => {
    first.value = Math.max(0, total.value - pageSize)
    last.value = total.value
  }
  const showOlder = () => {
    first.value = Math.max(0, start.value - pageSize)
    last.value = Math.min(end.value, first.value + capacity)
  }
  const showNewer = () => {
    last.value = Math.min(total.value, end.value + pageSize)
    first.value = Math.max(start.value, last.value - capacity)
  }
  const showFrom = (index: number) => {
    const target = Math.max(0, Math.min(Math.floor(index), Math.max(0, total.value - 1)))
    if (target >= start.value && target < end.value) return
    first.value = target
    last.value = Math.min(total.value, target + capacity)
  }

  watch(
    total,
    (now, before) => {
      if (now < before || before === 0) reset()
      else if (following()) {
        last.value = now
        first.value = Math.max(first.value, now - capacity)
      }
    },
    { flush: 'sync' }
  )

  return { visible, start, end, total, hasOlder, hasNewer, showOlder, showNewer, showFrom, reset }
}
