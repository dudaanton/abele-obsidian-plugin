import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'

/**
 * Renders a long list one page at a time, growing when a sentinel element scrolls into view.
 *
 * The lists in a note's footer are unbounded: a note attached to a wide group gathers a
 * relation per member, and every relation mounts a component. Measured on a 43k-file vault,
 * one group note produced 100,984 DOM nodes and blocked the main thread for 4.5 seconds —
 * the cost is the DOM, not the data behind it, which took 477ms to gather. Capping what is
 * mounted at a time keeps opening such a note flat regardless of how large the group is.
 *
 * Bind `sentinel` to an element placed after the last rendered item, and render that element
 * only while `hasMore` is true — an observer on a permanently visible sentinel would keep
 * asking for pages that do not exist.
 *
 * Known limitation, shared with the hand-rolled paging in TransactionsList and
 * TimeEntryListView that this generalises: IntersectionObserver reports threshold crossings,
 * not geometry changes, so a sentinel that stays on screen after a page is added does not
 * fire again. Pick a `pageSize` that reliably overflows the viewport and this never surfaces.
 */
export const DEFAULT_PAGE_SIZE = 20

export interface PagedList<T> {
  /** The slice to render: the first `page count × pageSize` entries of the source. */
  visible: ComputedRef<T[]>
  /** True while the source holds more entries than are currently rendered. */
  hasMore: ComputedRef<boolean>
  /** Total number of entries in the source, rendered or not. */
  total: ComputedRef<number>
  /** Bind to the element that marks the end of the rendered items. */
  sentinel: Ref<HTMLElement | null>
  /** Reveals one more page. Called automatically when the sentinel becomes visible. */
  showMore: () => void
  /** Collapses back to a single page — for when the source is refiltered from scratch. */
  reset: () => void
}

/**
 * @param source getter for the full, already sorted and filtered list
 * @param pageSize how many entries to add per page; tune per list by how costly one entry is
 */
export function usePagedList<T>(
  source: () => readonly T[],
  pageSize: number = DEFAULT_PAGE_SIZE
): PagedList<T> {
  const visibleCount = ref(pageSize)

  const all = computed(() => source())
  const visible = computed(() => all.value.slice(0, visibleCount.value))
  const hasMore = computed(() => all.value.length > visibleCount.value)
  const total = computed(() => all.value.length)

  const showMore = (): void => {
    if (hasMore.value) {
      visibleCount.value += pageSize
    }
  }

  const reset = (): void => {
    visibleCount.value = pageSize
  }

  const sentinel = ref<HTMLElement | null>(null)
  useIntersectionObserver(sentinel, ([entry]) => {
    if (entry?.isIntersecting) {
      showMore()
    }
  })

  return { visible, hasMore, total, sentinel, showMore, reset }
}
