import { onUnmounted, type Ref } from 'vue'

/** How far the anchor sits below the top of the scroll container. Negative when above it. */
export const offsetOf = (el: HTMLElement, container: HTMLElement) =>
  el.getBoundingClientRect().top - container.getBoundingClientRect().top

interface ChatScrollAnchorsOptions {
  messagesContainer: Ref<HTMLElement | null>
  scrollContainerTo: (el: HTMLElement, top: number) => void
  shouldAutoScroll: () => boolean
}

export function useChatScrollAnchors(options: ChatScrollAnchorsOptions) {
  const { messagesContainer, scrollContainerTo } = options
  /**
   * What the reader was looking at while older messages are being revealed above it.
   *
   * A message rather than a height. Reading the growth of `scrollHeight` once, on the tick
   * after the page is revealed, corrects for nothing: a message renders its markdown
   * asynchronously — `MarkdownRenderer.render` is awaited, and a re-render is queued behind a
   * timeout — so at that point the messages just mounted are still nearly empty, and their real
   * height arrives afterwards and shoves the view down. Holding one element still is immune to
   * that, however late and however often the heights change.
   */
  let anchor: { el: HTMLElement; offset: number } | null = null

  /** Takes the topmost rendered message as the anchor: the page is revealed above it. */
  const captureAnchor = () => {
    const container = messagesContainer.value
    const first = container?.querySelector<HTMLElement>('.abele-chat-msg')
    anchor = container && first ? { el: first, offset: offsetOf(first, container) } : null
  }

  /** Puts the anchor back where it was, whatever has grown around it since. */
  const holdAnchor = () => {
    const container = messagesContainer.value
    if (!container || !anchor) return
    if (!anchor.el.isConnected) {
      anchor = null
      return
    }

    const drift = offsetOf(anchor.el, container) - anchor.offset
    if (Math.abs(drift) < 1) return
    scrollContainerTo(container, container.scrollTop + drift)
  }

  /**
   * The next frame, or a moment later when no frame comes. A window behind others draws none, and
   * whatever waited for one there — a reveal, a hold — waited until Obsidian was brought forward.
   */
  const nextFrame = (win: Window, run: () => void) => {
    if (closed) return
    let done = false
    const once = () => {
      if (done) return
      done = true
      pendingFrames.delete(cancel)
      run()
    }
    const frame = win.requestAnimationFrame(once)
    const timer = win.setTimeout(once, 50)
    const cancel = () => {
      done = true
      win.cancelAnimationFrame(frame)
      win.clearTimeout(timer)
    }
    pendingFrames.add(cancel)
  }

  /**
   * Frames still asked for, so a chat that closes stops asking. A hold runs on for a moment and
   * would otherwise go on moving a container that is no longer on the page.
   */
  const pendingFrames = new Set<() => void>()
  let closed = false
  onUnmounted(() => {
    closed = true
    anchor = null
    for (const cancel of pendingFrames) cancel()
    pendingFrames.clear()
  })

  const ANCHOR_HOLD_MS = 1500

  /** Keeps the anchor where it is for as long as the messages around it take to render. */
  const holdAnchorAWhile = (el: HTMLElement) => {
    // The chat can be in a popped-out window, whose frames and clock are not the main one's.
    const win = el.win
    const until = win.performance.now() + ANCHOR_HOLD_MS
    const hold = () => {
      if (!anchor) return
      holdAnchor()
      if (win.performance.now() < until) nextFrame(win, hold)
      else anchor = null
    }
    nextFrame(win, hold)
  }

  /**
   * The reader's place while the conversation changes under it — a reply ending and becoming a
   * message, a tool call arriving, a message taking the place of another — for a reader who is
   * not following the end.
   *
   * Kept as the block at the top of the box, a paragraph or a chart of a message, and where it
   * sits in the conversation. Whatever moves that block up or down is layout, and is taken back
   * out of the scroll; the reader scrolling moves the box, not the block, so it is never fought.
   * That is what the browser's own scroll anchoring does too, and the two cannot both correct the
   * same change: the browser's is off for as long as this one holds.
   *
   * A reply that ended used to take the reader to the end of the chat. The message replacing it
   * started empty, the scroll range collapsed under the reader, the browser clamped them to the
   * new end, and a chat at its end follows it. The message now takes over what the reply drew
   * (`markdownParts.ts`), and this covers what still differs between the two: the reasoning
   * folded away, the message's own chrome.
   */
  const STEADY_MS = 1500
  let steady: { el: HTMLElement; at: number; until: number } | null = null

  /** Where an element sits in the conversation, whatever the scroll. */
  const placeOf = (el: HTMLElement, container: HTMLElement) =>
    offsetOf(el, container) + container.scrollTop

  /** The block at the top of the box: the first of a message's rendered blocks still in view. */
  const blockAtTop = (container: HTMLElement): HTMLElement | null => {
    const top = container.getBoundingClientRect().top
    const inView = (el: Element) => el.getBoundingClientRect().bottom > top + 1
    const item = Array.from(container.children).find(inView)
    if (!item?.instanceOf(HTMLElement)) return null
    const blocks = item.querySelectorAll<HTMLElement>('.abele-markdown > *')
    return Array.from(blocks).find((b) => b.getClientRects().length && inView(b)) ?? item
  }

  const endSteady = (container?: HTMLElement | null) => {
    steady = null
    container?.classList.remove('abele-ai-chat__messages_steady')
  }

  /** Takes back out of the scroll whatever moved the block since it was last looked at. */
  const holdSteady = () => {
    const container = messagesContainer.value
    if (!container || !steady) return
    const { el } = steady
    if (
      !el.isConnected ||
      !el.getClientRects().length ||
      container.win.performance.now() > steady.until
    ) {
      endSteady(container)
      return
    }
    const at = placeOf(el, container)
    const moved = at - steady.at
    // Another hold is putting the reader back already — a page revealed above them.
    if (!anchor && Math.abs(moved) >= 1) scrollContainerTo(container, container.scrollTop + moved)
    steady.at = at
  }

  /**
   * The scroll range kept at least as long as it was before the page changed, until what changed
   * has drawn again.
   *
   * A reply that ends moves its text into the message that replaces it, and for a moment the
   * message is on the page with nothing drawn in it. WebKit, which a phone runs, clamps the scroll
   * position the moment anything reads the layout, and in that moment the conversation ends where
   * the reply began: a reader halfway down the reply was put there, on a short chat at its very
   * top, and nothing put them back. A desktop's browser clamps with the frame, when the text is
   * back, so it was seen on a phone only. A floor under the content, as tall as the content was,
   * leaves the browser nothing to clamp.
   */
  const FLOOR_CLASS = 'abele-ai-chat__messages_floor'
  const FLOOR_VAR = '--abele-chat-floor'
  let floorUntil = 0

  const releaseFloor = (container: HTMLElement) => {
    container.classList.remove(FLOOR_CLASS)
    container.style.removeProperty(FLOOR_VAR)
  }

  /** Where the content itself ends, below the top of the conversation, floor or no floor. */
  const contentEnd = (container: HTMLElement) => {
    const last = container.lastElementChild
    if (!last?.instanceOf(HTMLElement)) return 0
    const pad = parseFloat(container.win.getComputedStyle(container).paddingBottom) || 0
    return placeOf(last, container) + last.getBoundingClientRect().height + pad
  }

  const holdFloor = (container: HTMLElement) => {
    const win = container.win
    const fresh = !container.classList.contains(FLOOR_CLASS)
    const floor = Math.max(
      container.scrollHeight,
      parseFloat(container.style.getPropertyValue(FLOOR_VAR)) || 0
    )
    container.style.setProperty(FLOOR_VAR, `${floor}px`)
    container.classList.add(FLOOR_CLASS)
    floorUntil = win.performance.now() + STEADY_MS
    if (!fresh) return
    const check = () => {
      if (!container.classList.contains(FLOOR_CLASS)) return
      const want = parseFloat(container.style.getPropertyValue(FLOOR_VAR)) || 0
      // A chat left with no messages (a new one, or another opened in its place) has nothing
      // to hold a place in, and its floor would only scroll its greeting out of sight.
      if (
        closed ||
        win.performance.now() > floorUntil ||
        contentEnd(container) >= want - 1 ||
        !container.querySelector('.abele-chat-msg')
      )
        releaseFloor(container)
      else nextFrame(win, check)
    }
    nextFrame(win, check)
  }

  /** Starts holding the reader's place, from before the change about to happen to the page. */
  const steadyReader = () => {
    const container = messagesContainer.value
    if (!container || options.shouldAutoScroll() || closed) return
    holdFloor(container)
    const el = blockAtTop(container)
    if (!el) return
    const win = container.win
    const fresh = !steady
    steady = { el, at: placeOf(el, container), until: win.performance.now() + STEADY_MS }
    container.classList.add('abele-ai-chat__messages_steady')
    if (!fresh) return
    const hold = () => {
      if (!steady) return
      holdSteady()
      if (steady) nextFrame(win, hold)
    }
    nextFrame(win, hold)
  }

  return {
    captureAnchor,
    holdAnchor,
    holdAnchorAWhile,
    nextFrame,
    steadyReader,
    holdSteady,
    endSteady,
    get keepingReader() {
      return !!steady
    },
    get closed() {
      return closed
    },
    get anchor() {
      return anchor
    },
    set anchor(value) {
      anchor = value
    },
  }
}
