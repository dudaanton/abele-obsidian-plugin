import { onUnmounted, type Ref } from 'vue'

/** How far the anchor sits below the top of the scroll container. Negative when above it. */
export const offsetOf = (el: HTMLElement, container: HTMLElement) =>
  el.getBoundingClientRect().top - container.getBoundingClientRect().top

export interface ChatScrollGeometry {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

interface ChatScrollAnchorsOptions {
  messagesContainer: Ref<HTMLElement | null>
  scrollContainerTo: (
    el: HTMLElement,
    top: number,
    reason: string,
    measured?: ChatScrollGeometry
  ) => void
  shouldAutoScroll: () => boolean
  isStreaming?: () => boolean
  isReaderScrolling?: () => boolean
  messageAnchorIds?: (el: HTMLElement) => string[]
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
  let anchor: { el: HTMLElement; offset: number; at?: number; ids?: string[] } | null = null
  let pageChangePending = false

  /** Takes the topmost rendered message as the anchor: the page is revealed above it. */
  const captureAnchor = () => {
    const container = messagesContainer.value
    if (!container) {
      anchor = null
      return
    }
    const top = container.getBoundingClientRect().top
    anchor = null
    const candidates = container.querySelectorAll<HTMLElement>(
      '.abele-chat-msg, .abele-chat-run.is-collapsed'
    )
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i]
      const rect = el.getBoundingClientRect()
      const candidate = { el, offset: rect.top - top }
      anchor ??= candidate
      if (rect.bottom > top) {
        anchor = candidate
        break
      }
    }
    if (container && anchor) {
      anchor.ids = options.messageAnchorIds?.(anchor.el) ?? [anchor.el.dataset.messageId ?? '']
      anchor.at = anchor.offset + container.scrollTop
      const height = container.scrollHeight
      container.classList.add('abele-ai-chat__messages_steady')
      holdFloor(container, height)
    }
  }

  /** Puts the anchor back where it was, whatever has grown around it since. */
  const measureAnchor = (layout: Layout) => {
    if (!anchor) return
    if (!anchor.el.isConnected) {
      const ids = anchor.ids ?? []
      const replacement = Array.from(
        messagesContainer.value?.querySelectorAll<HTMLElement>('[data-message-id]') ?? []
      ).find(
        (el) =>
          (ids.includes(el.dataset.messageId ?? '') ||
            el.dataset.runIds?.split(' ').some((id) => ids.includes(id))) &&
          el.getClientRects().length
      )
      if (!replacement) return // The replacement host may mount on a later render tick.
      anchor.el = replacement
      console.debug('[chat-scroll] resolved page anchor', { ids })
    }

    // Compensate layout alone. Compositor movement since capture is reader input,
    // and must survive a page swap even before its scroll event reaches the listener.
    const offset = layout.offset(anchor.el)
    const at = offset + layout.before.scrollTop
    const drift = anchor.at === undefined ? offset - anchor.offset : at - anchor.at
    anchor.at = at
    if (Math.abs(drift) >= 1) layout.correct(drift, 'message-anchor')
    layout.releaseFloor = true
  }
  const holdAnchor = () => {
    if (anchor) holdLayout(undefined, 'anchor')
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
      win.cancelAnimationFrame(frame)
      win.clearTimeout(timer)
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
    const held = anchor
    const hold = () => {
      if (!held || anchor !== held) return
      holdAnchor()
      if (win.performance.now() < until) nextFrame(win, hold)
      else {
        anchor = null
        if (!steady) el.classList.remove('abele-ai-chat__messages_steady')
      }
    }
    nextFrame(win, hold)
  }

  /**
   * The reader's place while the conversation changes under it — a reply ending and becoming a
   * message, a tool call arriving, a message taking the place of another — for a reader who is
   * not following the end.
   *
   * Kept as the block at the top of the box, a paragraph or a chart of a message, and where it
   * sits in the box. Only its remaining visual drift is taken back out of the scroll, including
   * any layout scroll the browser already applied. Reader input releases the hold before the
   * next reading position is measured, so that scrolling is never fought.
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
  interface BlockKey {
    root: HTMLElement
    index: number
    tag: string
    text: string
    rootIndex: number
    rootCount: number
    messageId?: string
    streamingHost: HTMLElement | null
    precedingIds: Set<string | undefined>
  }
  let steady: {
    el: HTMLElement
    key: BlockKey | null
    offset: number
    scrollTop: number
    until: number
    waiting?: boolean
  } | null = null

  const blockKey = (el: HTMLElement, container: HTMLElement): BlockKey | null => {
    const root = el.parentElement
    if (!root?.classList.contains('abele-markdown')) return null
    const host = el.closest<HTMLElement>('[data-message-id], .abele-ai-chat__streaming')
    const roots = Array.from(host?.querySelectorAll<HTMLElement>('.abele-markdown') ?? [])
    return {
      root,
      index: Array.from(root.children).indexOf(el),
      tag: el.tagName,
      text: el.textContent ?? '',
      rootIndex: roots.indexOf(root),
      rootCount: roots.length,
      messageId: el.closest<HTMLElement>('[data-message-id]')?.dataset.messageId,
      streamingHost: el.closest<HTMLElement>('.abele-ai-chat__streaming'),
      precedingIds: new Set(
        Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]')).map(
          (message) => message.dataset.messageId
        )
      ),
    }
  }

  /** Re-rendered blocks keep their place within the same message, including stream handoff. */
  const resolveBlock = (key: BlockKey, container: HTMLElement): HTMLElement | null => {
    const roots: HTMLElement[] = []
    if (container.contains(key.root)) roots.push(key.root)
    const addRoot = (host: HTMLElement) => {
      const candidates = Array.from(host.querySelectorAll<HTMLElement>('.abele-markdown'))
      if (candidates.length === key.rootCount && key.rootIndex >= 0)
        roots.push(candidates[key.rootIndex])
    }
    for (const message of Array.from(
      container.querySelectorAll<HTMLElement>('[data-message-id]')
    )) {
      const id = message.dataset.messageId
      if (key.messageId ? id !== key.messageId : !key.streamingHost || key.precedingIds.has(id))
        continue
      if (!roots.length) addRoot(message)
    }
    if (
      !roots.length &&
      !key.messageId &&
      key.streamingHost &&
      container.contains(key.streamingHost)
    )
      addRoot(key.streamingHost)
    for (const root of roots) {
      const blocks = Array.from(root.children)
      const matches = (el: Element | undefined): el is HTMLElement =>
        !!el?.instanceOf(HTMLElement) &&
        el.tagName === key.tag &&
        !!key.text &&
        el.textContent === key.text
      const exact = blocks.filter(matches)
      // A short prefix (especially an empty paragraph) is not an identity.
      // Prefer an unambiguous exact match; only substantial streamed text can grow.
      const growing = blocks.filter(
        (el): el is HTMLElement =>
          el.instanceOf(HTMLElement) &&
          el.tagName === key.tag &&
          key.text.length >= 32 &&
          (el.textContent ?? '').startsWith(key.text)
      )
      const found = exact.length === 1 ? exact[0] : growing.length === 1 ? growing[0] : null
      if (!found) continue
      key.root = root
      key.messageId = found.closest<HTMLElement>('[data-message-id]')?.dataset.messageId
      return found
    }
    return null
  }

  /** The block at the top of the box: the first of a message's rendered blocks still in view. */
  const blockAtTop = (container: HTMLElement): HTMLElement | null => {
    const top = container.getBoundingClientRect().top
    const inView = (el: Element) => el.getBoundingClientRect().bottom > top + 1
    const item = Array.from(container.children).find(inView)
    if (!item?.instanceOf(HTMLElement)) return null
    const blocks = Array.from(item.querySelectorAll<HTMLElement>('.abele-markdown > *')).filter(
      (b) => b.getClientRects().length && inView(b)
    )
    // Prefer a block whose start the reader can see. The clipped chart or image above
    // it may still be laying out: holding that block's top does not hold the text below
    // its changing bottom. Fall back to the clipped block when it fills the viewport.
    return (
      blocks.find((b) => {
        const at = b.getBoundingClientRect().top
        return at >= top && at < top + container.clientHeight
      }) ??
      blocks[0] ??
      item
    )
  }

  const endSteady = (container?: HTMLElement | null) => {
    if (steady)
      console.debug('[chat-scroll] release reading anchor', { scrollTop: container?.scrollTop })
    steady = null
    if (!anchor) container?.classList.remove('abele-ai-chat__messages_steady')
  }

  /** Takes back out of the scroll whatever moved the block since it was last looked at. */
  const measureSteady = (container: HTMLElement, layout: Layout) => {
    if (!steady) return
    const end = () => {
      console.debug('[chat-scroll] release reading anchor', { scrollTop: layout.before.scrollTop })
      steady = null
      layout.clearClass = !anchor
    }
    if (options.shouldAutoScroll()) {
      end()
      return
    }
    if (options.isStreaming?.() && !options.shouldAutoScroll())
      steady.until = container.win.performance.now() + STEADY_MS
    if (container.win.performance.now() > steady.until) {
      console.debug('[chat-scroll] invalid reading anchor', {
        expired: true,
        streaming: options.isStreaming?.(),
      })
      end()
      return
    }
    const blockVisible = container.contains(steady.el) && steady.el.getClientRects().length > 0
    const alreadyHeld = blockVisible && Math.abs(layout.offset(steady.el) - steady.offset) < 1
    if (options.isReaderScrolling?.() && !alreadyHeld) {
      // Native movement is visible to geometry before its scroll event arrives.
      // Keep that movement, correcting only growth around the reading block.
      // A shorter range can clamp the old position; that part is layout, not input.
      // A host transfer can also adjust scrollTop while keeping the block exactly
      // in place. That is already compensated layout, even before scrollend arrives.
      const prior = Math.min(
        steady.scrollTop,
        Math.max(0, layout.before.scrollHeight - layout.before.clientHeight)
      )
      steady.offset -= layout.before.scrollTop - prior
    }
    if (!blockVisible) {
      const replacement = steady.key && resolveBlock(steady.key, container)
      if (!replacement?.getClientRects().length) {
        // Keep the original offset while the renderer's new host is still empty.
        // A transition watcher must not replace it with another visible paragraph.
        if (!steady.waiting)
          console.debug('[chat-scroll] waiting for reading block', { keyed: !!steady.key })
        steady.waiting = true
        return
      }
      steady.el = replacement
      steady.waiting = false
      console.debug('[chat-scroll] resolved reading block', {
        index: steady.key?.index,
        offset: layout.offset(replacement),
        wantedOffset: steady.offset,
      })
    }
    const { el } = steady
    // Measure the remaining visual drift. Layout may already have moved scrollTop
    // (for example during a host transfer); document-space growth would correct it twice.
    const moved = layout.offset(el) - steady.offset
    // Another hold is putting the reader back already — a page revealed above them.
    if (!anchor && Math.abs(moved) >= 1) layout.correct(moved, 'reading-block')
  }
  const holdSteady = () => {
    if (steady) holdLayout(undefined, 'steady')
  }

  interface Layout {
    before: ChatScrollGeometry
    offset: (el: HTMLElement) => number
    correct: (delta: number, reason: string) => void
    releaseFloor: boolean
    clearClass: boolean
  }

  /** Read the anchor and range together, then correct scroll before dropping its floor.
   * The consumer uses the predicted position for its gap; reading layout after removing
   * the inherited floor style would force a second layout of the freshly mounted page.
   * Rectangles live only for this pass: a resize or subsequent mutation gets fresh ones.
   */
  const holdLayout = (
    afterMeasure?: (geometry: ChatScrollGeometry) => void,
    mode: 'anchor' | 'steady' | 'both' = 'both'
  ) => {
    const container = messagesContainer.value
    if (!container) return
    const before: ChatScrollGeometry = {
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      // Reading the range can apply pending layout and clamp native scrollTop.
      // The anchor rectangle must use the position after that layout, too.
      scrollTop: container.scrollTop,
    }
    let top = before.scrollTop
    let reason: string | undefined
    let containerTop: number | undefined
    let measuredElement: HTMLElement | undefined
    let measuredOffset = 0
    const layout: Layout = {
      before,
      offset(el) {
        if (measuredElement !== el) {
          containerTop ??= container.getBoundingClientRect().top
          measuredOffset = el.getBoundingClientRect().top - containerTop
          measuredElement = el
        }
        return measuredOffset
      },
      correct(delta, why) {
        top = Math.max(
          0,
          Math.min(before.scrollTop + delta, before.scrollHeight - before.clientHeight)
        )
        reason = why
      },
      releaseFloor: false,
      clearClass: false,
    }
    if (mode !== 'steady') measureAnchor(layout)
    if (mode !== 'anchor') measureSteady(container, layout)
    afterMeasure?.({ ...before, scrollTop: top })
    // No geometry reads below this point. The floor must survive the scroll write:
    // WebKit can clamp synchronously when a page is evicted.
    if (reason) scrollContainerTo(container, top, reason, before)
    if (steady) steady.scrollTop = top
    if (layout.clearClass) container.classList.remove('abele-ai-chat__messages_steady')
    if (layout.releaseFloor) releaseFloor(container)
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
  let floorOwner = 0

  const releaseFloor = (container: HTMLElement) => {
    // Repeated holds after release must not rewrite class/style attributes: a
    // redundant class removal still invalidates style before the next geometry read.
    if (!container.classList.contains(FLOOR_CLASS)) return
    floorOwner++
    container.classList.remove(FLOOR_CLASS)
    container.style.removeProperty(FLOOR_VAR)
  }

  /** Where the content itself ends, below the top of the conversation, floor or no floor. */
  const contentEnd = (container: HTMLElement) => {
    const last = container.lastElementChild
    if (!last?.instanceOf(HTMLElement)) return 0
    const pad = parseFloat(container.win.getComputedStyle(container).paddingBottom) || 0
    return (
      last.getBoundingClientRect().bottom -
      container.getBoundingClientRect().top +
      container.scrollTop +
      pad
    )
  }

  const holdFloor = (container: HTMLElement, height = container.scrollHeight) => {
    const win = container.win
    const fresh = !container.classList.contains(FLOOR_CLASS)
    const floor = Math.max(height, parseFloat(container.style.getPropertyValue(FLOOR_VAR)) || 0)
    if (container.style.getPropertyValue(FLOOR_VAR) !== `${floor}px`)
      container.style.setProperty(FLOOR_VAR, `${floor}px`)
    if (fresh) container.classList.add(FLOOR_CLASS)
    floorUntil = win.performance.now() + STEADY_MS
    if (!fresh) return
    const owner = ++floorOwner
    const check = () => {
      if (owner !== floorOwner || !container.classList.contains(FLOOR_CLASS)) return
      // The page hold corrects scroll before releasing this floor. Do not let
      // this earlier frame callback release it (and dirty layout) ahead of that hold.
      if (anchor) {
        nextFrame(win, check)
        return
      }
      const want = parseFloat(container.style.getPropertyValue(FLOOR_VAR)) || 0
      // A chat left with no messages (a new one, or another opened in its place) has nothing
      // to hold a place in, and its floor would only scroll its greeting out of sight.
      if (
        closed ||
        win.performance.now() > floorUntil ||
        contentEnd(container) >= want - 1 ||
        !container.querySelector('.abele-chat-msg, .abele-chat-run')
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
    // Apply any layout still pending on the existing block before taking a new
    // measurement for a transition or reader scroll.
    holdSteady()
    if (steady) {
      holdFloor(container)
      steady.until = container.win.performance.now() + STEADY_MS
      return
    }
    const el = blockAtTop(container)
    const height = container.scrollHeight
    if (!el) {
      holdFloor(container, height)
      return
    }
    const win = container.win
    steady = {
      el,
      key: blockKey(el, container),
      offset: offsetOf(el, container),
      scrollTop: container.scrollTop,
      until: win.performance.now() + STEADY_MS,
    }
    console.debug('[chat-scroll] reading anchor', {
      tag: el.tagName,
      className: el.className,
      offset: steady.offset,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    })
    holdFloor(container, height)
    container.classList.add('abele-ai-chat__messages_steady')
    const held = steady
    const hold = () => {
      if (steady !== held) return
      holdSteady()
      if (steady) nextFrame(win, hold)
    }
    nextFrame(win, hold)
  }

  return {
    beginPageChange: () => {
      captureAnchor()
      pageChangePending = true
    },
    finishPageChange: () => {
      if (!pageChangePending) return
      // Vue has patched the range. Measure the surviving row now, before paint,
      // so the correction is the exact inserted/removed height above that row.
      holdAnchor()
      pageChangePending = false
    },
    releaseReader: () => {
      // Input can arrive between changing the range and patching its DOM. The
      // document-space anchor preserves that input while compensating the patch.
      // Dropping it (or its floor) here loses the pending removal's height.
      if (!pageChangePending) anchor = null
      const container = messagesContainer.value
      endSteady(container)
      if (container && !pageChangePending) releaseFloor(container)
    },
    captureAnchor,
    holdAnchor,
    holdLayout,
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
      messagesContainer.value?.classList.toggle(
        'abele-ai-chat__messages_steady',
        !!anchor || !!steady
      )
    },
  }
}
