import { computed, shallowRef, watch } from 'vue'
import { DEFAULT_TAIL_PAGE_SIZE } from './useTailPagedList'

/** A bounded, bidirectional slice. The caller anchors layout before moving either edge. */
export function useChatRenderWindow<T>(
  source: () => readonly T[],
  following: (wasAtTail: boolean) => boolean,
  pageSize = DEFAULT_TAIL_PAGE_SIZE,
  capacity = pageSize * 3,
  cost: (start: number, end: number) => number = (start, end) => end - start
) {
  if (pageSize < 1 || capacity < pageSize) throw new RangeError('Invalid chat window size')
  const total = computed(() => source().length)
  const oldest = (end: number, budget: number) => {
    let lo = 0,
      hi = end
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (cost(mid, end) <= budget) hi = mid
      else lo = mid + 1
    }
    return lo
  }
  const newest = (start: number, budget: number) => {
    let lo = start,
      hi = total.value
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (cost(start, mid) <= budget) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const range = shallowRef({ first: oldest(total.value, pageSize), last: total.value })
  const start = computed(() => Math.min(range.value.first, total.value))
  const end = computed(() => Math.min(range.value.last, total.value))
  const visible = computed(() => source().slice(start.value, end.value))
  const hasOlder = computed(() => start.value > 0)
  const hasNewer = computed(() => end.value < total.value)

  const reset = () => {
    range.value = { first: oldest(total.value, pageSize), last: total.value }
  }
  const showOlder = (budget = pageSize) => {
    const first = oldest(start.value, Math.max(1, Math.min(pageSize, budget)))
    range.value = { first, last: Math.min(end.value, newest(first, capacity)) }
  }
  const showNewer = (budget = pageSize) => {
    const last = newest(end.value, Math.max(1, Math.min(pageSize, budget)))
    range.value = { first: Math.max(start.value, oldest(last, capacity)), last }
  }
  const expandOlder = () => {
    const first = Math.max(oldest(start.value, pageSize), oldest(end.value, capacity))
    if (first >= start.value) return false
    range.value = { first, last: end.value }
    return true
  }
  const showFrom = (index: number) => {
    const target = Math.max(0, Math.min(Math.floor(index), Math.max(0, total.value - 1)))
    if (target >= start.value && target < end.value && cost(start.value, end.value) <= capacity)
      return
    range.value = { first: target, last: newest(target, capacity) }
  }

  watch(
    total,
    (now, before) => {
      if (now < before || before === 0) reset()
      else if (following(range.value.last === before)) {
        range.value = { first: Math.max(start.value, oldest(now, capacity)), last: now }
      } else if (range.value.last === before) {
        // Completing a streamed reply mounts its message below the reader. Keep that
        // tail visible without moving their start, up to the existing capacity.
        range.value = { first: start.value, last: newest(start.value, capacity) }
      }
    },
    { flush: 'sync' }
  )

  watch(
    () => cost(start.value, end.value),
    (value) => {
      if (value <= capacity) return
      range.value = following(!hasNewer.value)
        ? { first: oldest(end.value, capacity), last: end.value }
        : { first: start.value, last: newest(start.value, capacity) }
    },
    { flush: 'post' }
  )
  return {
    visible,
    start,
    end,
    total,
    hasOlder,
    hasNewer,
    showOlder,
    showNewer,
    expandOlder,
    showFrom,
    reset,
  }
}
