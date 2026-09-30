import { computed, ref, watch } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import type { PageMemory } from './usePagedList'

export interface TimelineMemory extends PageMemory {
  pastRevealed?: boolean
  recordPast?: (revealed: boolean) => void
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
  const pastRevealed = ref(memory.pastRevealed ?? false)
  const upper = ref<string | null>(null)
  const eligible = computed(() =>
    terms().length || pastRevealed.value ? all.value : all.value.filter(([day]) => day >= today())
  )
  // History has its own state. Revealing it never consumes or expands future pages.
  const forward = computed(() => all.value.filter(([day]) => day >= today()))
  const pageEnd = (pages = 1) =>
    (terms().length ? eligible.value : forward.value).slice(0, pageSize * pages).at(-1)?.[0] ?? null
  upper.value = pageEnd(memory.initial)
  // The sidebar can mount before the vault's tasks arrive. Keep the default batched watch:
  // synchronous reads would rebuild every date for each task as a large relation set loads.
  watch(all, () => {
    if (upper.value === null) upper.value = pageEnd(terms().length ? 1 : memory.initial)
  })
  const visible = computed(() =>
    eligible.value.filter(([day]) => upper.value === null || day <= upper.value)
  )
  const folded = computed(() =>
    terms().length || pastRevealed.value ? [] : all.value.filter(([day]) => day < today())
  )
  const hasMore = computed(
    () => upper.value !== null && all.value.some(([day]) => day > upper.value)
  )
  const sentinel = ref<HTMLElement | null>(null)
  const showMore = () => {
    const next = eligible.value.filter(([day]) => day > (upper.value ?? today())).slice(0, pageSize)
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
  const revealPast = () => {
    pastRevealed.value = true
    if (!terms().length) memory.recordPast?.(true)
  }
  const reset = () => {
    // A label changes the source, not the search: its matching past days must stay visible.
    upper.value = pageEnd()
    if (!terms().length) {
      pastRevealed.value = false
      memory.record(1)
      memory.recordPast?.(false)
    }
  }
  let beforeSearch: { upper: string | null } | null = null
  watch(terms, (words) => {
    if (words.length) {
      beforeSearch ??= { upper: upper.value }
      upper.value = pageEnd()
    } else if (beforeSearch) {
      upper.value = beforeSearch.upper
      beforeSearch = null
    }
  })
  return { visible, folded, hasMore, sentinel, revealPast, reset }
}
