import { computed, ref, watch } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import type { PageMemory } from './usePagedList'

export interface TimelineMemory extends PageMemory {
  lower?: string | null
  recordLower?: (day: string | null) => void
}

/** Date boundaries, not array offsets: newly visible completed days cannot evict a read day. */
export function useTimelineDays<T>(
  source: () => readonly [string, T[]][],
  today: () => string,
  terms: () => readonly string[],
  pageSize: number,
  memory: TimelineMemory,
  enabled: () => boolean = () => true
) {
  // A folded footer must not read the date map, even as tasks arrive in separate batches.
  const all = computed(() => (enabled() ? source() : []))
  const lower = ref<string | null>(memory.lower ?? null)
  const upper = ref<string | null>(null)
  const start = computed(() => lower.value ?? today())
  const eligible = computed(() => all.value.filter(([day]) => day >= start.value))
  // History has its own boundary. Future-page memory must not round an extra revealed past
  // day up to an entire future page when the note reopens.
  const forward = computed(() => all.value.filter(([day]) => day >= today()))
  const pageEnd = (pages = 1) =>
    (terms().length ? eligible.value : forward.value).slice(0, pageSize * pages).at(-1)?.[0] ?? null
  upper.value = pageEnd(memory.initial)
  // The sidebar can mount before the vault's tasks arrive. Keep the default batched watch:
  // synchronous reads would rebuild every date for each task as a large relation set loads.
  watch(all, () => {
    // Description matches arrive after title matches. No matching past day belongs in the
    // history strip during a search, even when an earlier batch already filled the window.
    if (terms().length) lower.value = all.value[0]?.[0] ?? null
    if (upper.value === null) upper.value = pageEnd(terms().length ? 1 : memory.initial)
  })
  const visible = computed(() =>
    eligible.value.filter(([day]) => upper.value === null || day <= upper.value)
  )
  const folded = computed(() => all.value.filter(([day]) => day < start.value))
  const hasMore = computed(
    () => upper.value !== null && all.value.some(([day]) => day > upper.value)
  )
  const sentinel = ref<HTMLElement | null>(null)
  const showMore = () => {
    const next = all.value.filter(([day]) => day > (upper.value ?? start.value)).slice(0, pageSize)
    if (next.length) upper.value = next.at(-1)[0]
    if (!terms().length)
      memory.record(
        Math.max(
          1,
          Math.ceil(forward.value.filter(([day]) => day <= upper.value).length / pageSize)
        )
      )
  }
  useIntersectionObserver(sentinel, ([entry]) => {
    if (entry?.isIntersecting) showMore()
  })
  const revealPrevious = () => {
    const previous = folded.value.at(-1)
    if (previous) {
      lower.value = previous[0]
      if (!terms().length) {
        memory.recordLower?.(lower.value)
      }
    }
  }
  const reset = () => {
    // A label changes the source, not the search: its matching past days must stay visible.
    lower.value = terms().length ? (all.value[0]?.[0] ?? null) : null
    upper.value = pageEnd()
    if (!terms().length) {
      memory.record(1)
      memory.recordLower?.(null)
    }
  }
  let beforeSearch: { lower: string | null; upper: string | null } | null = null
  watch(terms, (words) => {
    if (words.length) {
      beforeSearch ??= { lower: lower.value, upper: upper.value }
      lower.value = all.value[0]?.[0] ?? null
      upper.value = pageEnd()
    } else if (beforeSearch) {
      lower.value = beforeSearch.lower
      upper.value = beforeSearch.upper
      beforeSearch = null
    }
  })
  return { visible, folded, hasMore, sentinel, revealPrevious, reset }
}
