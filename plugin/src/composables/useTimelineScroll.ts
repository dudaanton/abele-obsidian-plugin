import { nextTick, onScopeDispose, watch, type Ref } from 'vue'

/** The sidebar owns its scroll; under a note the very same list belongs to the editor's scroll. */
function scrollOwner(el: HTMLElement): HTMLElement {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return el.parentElement ?? el
}

/** The usable top of a phone pane is below its status bar and floating navigation. */
function pinnedTop(owner: HTMLElement): number {
  const top = owner.getBoundingClientRect().top
  const body = owner.ownerDocument.body
  if (!body.classList.contains('is-phone')) return top
  const safe = parseFloat(getComputedStyle(body).getPropertyValue('--safe-area-inset-top')) || 0
  const header = owner
    .closest('.workspace-leaf')
    ?.querySelector('.view-header')
    ?.getBoundingClientRect()
  return Math.max(top, safe, header?.height ? header.bottom : 0)
}

/** Keeps an existing row on screen as the window changes; upward input unfolds one earlier day. */
export function useTimelineScroll(
  items: Ref<HTMLElement | null>,
  history: Ref<HTMLElement | null>,
  anchorSpace: Ref<HTMLElement | null>,
  windowSource: () => unknown,
  revealPrevious: () => void
) {
  let stopHolding = () => {}
  let disposeInput = () => {}
  let inserting = false
  let alignedTop: number | null = null

  const releaseSpace = () => anchorSpace.value?.style.removeProperty('height')
  const releaseUnusedSpace = (owner: HTMLElement) => {
    const space = anchorSpace.value
    if (!space?.style.height) return
    const naturalEnd = Math.max(0, owner.scrollHeight - owner.clientHeight - space.offsetHeight)
    // Keep room while removing it would clamp a visible anchor. Give it back as soon as the
    // reader returns to the natural scroll range, including short owners at scrollTop zero.
    if (owner.scrollTop <= naturalEnd + 0.5) releaseSpace()
  }

  const placeScroll = (owner: HTMLElement, to: number) => {
    const space = anchorSpace.value
    if (space) space.style.removeProperty('height')
    owner.scrollTop = Math.max(0, to)
    if (space && owner.scrollTop < to - 0.5) {
      // A short list otherwise has no scroll range with which to compensate for an insertion.
      // Temporarily exceed the viewport, measure the real range, then keep only the missing
      // virtual space. This handles minimum-height scroll owners without guessing their gap.
      const offered = owner.clientHeight + to - owner.scrollTop
      space.style.height = `${offered}px`
      const excess = Math.max(0, owner.scrollHeight - owner.clientHeight - to)
      space.style.height = `${Math.max(0, offered - excess)}px`
      owner.scrollTop = to
    }
    alignedTop = owner.scrollTop
  }

  const hold = (moveDown: number | (() => number) = 0) => {
    stopHolding()
    const root = items.value
    if (!root) return () => {}
    const owner = scrollOwner(root)
    const viewport = owner.getBoundingClientRect()
    const top = pinnedTop(owner) + (history.value?.getBoundingClientRect().height ?? 0)
    // Prefer an unfinished row: it survives both directions of the completed toggle.
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-timeline-item]'))
    const row =
      candidates.find((el) => {
        const box = el.getBoundingClientRect()
        return (
          box.top >= top &&
          box.top < viewport.bottom &&
          !el.querySelector<HTMLInputElement>('input:checked')
        )
      }) ??
      candidates.find((el) => {
        const box = el.getBoundingClientRect()
        return box.bottom > top && box.top < viewport.bottom
      })
    if (!row) return () => releaseUnusedSpace(owner)
    const key = row.dataset.timelineItem
    const day = row.closest('.abele-timeline__date-block')?.getAttribute('data-abele-anchor')
    // Touch positions are client coordinates: a gesture's row follows the finger even if
    // native navigation changes the pane's top. Normal updates keep the pane-relative offset.
    const clientMotion = typeof moveDown === 'function'
    const offset = row.getBoundingClientRect().top - (clientMotion ? 0 : viewport.top)
    let live = true
    let timeout = 0
    const extend = () => {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(() => stopHolding(), 800)
    }
    const align = () => {
      if (!live || !items.value) return
      extend()
      const target = Array.from(
        items.value.querySelectorAll<HTMLElement>('[data-timeline-item]')
      ).find(
        (el) =>
          el.dataset.timelineItem === key &&
          el.closest('.abele-timeline__date-block')?.getAttribute('data-abele-anchor') === day
      )
      if (target) {
        const movement = typeof moveDown === 'function' ? moveDown() : moveDown
        const shift =
          target.getBoundingClientRect().top -
          (clientMotion ? 0 : owner.getBoundingClientRect().top) -
          offset -
          movement
        if (Math.abs(shift) > 0.5) {
          placeScroll(owner, owner.scrollTop + shift)
        }
      } else {
        releaseSpace()
        stopHolding()
      }
    }
    // Markdown titles load after the Vue patch. Correct their layout before it is painted too.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(align)
    observer?.observe(root)
    const frame = window.requestAnimationFrame(align)
    extend()
    stopHolding = () => {
      live = false
      observer?.disconnect()
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
    return align
  }

  watch(
    () => (items.value ? windowSource() : null),
    () => {
      if (inserting) return
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
      const owner = scrollOwner(root)
      // Sticky positioning starts at the padding edge. Place only this new strip at the
      // usable viewport edge, leaving the sidebar/editor spacing and phone chrome untouched.
      const positionStrip = () =>
        strip?.style.setProperty(
          '--abele-timeline-sticky-top',
          `${pinnedTop(owner) - owner.getBoundingClientRect().top - parseFloat(getComputedStyle(owner).paddingTop || '0')}px`
        )
      positionStrip()
      let positionFrame = 0
      const followChrome = () => {
        positionStrip()
        window.cancelAnimationFrame(positionFrame)
        positionFrame = window.requestAnimationFrame(positionStrip)
      }
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(followChrome)
      resize?.observe(owner)
      let inputInsideTimeline = false
      const atBoundary = () => {
        if (!history.value) return false
        const top = pinnedTop(owner)
        const header = history.value.getBoundingClientRect()
        // A short pane may have no scroll range at all (the calendar is still above it).
        // Upward input on its visible timeline can still open history; input on the calendar
        // must not do so. Once scrolling is possible, the normal upper boundary takes over.
        if (
          owner.scrollTop <= 1 &&
          inputInsideTimeline &&
          header.top >= top - 2 &&
          header.bottom <= owner.getBoundingClientRect().bottom
        )
          return true
        const first = root.firstElementChild?.getBoundingClientRect()
        const edge = first?.top ?? header.bottom
        return (
          header.bottom >= top &&
          edge >= top + header.height - 2 &&
          edge <= top + header.height + 120
        )
      }
      let upwardScroll = false
      const unfold = async (amount: number, motion?: { distance: number; align?: () => void }) => {
        if (inserting || !atBoundary()) return false
        inserting = true
        upwardScroll = false
        // Move the old row down by exactly the input distance, not by the newly inserted
        // day's height. Keep holding through its lazy titles, which arrive after the patch.
        const hadRow = !!root.querySelector('[data-timeline-item]')
        const align = hold(motion ? () => motion.distance : amount)
        if (motion) motion.align = align
        const oldHeight = root.getBoundingClientRect().height
        revealPrevious()
        await nextTick()
        align()
        if (!hadRow) {
          placeScroll(
            owner,
            owner.scrollTop + root.getBoundingClientRect().height - oldHeight - amount
          )
        }
        previousTop = owner.scrollTop
        inserting = false
        return true
      }
      const wheel = (event: WheelEvent) => {
        inputInsideTimeline = root.parentElement?.contains(event.target as Node) ?? false
        upwardScroll = event.deltaY < 0 && !event.ctrlKey && !event.metaKey
        stopHolding()
        if (event.ctrlKey || event.metaKey || event.deltaY >= 0 || !atBoundary()) return
        event.preventDefault()
        void unfold(Math.abs(event.deltaY))
      }
      let fingerY: number | null = null
      let touchHistory: { distance: number; align?: () => void } | null = null
      const touchStart = (event: TouchEvent) => {
        inputInsideTimeline = root.parentElement?.contains(event.target as Node) ?? false
        stopHolding()
        touchHistory = null
        fingerY = event.touches.length === 1 ? event.touches[0].clientY : null
      }
      const touchMove = (event: TouchEvent) => {
        const y = event.touches.length === 1 ? event.touches[0].clientY : null
        const delta = y !== null && fingerY !== null ? y - fingerY : 0
        fingerY = y
        upwardScroll = delta > 0
        if (touchHistory && y !== null) {
          // Once history consumed the first move, own the whole pan. Returning later moves
          // to native scrolling loses its touch slop and cancels the insertion's lazy hold.
          event.preventDefault()
          touchHistory.distance += delta
          touchHistory.align?.()
          return
        }
        stopHolding()
        touchHistory = null
        if (delta <= 0 || !atBoundary()) return
        event.preventDefault()
        touchHistory = { distance: delta }
        void unfold(delta, touchHistory)
      }
      const touchEnd = () => {
        fingerY = null
        touchHistory = null
        upwardScroll = false
      }
      let previousTop = owner.scrollTop
      const scroll = () => {
        followChrome()
        releaseUnusedSpace(owner)
        const delta = previousTop - owner.scrollTop
        previousTop = owner.scrollTop
        if (alignedTop !== null && Math.abs(owner.scrollTop - alignedTop) < 1) {
          alignedTop = null
          return
        }
        // Layout and native phone navigation also change scrollTop. Only upward input
        // may unfold history; an automatic correction is not a request for another day.
        if (upwardScroll && delta > 0 && !inserting && atBoundary()) void unfold(delta)
      }
      const key = (event: KeyboardEvent) => {
        inputInsideTimeline = root.parentElement?.contains(event.target as Node) ?? false
        upwardScroll = ['ArrowUp', 'PageUp'].includes(event.key)
        stopHolding()
        if (
          event.target instanceof HTMLElement &&
          event.target.matches('input, textarea, [contenteditable=true]')
        )
          return
        if (!['ArrowUp', 'PageUp'].includes(event.key) || !atBoundary()) return
        event.preventDefault()
        void unfold(event.key === 'PageUp' ? owner.clientHeight : 40)
      }
      const pointer = (event: PointerEvent) => {
        inputInsideTimeline = root.parentElement?.contains(event.target as Node) ?? false
        upwardScroll = event.target === owner
        stopHolding()
      }
      const drag = (event: PointerEvent) => {
        if (event.pointerType === 'mouse' && event.buttons && event.target === owner)
          upwardScroll = true
      }
      owner.addEventListener('wheel', wheel, { passive: false })
      owner.addEventListener('touchstart', touchStart, { passive: true })
      owner.addEventListener('touchmove', touchMove, { passive: false })
      owner.addEventListener('touchend', touchEnd, { passive: true })
      owner.addEventListener('touchcancel', touchEnd, { passive: true })
      owner.addEventListener('scroll', scroll, { passive: true })
      owner.addEventListener('keydown', key)
      owner.addEventListener('pointerdown', pointer)
      owner.addEventListener('pointermove', drag)
      disposeInput = () => {
        resize?.disconnect()
        window.cancelAnimationFrame(positionFrame)
        owner.removeEventListener('wheel', wheel)
        owner.removeEventListener('touchstart', touchStart)
        owner.removeEventListener('touchmove', touchMove)
        owner.removeEventListener('touchend', touchEnd)
        owner.removeEventListener('touchcancel', touchEnd)
        owner.removeEventListener('scroll', scroll)
        owner.removeEventListener('keydown', key)
        owner.removeEventListener('pointerdown', pointer)
        owner.removeEventListener('pointermove', drag)
      }
    },
    { flush: 'post' }
  )
  onScopeDispose(() => {
    disposeInput()
    stopHolding()
    releaseSpace()
  })
}
