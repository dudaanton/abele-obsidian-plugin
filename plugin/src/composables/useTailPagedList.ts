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
 * What arrives at the end is always rendered, and nothing leaves the top when it does: the
 * window is anchored where it starts, so a message added while the conversation is open — or
 * streamed into it — simply lengthens it.
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
  /**
   * How many entries at the start are held back.
   *
   * Counted from the start rather than from the end, and that is the whole of it. A window of
   * "the last thirty" moves forward every time something is appended, so each new message
   * dropped the oldest rendered one and the page shifted up by its height under whoever was
   * reading it. An agent's reply appends several — the answer, a tool call, its result — so a
   * reader who scrolled back mid-reply was thrown about until the reply ended. Holding the
   * start still leaves everything above them where it is and grows the window at the end,
   * which is where the new message went.
   *
   * `null` until there is a list to measure: a chat's messages arrive after the component.
   */
  const held = ref<number | null>(null)

  const all = computed(() => source())
  const total = computed(() => all.value.length)
  const hidden = computed(() =>
    Math.min(held.value ?? Math.max(0, total.value - pageSize), total.value)
  )
  const hasMore = computed(() => hidden.value > 0)
  const visible = computed(() => all.value.slice(hidden.value))

  const showMore = (): void => {
    if (hasMore.value) held.value = Math.max(0, hidden.value - pageSize)
  }

  const reset = (): void => {
    held.value = null
  }

  watch(
    total,
    (now, before = 0) => {
      // A source that shrinks has been replaced rather than added to — a different
      // conversation, or one whose history was rewritten. Holding on to a window grown for the
      // old one would render the whole of the new one.
      if (now < before) {
        held.value = null
        return
      }
      // The first sight of a non-empty list is what the window is anchored against; after
      // that, what arrives at the end is simply rendered.
      if (held.value === null && now > 0) held.value = Math.max(0, now - pageSize)
    },
    { immediate: true }
  )

  return { visible, hasMore, hidden, total, showMore, reset }
}
