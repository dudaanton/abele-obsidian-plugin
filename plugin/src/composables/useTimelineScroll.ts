import { nextTick, onScopeDispose, watch, type Ref } from 'vue'

/** The sidebar owns its scroll; under a note the very same list belongs to the editor's scroll. */
export function timelineScrollOwner(el: HTMLElement): HTMLElement {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return el.parentElement ?? el
}

/** The usable top of a phone pane is below its status bar and floating navigation. */
export function timelinePinnedTop(owner: HTMLElement): number {
  const viewport = owner.getBoundingClientRect()
  const top = viewport.top
  const body = owner.ownerDocument.body
  if (!body.classList.contains('is-phone')) return top
  const bodyStyle = getComputedStyle(body)
  const safe = parseFloat(bodyStyle.getPropertyValue('--safe-area-inset-top')) || 0
  // Native navigation retains its tap region when the visual header collapses on a pan.
  const nativeHeader = parseFloat(bodyStyle.getPropertyValue('--view-header-height')) || 0
  // Phone navigation can float outside its scroll leaf, and its controls can overflow a
  // zero-height wrapper. Measure rendered chrome overlapping this pane, not just its header.
  const chromeBottom = Math.max(
    0,
    ...Array.from(body.querySelectorAll('.view-header')).flatMap((header) =>
      [header, ...Array.from(header.querySelectorAll('*'))].map((el) => {
        const box = el.getBoundingClientRect()
        return box.width &&
          box.height &&
          box.right > viewport.left &&
          box.left < viewport.right &&
          box.bottom > viewport.top &&
          box.top < viewport.bottom
          ? box.bottom
          : 0
      })
    )
  )
  return Math.max(top, safe + nativeHeader, chromeBottom)
}

export interface TimelineAnchor {
  key: string
  day: string
  top: number
}

/** Holds a surviving row through layout patches. All scrolling stays native. */
export function useTimelineScroll(
  items: Ref<HTMLElement | null>,
  history: Ref<HTMLElement | null>,
  anchorSpace: Ref<HTMLElement | null>,
  windowSource: () => unknown,
  survives?: (key: string, day: string | null) => boolean,
  requestedAnchor?: () => TimelineAnchor | null,
  dragging: () => boolean = () => false
) {
  let stopHolding = () => {}
  let realignDrop: (() => void) | null = null
  let disposeInput = () => {}
  let alignedScroll: { owner: HTMLElement; top: number } | null = null

  let leadingSpace = 0
  let releaseLeadingOnScroll = false
  let restoringDrag: number | null = null
  let layoutGeneration = 0
  let disposed = false
  const invalidateRestoration = () => {
    layoutGeneration++
    restoringDrag = null
  }
  watch([items, anchorSpace], invalidateRestoration, { flush: 'sync' })
  // Cancellation is a rollback, not a drop anchor. Snapshot only this scroll owner's
  // layout so a temporary month cannot leave leading/trailing compensation behind.
  const captureDragLayout = () => {
    stopHolding()
    const root = items.value
    if (!root) return async () => {}
    const owner = timelineScrollOwner(root)
    const space = anchorSpace.value
    invalidateRestoration()
    const generation = layoutGeneration
    const ownsLayout = () =>
      !disposed &&
      generation === layoutGeneration &&
      items.value === root &&
      anchorSpace.value === space &&
      root.isConnected &&
      owner.isConnected &&
      owner.contains(root) &&
      timelineScrollOwner(root) === owner &&
      (!space || (space.isConnected && owner.contains(space)))
    const before = {
      top: owner.scrollTop,
      padding: root.style.paddingTop,
      height: space?.style.height ?? '',
      leading: leadingSpace,
      releaseLeading: releaseLeadingOnScroll,
    }
    return async () => {
      if (!ownsLayout()) return
      restoringDrag = generation
      stopHolding()
      try {
        await nextTick()
        // Disposal or a newer snapshot may have handed the editor back to its reader.
        // Check ownership after the patch, before touching any styles or bookkeeping.
        if (!ownsLayout() || restoringDrag !== generation) return
        root.style.paddingTop = before.padding
        if (space) space.style.height = before.height
        leadingSpace = before.leading
        releaseLeadingOnScroll = before.releaseLeading
        owner.scrollTop = before.top
        alignedScroll = { owner, top: owner.scrollTop }
      } finally {
        if (restoringDrag === generation) restoringDrag = null
      }
    }
  }
  const releaseSpace = () => anchorSpace.value?.style.removeProperty('height')
  const releaseUnusedSpace = (owner: HTMLElement) => {
    if (releaseLeadingOnScroll && !dragging() && leadingSpace && owner.scrollTop >= leadingSpace) {
      const top = owner.scrollTop - leadingSpace
      items.value?.style.removeProperty('padding-top')
      leadingSpace = 0
      owner.scrollTop = top
      alignedScroll = { owner, top: owner.scrollTop }
    }
    const space = anchorSpace.value
    if (!space?.style.height) return
    const naturalEnd = Math.max(0, owner.scrollHeight - owner.clientHeight - space.offsetHeight)
    // This room is only for a short list's completed toggle or insertion, never for input.
    // Give it back as soon as the reader returns to the natural scroll range.
    if (owner.scrollTop <= naturalEnd + 0.5) releaseSpace()
  }

  const placeScroll = (owner: HTMLElement, to: number, allowLeading = false) => {
    const before = owner.scrollTop
    const space = anchorSpace.value
    if (space) space.style.removeProperty('height')
    const clamped = owner.scrollTop
    if (allowLeading && to < 0 && items.value) {
      // A moved row can become the first row. Native scroll cannot go negative: retain
      // just enough leading room to keep that row at the finger's release position.
      leadingSpace += -to
      releaseLeadingOnScroll = false
      items.value.style.paddingTop = `${leadingSpace}px`
      to = 0
    }
    owner.scrollTop = Math.max(0, to)
    if (space && owner.scrollTop < to - 0.5) {
      // A short list otherwise has no scroll range with which to compensate for an insertion.
      // Temporarily exceed the viewport, measure the real range, then keep only the missing
      // space. This handles minimum-height scroll owners without guessing their gap.
      const offered = owner.clientHeight + to - owner.scrollTop
      space.style.height = `${offered}px`
      const excess = Math.max(0, owner.scrollHeight - owner.clientHeight - to)
      space.style.height = `${Math.max(0, offered - excess)}px`
      owner.scrollTop = to
    }
    // Scroll events arrive asynchronously and can coalesce several alignments. Only the
    // final position we actually wrote belongs to this hold, not a later reader movement.
    if (owner.scrollTop !== before || clamped !== before)
      alignedScroll = { owner, top: owner.scrollTop }
  }

  const hold = () => {
    stopHolding()
    const root = items.value
    if (!root) return () => {}
    const owner = timelineScrollOwner(root)
    const viewport = owner.getBoundingClientRect()
    const top = timelinePinnedTop(owner) + (history.value?.getBoundingClientRect().height ?? 0)
    const requested = requestedAnchor?.()
    // Prefer an unfinished row: it survives both directions of the completed toggle.
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-timeline-item]'))
    const dayOf = (el: HTMLElement) =>
      el.closest('.abele-timeline__date-block')?.getAttribute('data-abele-anchor') ?? null
    const retained = candidates.filter(
      (el) => !survives || survives(el.dataset.timelineItem!, dayOf(el))
    )
    const visibleRow = (rows: HTMLElement[]) =>
      rows.find((el) => {
        const box = el.getBoundingClientRect()
        return (
          box.top >= top &&
          box.top < viewport.bottom &&
          !el.querySelector<HTMLInputElement>('input:checked')
        )
      }) ??
      rows.find((el) => {
        const box = el.getBoundingClientRect()
        return box.bottom > top && box.top < viewport.bottom
      })
    const read = visibleRow(candidates)
    // Prefer a surviving visible row at its own offset. If the whole read region is
    // removed (hidden history), bring the nearest remaining row to that read position.
    // Never move a note when its timeline is entirely outside the viewport.
    const visibleRetained = visibleRow(retained)
    const readTop = read?.getBoundingClientRect().top
    const row =
      visibleRetained ??
      (read &&
        retained.reduce<HTMLElement | undefined>(
          (nearest, el) =>
            !nearest ||
            Math.abs(el.getBoundingClientRect().top - readTop!) <
              Math.abs(nearest.getBoundingClientRect().top - readTop!)
              ? el
              : nearest,
          undefined
        ))
    if (!row && !requested) return () => (read ? releaseSpace() : releaseUnusedSpace(owner))
    const key = requested?.key ?? row.dataset.timelineItem
    const day = requested ? 'date:' + requested.day : dayOf(row)
    const offset = requested
      ? requested.top - viewport.top
      : (visibleRetained ? row.getBoundingClientRect().top : readTop!) - viewport.top
    // Let this hold be the only layout anchor. Otherwise browser anchoring can write its
    // own scrollTop during late title rendering and look like external input to our guard.
    const browserAnchor = owner.style.getPropertyValue('overflow-anchor')
    const browserAnchorPriority = owner.style.getPropertyPriority('overflow-anchor')
    const browserAnchoring = getComputedStyle(owner).overflowAnchor !== 'none'
    const alreadyHeld = owner.classList.contains('abele-timeline__scroll-hold')
    owner.style.removeProperty('overflow-anchor')
    owner.classList.add('abele-timeline__scroll-hold')
    let heldTop = owner.scrollTop
    // A shrinking patch can clamp scrollTop before nextTick aligns the surviving row.
    // Reserve range only across that patch; align replaces it with the exact needed room.
    // An editor which already owns anchoring also owns its patch-time scroll range.
    // Reserving extra range there would trigger its deferred viewport restoration.
    // WebKit may not expose overflow-anchor at all. The editor still owns its range.
    const space = browserAnchoring && !owner.matches('.cm-scroller') ? anchorSpace.value : null
    const previousSpace = space?.style.height ?? ''
    let patchSpace = !!space
    if (space)
      space.style.height = `${Math.max(space.offsetHeight, owner.clientHeight + heldTop)}px`
    let live = true
    let timeout = 0
    const extend = () => {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(() => stopHolding(), 800)
    }
    const align = () => {
      if (!live || !items.value) return
      // Native scrolling can move before its scroll event is delivered. A resize callback
      // or queued nextTick must not mistake that movement for a layout insertion.
      if (Math.abs(owner.scrollTop - heldTop) > 0.5 && (!requested || dragging())) {
        stopHolding()
        return
      }
      extend()
      const target = Array.from(
        items.value.querySelectorAll<HTMLElement>('[data-timeline-item]')
      ).find((el) => el.dataset.timelineItem === key && dayOf(el) === day)
      if (target) {
        const shift =
          target.getBoundingClientRect().top -
          (requested ? requested.top : owner.getBoundingClientRect().top + offset)
        if (patchSpace || Math.abs(shift) > 0.5) {
          patchSpace = false
          placeScroll(owner, owner.scrollTop + shift, !!requested)
          heldTop = owner.scrollTop
        }
      } else {
        patchSpace = false
        releaseSpace()
        stopHolding()
      }
    }
    // Markdown titles load after the Vue patch. Correct their layout before it is painted too.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(align)
    observer?.observe(root)
    if (requested) observer?.observe(owner)
    const frame = window.requestAnimationFrame(align)
    extend()
    stopHolding = () => {
      if (!live) return
      live = false
      if (realignDrop === align) realignDrop = null
      if (patchSpace && space) {
        if (previousSpace) space.style.height = previousSpace
        else space.style.removeProperty('height')
        patchSpace = false
      }
      if (!alreadyHeld) owner.classList.remove('abele-timeline__scroll-hold')
      if (browserAnchor)
        owner.style.setProperty('overflow-anchor', browserAnchor, browserAnchorPriority)
      else owner.style.removeProperty('overflow-anchor')
      observer?.disconnect()
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
    realignDrop = requested ? align : null
    return align
  }

  watch(
    () => (items.value ? windowSource() : null),
    () => {
      if (restoringDrag !== null) return
      const align = hold()
      void nextTick(align)
    },
    { flush: 'pre' }
  )

  watch(
    [items, history],
    ([root, strip]) => {
      disposeInput()
      if (!root) {
        stopHolding()
        releaseSpace()
        return
      }
      const owner = timelineScrollOwner(root)
      // Sticky positioning starts at the padding edge. Place only this new strip at the
      // usable viewport edge, leaving the sidebar/editor spacing and phone chrome untouched.
      const positionStrip = () => {
        if (!strip) return
        const usable = timelinePinnedTop(owner)
        let inset =
          usable -
          owner.getBoundingClientRect().top -
          parseFloat(getComputedStyle(owner).paddingTop || '0')
        strip.style.setProperty('--abele-timeline-sticky-top', `${inset}px`)
        // Native editor panes can change their sticky origin as navigation opens. Verify
        // the pinned strip itself instead of treating owner padding as a universal origin.
        const box = strip.getBoundingClientRect()
        if (
          box.height &&
          box.top < usable - 0.5 &&
          root.getBoundingClientRect().bottom > usable + box.height
        ) {
          inset += usable - box.top
          strip.style.setProperty('--abele-timeline-sticky-top', `${inset}px`)
        }
      }
      positionStrip()
      let positionFrame = 0
      let followUntil = 0
      const followFrame = () => {
        positionStrip()
        positionFrame =
          performance.now() < followUntil ? window.requestAnimationFrame(followFrame) : 0
      }
      const followChrome = () => {
        if (!strip) return
        positionStrip()
        // Native navigation also moves via JS transforms, without resize/transitionend.
        // Follow only its finite settling interval, never keep a permanent animation loop.
        followUntil = performance.now() + 500
        if (!positionFrame) positionFrame = window.requestAnimationFrame(followFrame)
      }
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(followChrome)
      resize?.observe(owner)
      const chrome = owner.closest('.workspace-leaf')
      for (const header of Array.from(owner.ownerDocument.querySelectorAll('.view-header')))
        resize?.observe(header)
      chrome?.addEventListener('transitionend', followChrome)
      const scroll = () => {
        const own =
          alignedScroll?.owner === owner && Math.abs(owner.scrollTop - alignedScroll.top) < 0.5
        alignedScroll = null
        if (!own) {
          // WebKit can restore its pre-collapse scroll asynchronously after touchend.
          // An explicit drop anchor wins until new reader input releases the short hold.
          // During dragging, real scrolling (including edge scrolling) still wins.
          if (realignDrop && !dragging()) realignDrop()
          else stopHolding()
        }
        followChrome()
        releaseUnusedSpace(owner)
      }
      // Input only releases a pending layout hold. No gesture ownership, prevention,
      // history reveal, synthetic displacement or extra scroll room on any input path.
      const releaseHold = () => {
        // Owned drag movement is not a native pan. Keep the expansion's layout hold;
        // actual scroll events (including edge auto-scroll) still release it normally.
        if (dragging()) return
        releaseLeadingOnScroll = true
        alignedScroll = null
        stopHolding()
      }
      owner.addEventListener('wheel', releaseHold, { passive: true })
      owner.addEventListener('touchstart', releaseHold, { passive: true })
      owner.addEventListener('touchmove', releaseHold, { passive: true })
      owner.addEventListener('keydown', releaseHold)
      owner.addEventListener('pointerdown', releaseHold, { passive: true })
      owner.addEventListener('scroll', scroll, { passive: true })
      disposeInput = () => {
        resize?.disconnect()
        chrome?.removeEventListener('transitionend', followChrome)
        window.cancelAnimationFrame(positionFrame)
        owner.removeEventListener('wheel', releaseHold)
        owner.removeEventListener('touchstart', releaseHold)
        owner.removeEventListener('touchmove', releaseHold)
        owner.removeEventListener('keydown', releaseHold)
        owner.removeEventListener('pointerdown', releaseHold)
        owner.removeEventListener('scroll', scroll)
      }
    },
    { flush: 'post' }
  )
  onScopeDispose(() => {
    disposed = true
    invalidateRestoration()
    disposeInput()
    stopHolding()
    releaseSpace()
    items.value?.style.removeProperty('padding-top')
  })
  return { captureDragLayout }
}
