import { computed, ref, watch, type ComputedRef } from 'vue'

/**
 * Renders the end of a long list, growing towards its start a page at a time.
 *
 * The counterpart to `usePagedList`, which renders the beginning of a list and grows towards
 * its end. A conversation is read from its end: the newest message is the one being looked
 * at, and the older ones are history to scroll back through. Rendering all of them costs the
 * same way the footer lists did — every message mounts a component, and an assistant message
 * mounts a markdown renderer with it — so a long chat pays that price in full before showing
 * anything, though almost none of it is on screen.
 *
 * What arrives at the end is always rendered: the slice is taken from the end, so a message
 * added while the conversation is open — or streamed into it — is inside the window by
 * construction, however far back the window has been grown.
 *
 * Growing the window puts content *above* what the reader is looking at, which moves it down
 * the page. Whoever calls `showMore` owns that: the scroll position has to be corrected by
 * the height that appeared, or the view jumps. `AiChat.vue` does this against the scroll
 * container it owns.
 */
export const DEFAULT_TAIL_PAGE_SIZE = 30

export interface TailPagedList<T> {
  /** The slice to render: the last `page count × pageSize` entries of the source. */
  visible: ComputedRef<T[]>
  /** True while entries remain above the rendered ones. */
  hasMore: ComputedRef<boolean>
  /** How many entries are held back — what "load older" would reveal. */
  hidden: ComputedRef<number>
  /** Total number of entries in the source, rendered or not. */
  total: ComputedRef<number>
  /** Reveals one more page towards the start. */
  showMore: () => void
  /** Collapses back to a single page — for when the source is replaced wholesale. */
  reset: () => void
}

/**
 * @param source getter for the full list, oldest entry first
 * @param pageSize how many entries to add per page
 */
export function useTailPagedList<T>(
  source: () => readonly T[],
  pageSize: number = DEFAULT_TAIL_PAGE_SIZE
): TailPagedList<T> {
  const visibleCount = ref(pageSize)

  const all = computed(() => source())
  const total = computed(() => all.value.length)
  const hidden = computed(() => Math.max(0, total.value - visibleCount.value))
  const hasMore = computed(() => hidden.value > 0)
  const visible = computed(() => all.value.slice(Math.max(0, total.value - visibleCount.value)))

  const showMore = (): void => {
    if (hasMore.value) visibleCount.value += pageSize
  }

  const reset = (): void => {
    visibleCount.value = pageSize
  }

  // A source that shrinks has been replaced rather than added to — a different conversation,
  // or one whose history was rewritten. Holding on to a window grown for the old one would
  // render the whole of the new one.
  watch(total, (now, before) => {
    if (now < before) reset()
  })

  return { visible, hasMore, hidden, total, showMore, reset }
}
