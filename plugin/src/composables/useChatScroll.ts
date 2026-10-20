import { watch, nextTick, onUnmounted, type Ref } from 'vue'
import type { ChatMessage } from '@/ai/types'
import { useTailPagedList } from './useTailPagedList'
import { offsetOf, useChatScrollAnchors } from './useChatScrollAnchors'

export const AUTO_SCROLL_THRESHOLD_PX = 60

export interface ReadingPlace {
  messageId: string
  offset: number
  hidden: number
}
interface ChatScrollOptions {
  messagesContainer: Ref<HTMLElement | null>
  messages: Ref<ChatMessage[]>
  streamingContent: Ref<string>
  streamingThinking: Ref<string>
  isStreaming: Ref<boolean>
  composing: Ref<boolean>
}

export function useChatScroll(options: ChatScrollOptions) {
  const {
    messagesContainer,
    messages,
    streamingContent,
    streamingThinking,
    isStreaming,
    composing,
  } = options
  /** How close to the top counts as asking for the messages above. */
  const LOAD_OLDER_THRESHOLD_PX = 200
  let shouldAutoScroll = true

  /**
   * Where the code last left the scroll, for telling its own scrolling from the reader's.
   *
   * A position rather than a flag saying the next scroll event is the code's. That flag was
   * wrong whenever a scroll produced no event to spend it on — scrolling to the bottom of a
   * chat already at its bottom changes nothing, and nothing is what the browser reports — and
   * the reader's next scroll was then read as the code's and ignored, which is how a chat being
   * streamed into pulled them back down the moment they scrolled up to read something.
   */
  let codeScrollTop: number | null = null

  /** How far above the end of the conversation the reader is; kept across a change of box. */
  let bottomGap = 0

  /** Scrolls the container, remembering where the browser actually settled. */
  const scrollContainerTo = (el: HTMLElement, top: number) => {
    el.scrollTop = top
    codeScrollTop = el.scrollTop
    bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
  }

  /**
   * Only the end of the conversation is mounted; scrolling back reveals the rest.
   *
   * Every message mounts a component, and an assistant message mounts a markdown renderer with
   * it, so a long conversation paid for all of it before showing anything.
   */
  const {
    visible: visibleMessages,
    hasMore: hasOlder,
    hidden: olderCount,
    showMore: showOlder,
    reset: resetWindow,
    showFrom: showMessagesFrom,
  } = useTailPagedList(() => messages.value)

  const anchors = useChatScrollAnchors({
    messagesContainer,
    scrollContainerTo,
    shouldAutoScroll: () => shouldAutoScroll,
  })
  const { captureAnchor, holdAnchor, holdAnchorAWhile, steadyReader, holdSteady, endSteady } =
    anchors

  /**
   * The reader taking over, told from their input rather than from a scroll event.
   *
   * A scroll event says where the container is, not who put it there, and while the anchor is
   * held that is not enough: the reader scrolls, the hold puts the container back in the same
   * frame, and the browser reports the two as one event reading exactly the held position —
   * indistinguishable from the hold correcting itself. So the hold held on, and the chat
   * refused to scroll back for as long as it lasted. A wheel, a finger, a key or the scrollbar
   * being taken hold of says what the scroll event cannot.
   */
  const readerTakesOver = (event?: Event) => {
    anchors.anchor = null
    // Heading up, said before the frame reports any scroll: a piece of the reply landing in
    // between used to take a reader still near the end back to it, flick after flick.
    // By type rather than by class: a chat in a popped-out window gets that window's events.
    const up =
      event?.type === 'wheel'
        ? (event as WheelEvent).deltaY < 0
        : event?.type === 'keydown' && SCROLL_UP_KEYS.has((event as KeyboardEvent).key)
    if (up) shouldAutoScroll = false
    // At the very top nothing scrolls, so no scroll event comes to say the reader wants more.
    const el = messagesContainer.value
    if (up && el && el.scrollTop < LOAD_OLDER_THRESHOLD_PX) loadOlder()
  }

  const SCROLL_UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])

  /**
   * A finger on the screen. Nothing is scrolled under it, whichever way it is about to move:
   * following the end resumes once it lets go at the end, as the scroll events then say.
   */
  let fingerDown = false
  const fingerOn = (event: Event) => {
    fingerDown = true
    readerTakesOver(event)
  }
  const fingerOff = () => {
    fingerDown = false
    // Where the finger left it, read now: the scroll it made may not have been reported yet, and
    // the next piece of the reply would otherwise take a reader who went up for one still following.
    const el = messagesContainer.value
    if (!el) return
    bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
    shouldAutoScroll = bottomGap < AUTO_SCROLL_THRESHOLD_PX
  }

  /**
   * Reveals the previous page, keeping the reader where they are.
   *
   * The anchor is held for a moment rather than once, because that is how long the revealed
   * messages take to render themselves. Held with the frames rather than with a timer: a frame
   * is when layout has settled, and there is nothing to correct between them.
   */
  let revealing = false
  const loadOlder = () => {
    const el = messagesContainer.value
    // One page at a time: the next is asked for once this one is on the page and measured.
    if (!el || !hasOlder.value || revealing) return

    revealing = true
    captureAnchor()
    showOlder()
    void nextTick(() => {
      holdAnchorAWhile(el)
      anchors.nextFrame(el.win, () => {
        revealing = false
        revealUntilScrollable()
      })
    })
  }

  /**
   * Reveals earlier pages while the conversation is too short to scroll back through.
   *
   * Revealing waits for the reader to scroll near the top, and a page that does not fill the box
   * has nothing to scroll: an agent's thirty messages are mostly calls folded into a few runs,
   * and they can draw shorter than the box. No scroll event then ever came, and the messages
   * above stayed out of reach. Measured by the content, not the position, so a chat opened at
   * its end is not taken for one being read from the top before it has been scrolled there.
   */
  const revealUntilScrollable = () => {
    const el = messagesContainer.value
    if (!el || composing.value || !hasOlder.value || revealing) return
    // Not laid out — hidden, or nothing drawn in it yet: no height to go by.
    if (!el.clientHeight || !el.scrollHeight) return
    if (el.scrollHeight - el.clientHeight < LOAD_OLDER_THRESHOLD_PX) loadOlder()
  }

  // Before the page changes: a message added, removed or replaced, a reply starting or ending.
  watch(
    [() => messages.value.map((m) => m.id).join(), () => !!streamingContent.value, isStreaming],
    steadyReader,
    { flush: 'pre' }
  )

  /**
   * Where the reader was in each tab they have left, so going back puts them there again.
   *
   * Every tab is read in the same container, and switching used to send each one to its end —
   * reading back through one conversation, looking at another and coming back lost the place.
   * Kept as the message at the top of the box and its distance from the top, plus how far back
   * the window had been opened, rather than as a pixel offset: the messages mount afresh on the
   * way back and render their markdown late, and a pixel offset would land on whatever was there
   * before they had grown. A reader who was at the end has no entry: they go back to the end,
   * including whatever arrived while they were away, as a messenger does. Memory only — a
   * restart opens every chat at its end, as before.
   */
  const places = new Map<string, ReadingPlace>()

  /** Notes where the reader is in the tab being left. The DOM still shows that tab. */
  const rememberPlace = (tabId: string) => {
    places.delete(tabId)
    const el = messagesContainer.value
    // A tab a delegated run holds has no conversation on screen, and so no place in it.
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD_PX) return
    const top = el.getBoundingClientRect().top
    const first = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (m) => m.getBoundingClientRect().bottom > top
    )
    const messageId = first?.dataset.messageId
    if (!first || !messageId) return
    places.set(tabId, { messageId, offset: offsetOf(first, el), hidden: olderCount.value })
  }

  /**
   * Takes the reader back to a remembered place, once the tab's messages are on the page.
   *
   * A message that is no longer there — a branch switched, the history compacted — leaves
   * nothing to go back to, and the chat opens at its end as any other would.
   */
  const returnTo = async (place: ReadingPlace) => {
    const index = messages.value.findIndex((m) => m.id === place.messageId)
    if (index >= 0) {
      showMessagesFrom(Math.min(place.hidden, index))
      await nextTick()
      const el = messagesContainer.value
      const target = el?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(place.messageId)}"]`
      )
      if (el && target) {
        anchors.anchor = { el: target, offset: place.offset }
        holdAnchor()
        // Measured here too: a place already in position is not scrolled to, and a keyboard
        // opening next would otherwise keep the distance to the end of the tab just left.
        bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
        holdAnchorAWhile(el)
        return
      }
    }
    scrollOnUserSend()
  }

  const onMessagesScroll = () => {
    const el = messagesContainer.value
    if (!el) return
    // The box has changed height and its observer has not run yet: this is the browser clamping
    // the position to the new box, not the reader, and the observer is about to put the reader
    // back where they were. The browser reports the clamp before it reports the resize.
    if (boxHeight === null) boxHeight = el.clientHeight
    if (el.clientHeight !== boxHeight) return
    // The container is exactly where it was put, so nobody has moved it since.
    if (codeScrollTop !== null && Math.abs(el.scrollTop - codeScrollTop) < 1) return
    codeScrollTop = null
    // The reader has taken over; whatever was being held is where they left it.
    anchors.anchor = null
    bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
    shouldAutoScroll = bottomGap < AUTO_SCROLL_THRESHOLD_PX
    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX) loadOlder()
  }

  const doScroll = () => {
    if (!shouldAutoScroll || fingerDown) return
    nextTick(() => {
      const el = messagesContainer.value
      // Asked again: the reader may have scrolled away in the tick between.
      if (!el || !shouldAutoScroll || fingerDown) return
      scrollContainerTo(el, el.scrollHeight)
    })
  }

  const scrollOnUserSend = () => {
    shouldAutoScroll = true
    doScroll()
  }

  watch([messages, streamingContent, streamingThinking], () => {
    // Markdown may still be waiting for its display slot. Keep the resize anchor current
    // even when the conversation grows without a completed Markdown mutation in this tick.
    keepGapCurrent()
    doScroll()
    // Once drawn: a conversation opened or switched to may not fill the box.
    const el = messagesContainer.value
    if (el) anchors.nextFrame(el.win, revealUntilScrollable)
  })

  /**
   * The composer opened out over the whole chat, for writing at length (`AiChatInput`). The
   * conversation is hidden under it, and put back where the reader left it when it closes — or
   * at its end, if that is where they were.
   */
  let gapBeforeComposing = 0

  watch(composing, (open) => {
    const el = messagesContainer.value
    if (open) {
      gapBeforeComposing = bottomGap
      return
    }
    void nextTick(() => {
      if (!el || !messagesContainer.value) return
      boxHeight = el.clientHeight
      if (shouldAutoScroll) scrollContainerTo(el, el.scrollHeight)
      else scrollContainerTo(el, el.scrollHeight - el.clientHeight - gapBeforeComposing)
      revealUntilScrollable()
    })
  })

  /**
   * Following the conversation as it grows, and the box it is read in as that changes.
   *
   * Attached to the container element, not once on mount: the container is unmounted while a
   * delegated run holds the tab and mounted afresh when the chat is back, and an observer left
   * on the first element watched nothing at all — a chat that had been away on a run's tab no
   * longer followed its own replies once their markdown rendered.
   */
  let mutObserver: MutationObserver | null = null
  let sizeObserver: ResizeObserver | null = null
  /**
   * The container's height as last reported, for telling a change of box from a scroll. Null
   * until the observer has reported once: the first scroll to arrive before then measures it.
   */
  let boxHeight: number | null = null

  /**
   * Keeps the reader's place when the box around the conversation changes height.
   *
   * A phone's keyboard takes the lower half of the screen and the chat shrinks to sit above it,
   * and nothing scrolls on its own when a box shrinks: what was at the bottom — the message
   * being answered — went under the keyboard, and the reader found themselves at a line read a
   * minute before (2026-09-05, from the phone). At the end of the conversation they stay at the
   * end; anywhere above it they keep their distance from it, which is what the messages above
   * a composer do in every chat app, and the same in reverse when the keyboard goes.
   */
  const onBoxResized = () => {
    const el = messagesContainer.value
    // Hidden under the opened composer: a box of nothing is not a change the reader made.
    if (!el || composing.value) return
    if (el.clientHeight !== boxHeight) {
      boxHeight = el.clientHeight
      if (!shouldAutoScroll) {
        // A reply and the composer can change together. The old bottom gap excludes the
        // reply's new height; using it would scroll that height past the reader.
        if (anchors.anchor) holdAnchor()
        else if (anchors.keepingReader) holdSteady()
        else scrollContainerTo(el, el.scrollHeight - el.clientHeight - bottomGap)
        bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
      }
    }
    // A narrower box wraps the text longer; a reader at the end stays at the end.
    doScroll()
    revealUntilScrollable()
  }

  /**
   * The distance to the end, measured again when the conversation grows or shrinks under a reader
   * who is not following it. A reply streaming in below adds to that distance without a scroll to
   * say so, and the box changing height afterwards — a row appearing under the chat on a phone —
   * put the reader back at the distance from before the reply grew: a jump down by all that had
   * streamed in since they scrolled. Not while the box itself has changed and its observer has not
   * run yet: the distance from before the change is the one it is to keep.
   */
  const keepGapCurrent = () => {
    const el = messagesContainer.value
    if (!el || shouldAutoScroll || fingerDown) return
    if (boxHeight !== null && el.clientHeight !== boxHeight) return
    bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
  }

  const observe = (el: HTMLElement) => {
    mutObserver = new MutationObserver(() => {
      // Hidden under the opened composer; it is put right when the composer closes.
      if (composing.value) return
      // A message that has just rendered its markdown changes the subtree and the layout
      // with it — which is exactly when the anchor needs putting back.
      holdAnchor()
      holdSteady()
      keepGapCurrent()
      doScroll()
      revealUntilScrollable()
    })
    mutObserver.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    })
    boxHeight = null
    sizeObserver = new ResizeObserver(onBoxResized)
    sizeObserver.observe(el)
    anchors.nextFrame(el.win, revealUntilScrollable)
  }

  const unobserve = () => {
    mutObserver?.disconnect()
    mutObserver = null
    sizeObserver?.disconnect()
    sizeObserver = null
  }

  watch(
    messagesContainer,
    (el) => {
      unobserve()
      if (el) observe(el)
    },
    { immediate: true, flush: 'post' }
  )
  onUnmounted(unobserve)

  const holdInView = (el: HTMLElement, offset: number) => {
    const box = messagesContainer.value
    if (!box) return
    shouldAutoScroll = false
    anchors.anchor = { el, offset }
    holdAnchor()
    bottomGap = box.scrollHeight - box.scrollTop - box.clientHeight
    holdAnchorAWhile(box)
  }

  return {
    visibleMessages,
    olderCount,
    showMessagesFrom,
    resetWindow,
    readerTakesOver,
    fingerOn,
    fingerOff,
    onMessagesScroll,
    scrollOnUserSend,
    doScroll,
    holdInView,
    endSteady,
    loadOlder,
    rememberPlace,
    returnTo,
    places,
    nextFrame: anchors.nextFrame,
    clearAnchor: () => {
      anchors.anchor = null
    },
    get shouldAutoScroll() {
      return shouldAutoScroll
    },
    set shouldAutoScroll(value: boolean) {
      shouldAutoScroll = value
    },
  }
}
