import { computed, watch, nextTick, onUnmounted, type Ref } from 'vue'
import type { ChatMessage } from '@/ai/types'
import { useChatRenderWindow } from './useChatRenderWindow'
import { offsetOf, useChatScrollAnchors, type ChatScrollGeometry } from './useChatScrollAnchors'

export const AUTO_SCROLL_THRESHOLD_PX = 60
// Integer layout metrics can put the native scroll limit one pixel below their end.
const BOTTOM_EPSILON_PX = 2

export interface ReadingPlace {
  messageId: string
  offset: number
  hidden: number
  window?: { first: string; last: string }
}
interface ChatScrollOptions {
  windowCost?: (start: number, end: number) => number
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
  const messageIndices = computed(() => new Map(messages.value.map((m, i) => [m.id, i])))
  const retainedRows = () => {
    const el = messagesContainer.value
    if (!el || !el.clientHeight) return
    const viewport = el.getBoundingClientRect()
    const overscan = el.clientHeight
    let first = messages.value.length
    let last = 0
    for (const row of Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'))) {
      const rect = row.getBoundingClientRect()
      if (
        rect.bottom <= rect.top ||
        rect.bottom < viewport.top - overscan ||
        rect.top > viewport.bottom + overscan
      )
        continue
      const ids = row.dataset.runIds?.split(' ') ?? [row.dataset.messageId]
      for (const id of ids) {
        const index = messageIndices.value.get(id)
        if (index === undefined) continue
        first = Math.min(first, index)
        let end = index + 1
        // Results belong to their call even when the folded run hides their DOM.
        while (messages.value[end]?.role === 'tool-result') end++
        last = Math.max(last, end)
      }
    }
    return last > first ? { first, last } : undefined
  }
  /** How close to the top counts as asking for the messages above. */
  const LOAD_OLDER_THRESHOLD_PX = 200
  let shouldAutoScroll = true
  let fingerDown = false
  let wheelScrolling = false
  let nativeScrolling = false
  let touchY: number | null = null
  let readerDirection = 0
  let sendScrollPending = false
  let readingFromMarker = false
  let queuedMarkerPages = 0
  let idlePrefetch: { win: Window; timer: number } | undefined
  const cancelIdlePrefetch = () => {
    if (idlePrefetch) idlePrefetch.win.clearTimeout(idlePrefetch.timer)
    idlePrefetch = undefined
  }
  const scheduleIdlePrefetch = () => {
    cancelIdlePrefetch()
    const el = messagesContainer.value
    if (!el) return
    const win = el.win
    idlePrefetch = {
      win,
      timer: win.setTimeout(() => {
        idlePrefetch = undefined
        if (
          messagesContainer.value !== el ||
          shouldAutoScroll ||
          readerDirection > 0 ||
          fingerDown ||
          revealing ||
          readingFromMarker ||
          composing.value ||
          sendScrollPending ||
          !hasOlder.value ||
          !el.clientHeight ||
          !el.scrollHeight ||
          el.scrollTop > el.clientHeight * 2
        )
          return
        console.debug('[chat-scroll] idle history prefetch', { scrollTop: el.scrollTop })
        // Use the ordinary, anchored full-page transaction once per quiet input burst.
        // Its layout notifications do not schedule another idle page.
        loadOlder()
      }, 200),
    }
  }
  const leaveMarker = () => {
    readingFromMarker = false
    queuedMarkerPages = 0
  }
  const isMarkerInput = (event?: Event) => {
    if (!(event?.target as HTMLElement | null)?.closest?.('.abele-ai-chat__older')) return false
    if (event?.type === 'wheel' || event?.type === 'touchmove') return false
    return !(
      event?.type === 'keydown' &&
      ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(
        (event as KeyboardEvent).key
      )
    )
  }

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
  let observedScrollTop = 0
  let followedHeight: number | null = null

  /** How far above the end of the conversation the reader is; kept across a change of box. */
  let bottomGap = 0

  /** Scrolls the container, remembering where the browser actually settled. */
  const scrollContainerTo = (
    el: HTMLElement,
    top: number,
    reason: string,
    measured?: ChatScrollGeometry
  ) => {
    const before = measured?.scrollTop ?? el.scrollTop
    el.scrollTop = top
    // Anchor corrections already measured and clamped the target while the floor
    // was present. Keep the write phase free of layout reads.
    const after = measured ? top : el.scrollTop
    const height = measured?.scrollHeight ?? el.scrollHeight
    const clientHeight = measured?.clientHeight ?? el.clientHeight
    codeScrollTop = after
    observedScrollTop = after
    bottomGap = height - after - clientHeight
    if (shouldAutoScroll) followedHeight = height
    if (Math.abs(after - before) >= 1)
      console.debug('[chat-scroll] correction', {
        reason,
        delta: after - before,
        requestedDelta: top - before,
        before,
        after,
        scrollHeight: height,
        clientHeight,
        bottomGap,
        following: shouldAutoScroll,
        streaming: isStreaming.value,
      })
  }

  /**
   * Only the end of the conversation is mounted; scrolling back reveals the rest.
   *
   * Every message mounts a component, and an assistant message mounts a markdown renderer with
   * it, so a long conversation paid for all of it before showing anything.
   */
  const {
    visible: visibleMessages,
    hasOlder,
    hasNewer,
    start: olderCount,
    end: windowEnd,
    showOlder,
    expandOlder,
    showNewer,
    trim: trimRenderWindow,
    reset: resetRenderWindow,
    showFrom: showRenderMessagesFrom,
    restore: restoreRenderWindow,
  } = useChatRenderWindow(
    () => messages.value,
    (wasAtTail) => {
      if (shouldAutoScroll && !fingerDown) return true
      if (!wasAtTail) return false
      const el = messagesContainer.value
      const live = el?.querySelector('.abele-ai-chat__streaming-content')
      if (!el || !live) return false
      const viewport = el.getBoundingClientRect(),
        content = live.getBoundingClientRect()
      return content.bottom > viewport.top && content.top < viewport.bottom
    },
    undefined,
    undefined,
    options.windowCost,
    retainedRows
  )
  const resetWindow = () => {
    cancelIdlePrefetch()
    leaveMarker()
    resetRenderWindow()
  }
  const showMessagesFrom = (index: number) => {
    cancelIdlePrefetch()
    leaveMarker()
    showRenderMessagesFrom(index)
  }

  const anchors = useChatScrollAnchors({
    messagesContainer,
    scrollContainerTo,
    shouldAutoScroll: () => shouldAutoScroll,
    isStreaming: () => isStreaming.value,
    isReaderScrolling: () => nativeScrolling,
    messageAnchorIds: (el) => {
      const id = el.dataset.messageId
      if (!id) return []
      const ids = [id]
      let index = messageIndices.value.get(id)
      if (index !== undefined && messages.value[index]?.role === 'tool-result') {
        while (index > 0 && messages.value[index]?.role === 'tool-result') index--
        if (messages.value[index]?.role === 'tool-call') ids.push(messages.value[index].id)
      }
      return ids
    },
  })
  const { beginPageChange, holdAnchorAWhile, steadyReader, endSteady } = anchors
  watch(visibleMessages, () => anchors.finishPageChange(), { flush: 'post' })

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
    const field = (event?.target as HTMLElement | null)?.closest?.(
      'input, textarea, [contenteditable="true"]'
    )
    if (event?.type === 'keydown' && field) return
    if (isMarkerInput(event)) return
    scheduleIdlePrefetch()
    nativeScrolling = true
    wheelScrolling = event?.type === 'wheel'
    const point = (event as TouchEvent | undefined)?.touches?.[0]
    const touchDelta =
      event?.type === 'touchmove' && point && touchY !== null ? touchY - point.clientY : 0
    if (point) touchY = point.clientY
    if (event?.type === 'touchstart' || event?.type === 'mousedown') readerDirection = 0
    leaveMarker()
    console.debug('[chat-scroll] reader input', {
      type: event?.type,
      scrollTop: messagesContainer.value?.scrollTop,
    })
    sendScrollPending = false
    const wasFollowing = shouldAutoScroll
    shouldAutoScroll = false
    anchors.releaseReader()
    codeScrollTop = null
    if (event?.type === 'keydown' && (event as KeyboardEvent).key === 'End') {
      event.preventDefault()
      scrollOnUserSend()
      return
    }
    // Heading up, said before the frame reports any scroll: a piece of the reply landing in
    // between used to take a reader still near the end back to it, flick after flick.
    // By type rather than by class: a chat in a popped-out window gets that window's events.
    const shiftSpace =
      event?.type === 'keydown' &&
      (event as KeyboardEvent).key === ' ' &&
      (event as KeyboardEvent).shiftKey
    const up =
      event?.type === 'wheel'
        ? (event as WheelEvent).deltaY < 0
        : touchDelta < 0 ||
          shiftSpace ||
          (event?.type === 'keydown' && SCROLL_UP_KEYS.has((event as KeyboardEvent).key))
    const down =
      event?.type === 'wheel'
        ? (event as WheelEvent).deltaY > 0
        : touchDelta > 0 ||
          (!shiftSpace &&
            event?.type === 'keydown' &&
            ['ArrowDown', 'PageDown', ' '].includes((event as KeyboardEvent).key))
    if (up) readerDirection = -1
    else if (down) readerDirection = 1
    // At the very top nothing scrolls, so no scroll event comes to say the reader wants more.
    const el = messagesContainer.value
    const ahead =
      event?.type === 'wheel' ? Math.abs((event as WheelEvent).deltaY) : Math.abs(touchDelta)
    // Compositor input can outrun/coalesce the scroll event that prefetches a
    // viewport ahead. Use that same lead here, before the next native step can
    // clamp at a virtual edge and discard the remaining finger travel.
    const lead =
      fingerDown || wheelScrolling
        ? Math.max(LOAD_OLDER_THRESHOLD_PX, el?.clientHeight ?? 0)
        : LOAD_OLDER_THRESHOLD_PX
    if (up && el && el.scrollTop < lead + ahead) loadOlder(undefined, false, lead + ahead)
    else if (down && el) {
      if (
        !hasNewer.value &&
        ((fingerDown && wasFollowing) ||
          el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_EPSILON_PX)
      )
        shouldAutoScroll = true
      if (el.scrollHeight - el.scrollTop - el.clientHeight < lead + ahead) loadNewer(lead + ahead)
    } else if (event?.type === 'touchstart') checkEdges()
  }

  const SCROLL_UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])

  /**
   * A finger on the screen. Nothing is scrolled under it, whichever way it is about to move:
   * following the end resumes once it lets go at the end, as the scroll events then say.
   */
  const fingerOn = (event: Event) => {
    if (isMarkerInput(event)) return
    fingerDown = true
    readerTakesOver(event)
  }
  const fingerOff = (event?: Event) => {
    const movingUp = readerDirection < 0
    fingerDown = false
    touchY = null
    if (isMarkerInput(event)) return
    scheduleIdlePrefetch()
    // Where the finger left it, read now: the scroll it made may not have been reported yet, and
    // the next piece of the reply would otherwise take a reader who went up for one still following.
    const el = messagesContainer.value
    if (!el) return
    bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
    shouldAutoScroll =
      !hasNewer.value &&
      !movingUp &&
      (shouldAutoScroll || (bottomGap < BOTTOM_EPSILON_PX && el.scrollTop >= observedScrollTop))
    observedScrollTop = el.scrollTop
    if (shouldAutoScroll) {
      endSteady(el)
      doScroll()
    } else if (isStreaming.value) steadyReader()
    checkEdges()
  }

  /**
   * Reveals the previous page, keeping the reader where they are.
   *
   * The anchor is held for a moment rather than once, because that is how long the revealed
   * messages take to render themselves. Held with the frames rather than with a timer: a frame
   * is when layout has settled, and there is nothing to correct between them.
   */
  let revealing = false
  let deferredEdge: { direction: 'older' | 'newer'; lead: number } | undefined
  const refusedEdge = (direction: 'older' | 'newer', lead: number) => {
    // A prefetch is still needed when the current page finishes. Retrying it
    // with the ordinary 200px threshold discards the earlier input's headroom.
    deferredEdge = {
      direction,
      lead: Math.max(lead, deferredEdge?.direction === direction ? deferredEdge.lead : 0),
    }
    console.debug('[chat-scroll] edge load deferred', { ...deferredEdge, revealing })
  }
  // A reveal can consume the only scroll event at an edge. Measure again once its
  // layout settles, even if the browser has no further movement to report.
  const checkEdges = (direction?: 'older' | 'newer', lead = LOAD_OLDER_THRESHOLD_PX) => {
    const el = messagesContainer.value
    if (readingFromMarker) return
    const intent = readerDirection < 0 ? 'older' : readerDirection > 0 ? 'newer' : undefined
    if (intent) {
      if (direction && direction !== intent) {
        console.debug('[chat-scroll] edge replay released by reader', { direction, intent })
        return
      }
      direction = intent
    }
    if (!el || composing.value || sendScrollPending || !el.clientHeight || !el.scrollHeight) return
    if (boxHeight !== null && el.clientHeight !== boxHeight) return
    // Folded pages can touch both edges. Continue in the requested direction so
    // a bounded window does not alternate between the same two short pages.
    if (direction === 'newer') {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < lead) loadNewer(lead)
      return
    }
    if (direction === 'older') {
      if (el.scrollTop < lead) loadOlder(undefined, false, lead)
      return
    }
    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX) loadOlder()
    else if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_OLDER_THRESHOLD_PX) loadNewer()
  }
  const finishReveal = (direction: 'older' | 'newer', automatic = false) => {
    if (!readingFromMarker) {
      if (trimRenderWindow(beginPageChange, direction)) {
        const el = messagesContainer.value
        void nextTick(() => {
          holdAnchorAWhile(el)
          anchors.nextFrame(el.win, () => finishReveal(direction, automatic))
        })
        return
      }
    }
    revealing = false
    const retry = deferredEdge
    deferredEdge = undefined
    console.debug('[chat-scroll] edge load recheck', { direction, retry })
    if (queuedMarkerPages) {
      queuedMarkerPages--
      if (hasOlder.value) loadOlder()
      else queuedMarkerPages = 0
      return
    }
    if (readingFromMarker) return
    if (retry || direction === 'newer' || (!automatic && !anchors.anchor))
      checkEdges(retry?.direction ?? direction, retry?.lead)
    if (direction === 'older') revealUntilScrollable()
  }
  const loadOlder = (event?: Event, automatic = false, lead = LOAD_OLDER_THRESHOLD_PX) => {
    const el = messagesContainer.value
    if (event?.type === 'click') {
      shouldAutoScroll = false
      readingFromMarker = true
      deferredEdge = undefined
      console.debug('[chat-scroll] marker page requested', {
        olderCount: olderCount.value,
        revealing,
      })
      if (revealing) {
        queuedMarkerPages++
        console.debug('[chat-scroll] marker page queued', { queuedMarkerPages })
        return
      }
    }
    // One page at a time: the next is asked for once this one is on the page and measured.
    if (!el || !hasOlder.value) return
    if (revealing) return refusedEdge('older', lead)

    console.debug('[chat-scroll] edge load started', {
      direction: 'older',
      lead,
      scrollTop: el.scrollTop,
      automatic,
    })
    const wasFollowing = shouldAutoScroll
    if (automatic && !expandOlder()) return
    revealing = true
    if (!automatic) shouldAutoScroll = false
    anchors.releaseReader()
    if (!automatic || !wasFollowing) beginPageChange()
    if (!automatic) showOlder(undefined, !readingFromMarker && el.childElementCount > 0)
    void nextTick(() => {
      if (automatic && wasFollowing) {
        if (shouldAutoScroll && !fingerDown) doScroll()
      } else holdAnchorAWhile(el)
      anchors.nextFrame(el.win, () => finishReveal('older', automatic))
    })
  }

  const loadNewer = (lead = LOAD_OLDER_THRESHOLD_PX) => {
    const el = messagesContainer.value
    if (!el || !hasNewer.value) return
    if (revealing) return refusedEdge('newer', lead)
    console.debug('[chat-scroll] edge load started', {
      direction: 'newer',
      lead,
      scrollTop: el.scrollTop,
    })
    revealing = true
    anchors.releaseReader()
    beginPageChange()
    showNewer(undefined, el.childElementCount > 0)
    void nextTick(() => {
      holdAnchorAWhile(el)
      anchors.nextFrame(el.win, () => finishReveal('newer'))
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
    if (!el || composing.value || !hasOlder.value || revealing || readingFromMarker || fingerDown)
      return
    // Not laid out — hidden, or nothing drawn in it yet: no height to go by.
    if (!el.clientHeight || !el.scrollHeight) return
    if (el.scrollHeight - el.clientHeight < LOAD_OLDER_THRESHOLD_PX) loadOlder(undefined, true)
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
    const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'))
    // messages already belongs to the incoming tab in a pre-flush tab watcher. Read
    // the outgoing window's identities from its DOM, including folded tool runs.
    const firstRow = rows[0]
    const lastRow = rows.at(-1)
    const firstId = firstRow?.dataset.runIds?.split(' ')[0] ?? firstRow?.dataset.messageId
    const lastId = lastRow?.dataset.runIds?.split(' ').at(-1) ?? lastRow?.dataset.messageId
    const place = {
      messageId,
      offset: offsetOf(first, el),
      hidden: olderCount.value,
      window: firstId && lastId ? { first: firstId, last: lastId } : undefined,
    }
    console.debug('[chat-scroll] remember place', { tabId, ...place })
    places.set(tabId, place)
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
      const first = messages.value.findIndex((m) => m.id === place.window?.first)
      let last = messages.value.findIndex((m) => m.id === place.window?.last)
      if (first >= 0 && last >= index && first <= index) {
        while (messages.value[last + 1]?.role === 'tool-result') last++
        cancelIdlePrefetch()
        leaveMarker()
        restoreRenderWindow(first, last + 1)
      } else showMessagesFrom(Math.max(0, index - 5))
      await nextTick()
      const el = messagesContainer.value
      const target = el?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(place.messageId)}"]`
      )
      if (el && target) {
        console.debug('[chat-scroll] restore place', {
          messageId: place.messageId,
          savedOffset: place.offset,
          mountedOffset: offsetOf(target, el),
          start: olderCount.value,
          end: windowEnd.value,
        })
        endSteady(el)
        nativeScrolling = false
        anchors.anchor = { el: target, offset: place.offset, restoring: true }
        // Measured here too: a place already in position is not scrolled to, and a keyboard
        // opening next would otherwise keep the distance to the end of the tab just left.
        anchors.holdLayout(({ scrollHeight, scrollTop, clientHeight }) => {
          bottomGap = scrollHeight - scrollTop - clientHeight
        })
        holdAnchorAWhile(el)
        anchors.nextFrame(el.win, () => {
          if (!el.contains(target)) return
          console.debug('[chat-scroll] restore applied', {
            messageId: place.messageId,
            savedOffset: place.offset,
            actualOffset: offsetOf(target, el),
            scrollTop: el.scrollTop,
            holding: !!anchors.anchor?.restoring,
          })
        })
        return
      }
    }
    scrollOnUserSend()
  }

  const onMessagesScroll = () => {
    const el = messagesContainer.value
    if (!el) return
    // A remount can clamp or asynchronously apply the requested scroll. Such
    // layout events must not discard the saved destination as native input.
    // Actual wheel/touch/key input releases this hold in readerTakesOver.
    if (anchors.anchor?.restoring) {
      anchors.holdLayout(keepGapCurrent)
      return
    }
    if (
      el.scrollTop !== observedScrollTop &&
      (codeScrollTop === null || Math.abs(el.scrollTop - codeScrollTop) >= 1)
    )
      scheduleIdlePrefetch()
    // A marker reveal can evict the visible tail. Browser clamping/re-anchoring
    // is layout, not a reader asking to put that tail back. Input releases this
    // intent; queued clicks each retain their own page independently of edges.
    if (readingFromMarker) {
      console.debug('[chat-scroll] marker layout scroll', { scrollTop: el.scrollTop })
      return
    }
    // Sending resets the render window before its queued bottom scroll. The browser
    // can report that layout adjustment first; it must not cancel the send's intent.
    // Actual reader input cancels it through readerTakesOver, even before this tick.
    if (sendScrollPending) return
    // The box has changed height and its observer has not run yet: this is the browser clamping
    // the position to the new box, not the reader, and the observer is about to put the reader
    // back where they were. The browser reports the clamp before it reports the resize.
    if (boxHeight === null) boxHeight = el.clientHeight
    if (el.clientHeight !== boxHeight) {
      return
    }
    // The page has moved in the data but its DOM/anchor may not have settled.
    // Do not release that anchor or infer following from this intermediate range.
    if (revealing) {
      if (codeScrollTop !== null && Math.abs(el.scrollTop - codeScrollTop) < 1) return
      if (
        el.scrollTop < LOAD_OLDER_THRESHOLD_PX ||
        el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_OLDER_THRESHOLD_PX
      ) {
        checkEdges()
        return
      }
    }
    // Layout can move the browser's scroll anchor before ResizeObserver follows
    // the new end. That event does not mean the reader scrolled away. Upward
    // reader input has already disabled following in readerTakesOver.
    if (
      shouldAutoScroll &&
      followedHeight !== null &&
      el.scrollHeight !== followedHeight &&
      el.scrollTop >= Math.min(observedScrollTop, Math.max(0, el.scrollHeight - el.clientHeight))
    ) {
      doScroll()
      return
    }
    // The container is exactly where it was put, so nobody has moved it since.
    if (codeScrollTop !== null && Math.abs(el.scrollTop - codeScrollTop) < 1) {
      // A delayed correction event is not a request to undo a marker/navigation
      // reveal. Refused reader requests retry in finishReveal; edge gestures
      // also ask directly when the browser has no movement left to report.
      return
    }
    console.debug('[chat-scroll] scroll event', {
      scrollTop: el.scrollTop,
      codeScrollTop,
      bottomGap: el.scrollHeight - el.scrollTop - el.clientHeight,
      following: shouldAutoScroll,
      readingAnchor: anchors.keepingReader,
      fingerDown,
    })
    codeScrollTop = null
    // Scrollbar/accessibility movement need not deliver wheel or touch input.
    // A scroll distinct from our correction is native movement, including when
    // streamed growth arrived in the same frame.
    nativeScrolling = true
    // The reader has taken over; whatever was being held is where they left it.
    anchors.releaseReader()
    bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
    const moved = el.scrollTop - observedScrollTop
    // A stationary layout event cannot hand ownership back after reader input.
    shouldAutoScroll =
      !hasNewer.value &&
      bottomGap < BOTTOM_EPSILON_PX &&
      (shouldAutoScroll || (readerDirection >= 0 && moved > 0))
    observedScrollTop = el.scrollTop
    if (shouldAutoScroll) endSteady(el)
    else if (isStreaming.value && !fingerDown) steadyReader()
    // Input events coalesce while compositor scroll frames keep arriving. Mount
    // the next page early enough for its markdown to draw before reaching the edge.
    const ahead =
      fingerDown || wheelScrolling
        ? Math.max(LOAD_OLDER_THRESHOLD_PX, el.clientHeight)
        : LOAD_OLDER_THRESHOLD_PX
    if (moved < 0 && readerDirection <= 0 && el.scrollTop < ahead)
      loadOlder(undefined, false, ahead)
    else if (moved > 0 && readerDirection >= 0 && bottomGap < ahead) loadNewer(ahead)
    // Host/accessibility scrolls can arrive without an input event or prior position.
    else if (!moved && !readerDirection && !fingerDown) checkEdges()
    scheduleReveal(el)
  }

  let followQueued = false
  const doScroll = () => {
    if (!shouldAutoScroll || fingerDown || followQueued) return
    followQueued = true
    void nextTick(() => {
      followQueued = false
      const el = messagesContainer.value
      // Asked again: the reader may have scrolled away in the tick between.
      if (!el || !shouldAutoScroll || fingerDown) return
      // Native scrollbar movement can precede its DOM scroll event. A queued
      // mutation must not overwrite it when the unchanged range rules out a
      // layout clamp. A new container has no followed height until its first follow.
      if (
        !sendScrollPending &&
        followedHeight !== null &&
        el.scrollHeight === followedHeight &&
        el.scrollTop < Math.min(observedScrollTop, el.scrollHeight - el.clientHeight)
      ) {
        onMessagesScroll()
        return
      }
      scrollContainerTo(el, el.scrollHeight, sendScrollPending ? 'send' : 'follow')
      sendScrollPending = false
    })
  }

  const scrollOnUserSend = () => {
    // Sending leaves the remembered reading position, including holds still running
    // from revealing history or completing a reply. They must not undo this scroll.
    anchors.releaseReader()
    nativeScrolling = false
    readerDirection = 0
    sendScrollPending = true
    shouldAutoScroll = true
    resetWindow()
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
      if (shouldAutoScroll) scrollContainerTo(el, el.scrollHeight, 'composer-close-follow')
      else
        scrollContainerTo(
          el,
          el.scrollHeight - el.clientHeight - gapBeforeComposing,
          'composer-close-gap'
        )
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
  const observedMessages = new Set<Element>()
  const observeMessageSizes = (el: HTMLElement) => {
    for (const message of observedMessages) {
      if (message.parentElement === el) continue
      sizeObserver?.unobserve(message)
      observedMessages.delete(message)
    }
    for (const message of Array.from(el.children)) {
      if (observedMessages.has(message)) continue
      sizeObserver?.observe(message)
      observedMessages.add(message)
    }
  }
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
    let heldLayout = false
    if (el.clientHeight !== boxHeight) {
      console.debug('[chat-scroll] box resize', {
        before: boxHeight,
        after: el.clientHeight,
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        bottomGap,
        following: shouldAutoScroll,
        messageAnchor: !!anchors.anchor,
        readingAnchor: anchors.keepingReader,
      })
      boxHeight = el.clientHeight
      if (!shouldAutoScroll) {
        // A reply and the composer can change together. The old bottom gap excludes the
        // reply's new height; using it would scroll that height past the reader.
        if (anchors.anchor || anchors.keepingReader) {
          anchors.holdLayout(keepGapCurrent)
          heldLayout = true
        } else {
          scrollContainerTo(el, el.scrollHeight - el.clientHeight - bottomGap, 'box-resize-gap')
          bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
        }
      }
    }
    // A narrower box wraps the text longer; a reader at the end stays at the end.
    doScroll()
    if (heldLayout) scheduleReveal(el)
    else revealUntilScrollable()
  }

  /**
   * The distance to the end, measured again when the conversation grows or shrinks under a reader
   * who is not following it. A reply streaming in below adds to that distance without a scroll to
   * say so, and the box changing height afterwards — a row appearing under the chat on a phone —
   * put the reader back at the distance from before the reply grew: a jump down by all that had
   * streamed in since they scrolled. Not while the box itself has changed and its observer has not
   * run yet: the distance from before the change is the one it is to keep.
   */
  const keepGapCurrent = (measured?: ChatScrollGeometry) => {
    const el = messagesContainer.value
    if (!el || shouldAutoScroll || fingerDown) return
    const height = measured?.clientHeight ?? el.clientHeight
    if (boxHeight !== null && height !== boxHeight) return
    bottomGap =
      (measured?.scrollHeight ?? el.scrollHeight) - (measured?.scrollTop ?? el.scrollTop) - height
  }

  let observedContainer: HTMLElement | null = null
  const onNativeScrollEnd = () => {
    if (!nativeScrolling) return
    // Consume any last compositor position before returning to a stationary hold.
    onMessagesScroll()
    nativeScrolling = false
    endSteady(messagesContainer.value)
    if (!fingerDown && isStreaming.value) steadyReader()
  }
  const observe = (el: HTMLElement) => {
    observedContainer = el
    followedHeight = null
    el.addEventListener('scrollend', onNativeScrollEnd)
    let mutationQueued = false
    const measureMutation = () => {
      // Hidden under the opened composer; it is put right when the composer closes.
      if (composing.value || observedContainer !== el) return
      // A message that has just rendered its markdown changes the subtree and the layout
      // with it — which is exactly when the anchor needs putting back.
      anchors.holdLayout(keepGapCurrent)
      doScroll()
      // Floor removal is the last layout write above. Edge discovery belongs to
      // the next frame, when the browser has laid out that write, not this microtask.
      scheduleReveal(el)
    }
    mutObserver = new MutationObserver(() => {
      // Register new hosts immediately so their first layout can report a resize
      // even when the batched geometry pass has not run yet. This reads no layout.
      observeMessageSizes(el)
      // Following is a viewport destination, just like a held anchor. Leaving
      // one line of rendered growth unfollowed until rAF lets native input start
      // from a stale end; the later follow then consumes part of that gesture.
      // Settle on Vue's tick, without the extra holdLayout range measurement.
      // Once input takes ownership, unanchored mutations remain frame-batched.
      if (shouldAutoScroll && !composing.value) {
        doScroll()
      }
      // Page swaps and reading holds need correction before native clamping can
      // become a scroll event. Ordinary markdown mutations have no such hold:
      // batch them at the frame boundary instead of forcing layout after every
      // renderer microtask while the reader scrolls.
      if (anchors.anchor || anchors.keepingReader) {
        measureMutation()
        return
      }
      if (mutationQueued) return
      mutationQueued = true
      anchors.nextFrame(el.win, () => {
        mutationQueued = false
        measureMutation()
      })
    })
    mutObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['open'],
    })
    boxHeight = null
    // The box itself stays the same size when an image loads, a tool row expands or
    // markdown finishes laying out. Watch the mounted messages too, including new ones
    // as the render window moves, so following does not wait for another stream chunk.
    sizeObserver = new ResizeObserver(() => {
      if (composing.value) return
      // A resize can report layout after the browser has already adjusted its scroll
      // anchor. Reapplying the reader's anchor here can compensate the same growth
      // twice. Keep reader holds on their existing mutation/frame path; this observer
      // only updates the gap and follows the end (or handles an actual box resize).
      keepGapCurrent()
      onBoxResized()
      scheduleReveal(el)
    })
    sizeObserver.observe(el)
    observeMessageSizes(el)
    anchors.nextFrame(el.win, () => {
      if (observedContainer === el) revealUntilScrollable()
    })
  }

  let revealQueued = false
  const scheduleReveal = (el: HTMLElement) => {
    if (revealQueued) return
    revealQueued = true
    anchors.nextFrame(el.win, () => {
      revealQueued = false
      if (messagesContainer.value !== el) return
      if (
        !revealing &&
        !readingFromMarker &&
        trimRenderWindow(beginPageChange, readerDirection < 0 ? 'older' : 'newer')
      ) {
        revealing = true
        void nextTick(() => {
          holdAnchorAWhile(el)
          anchors.nextFrame(el.win, () => finishReveal(readerDirection < 0 ? 'older' : 'newer'))
        })
      } else revealUntilScrollable()
    })
  }

  const unobserve = () => {
    cancelIdlePrefetch()
    observedContainer?.removeEventListener('scrollend', onNativeScrollEnd)
    observedContainer = null
    nativeScrolling = false
    mutObserver?.disconnect()
    mutObserver = null
    sizeObserver?.disconnect()
    sizeObserver = null
    observedMessages.clear()
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
    leaveMarker()
    const box = messagesContainer.value
    if (!box) return
    shouldAutoScroll = false
    anchors.anchor = { el, offset }
    anchors.holdLayout(({ scrollHeight, scrollTop, clientHeight }) => {
      bottomGap = scrollHeight - scrollTop - clientHeight
    })
    holdAnchorAWhile(box)
  }

  return {
    hasNewer,
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
