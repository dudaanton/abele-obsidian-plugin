import { computed, shallowRef, watch } from 'vue'
import { DEFAULT_TAIL_PAGE_SIZE } from './useTailPagedList'

/** A bounded, bidirectional slice. The caller anchors layout before moving either edge. */
export function useChatRenderWindow<T>(
  source: () => readonly T[],
  following: (wasAtTail: boolean) => boolean,
  pageSize = DEFAULT_TAIL_PAGE_SIZE,
  capacity = pageSize * 3,
  cost: (start: number, end: number) => number = (start, end) => end - start,
  retained?: () => { first: number; last: number } | undefined
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
  const showOlder = (budget = pageSize, preserve = !!retained) => {
    const first = oldest(start.value, Math.max(1, Math.min(pageSize, budget)))
    range.value = {
      first,
      last: preserve ? end.value : Math.min(end.value, newest(first, capacity)),
    }
  }
  const showNewer = (budget = pageSize, preserve = !!retained) => {
    const last = newest(end.value, Math.max(1, Math.min(pageSize, budget)))
    range.value = {
      first: preserve ? start.value : Math.max(start.value, oldest(last, capacity)),
      last,
    }
  }
  // The caller captures an anchor and invokes this only after layout has settled.
  // Pixel coverage takes precedence over the work budget for short/folded rows.
  const trim = (beforeChange: () => void, direction: 'older' | 'newer') => {
    if (cost(start.value, end.value) <= capacity) return false
    const keep =
      retained?.() ??
      (direction === 'older'
        ? { first: start.value, last: newest(start.value, capacity) }
        : { first: oldest(end.value, capacity), last: end.value })
    const first =
      direction === 'older'
        ? Math.max(start.value, oldest(keep.first, pageSize))
        : Math.max(start.value, Math.min(keep.first, oldest(end.value, capacity)))
    const last =
      direction === 'newer'
        ? Math.min(end.value, newest(keep.last, pageSize))
        : Math.min(end.value, Math.max(keep.last, newest(first, capacity)))
    if (first === start.value && last === end.value) return false
    beforeChange()
    range.value = { first, last }
    return true
  }
  const expandOlder = () => {
    const first = retained
      ? oldest(start.value, pageSize)
      : Math.max(oldest(start.value, pageSize), oldest(end.value, capacity))
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
  /** A previously measured window must keep its row/group boundaries on remount. */
  const restore = (first: number, last: number) => {
    const start = Math.max(0, Math.min(first, total.value))
    range.value = {
      first: start,
      last: Math.max(start, Math.min(last, total.value)),
    }
  }

  watch(
    total,
    (now, before) => {
      if (now < before || before === 0) reset()
      else if (following(range.value.last === before)) {
        const keep = retained?.()
        range.value = {
          first: Math.max(start.value, Math.min(keep?.first ?? now, oldest(now, capacity))),
          last: now,
        }
      } else if (range.value.last === before) {
        // Completing a streamed reply mounts its message below the reader. Keep that
        // tail visible without moving their start, up to the existing capacity.
        range.value = {
          first: start.value,
          last: Math.max(end.value, newest(start.value, capacity)),
        }
      }
    },
    { flush: 'sync' }
  )

  watch(
    () => cost(start.value, end.value),
    (value) => {
      if (value <= capacity || retained) return
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
    restore,
    trim,
    reset,
  }
}
