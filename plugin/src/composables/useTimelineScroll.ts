import { nextTick, onScopeDispose, watch, type Ref } from 'vue'

/** The sidebar owns its scroll; under a note the very same list belongs to the editor's scroll. */
function scrollOwner(el: HTMLElement): HTMLElement {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return el.parentElement ?? el
}

/** Keeps an existing row on screen as the window changes; upward input unfolds one earlier day. */
export function useTimelineScroll(
  items: Ref<HTMLElement | null>,
  history: Ref<HTMLElement | null>,
  windowSource: () => unknown,
  revealPrevious: () => void
) {
  let stopHolding = () => {}
  let disposeInput = () => {}
  let inserting = false
  let alignedTop: number | null = null

  const hold = (moveDown = 0) => {
    stopHolding()
    const root = items.value
    if (!root) return () => {}
    const owner = scrollOwner(root)
    const viewport = owner.getBoundingClientRect()
    const top = viewport.top + (history.value?.getBoundingClientRect().height ?? 0)
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
      }) ?? candidates.find((el) => el.getBoundingClientRect().bottom > top)
    if (!row) return () => {}
    const key = row.dataset.timelineItem
    const day = row.closest('.abele-timeline__date-block')?.getAttribute('data-abele-anchor')
    const offset = row.getBoundingClientRect().top - viewport.top + moveDown
    let live = true
    const align = () => {
      if (!live || !items.value) return
      const target = Array.from(
        items.value.querySelectorAll<HTMLElement>('[data-timeline-item]')
      ).find(
        (el) =>
          el.dataset.timelineItem === key &&
          el.closest('.abele-timeline__date-block')?.getAttribute('data-abele-anchor') === day
      )
      if (target) {
        const shift =
          target.getBoundingClientRect().top - owner.getBoundingClientRect().top - offset
        if (Math.abs(shift) > 0.5) {
          owner.scrollTop += shift
          alignedTop = owner.scrollTop
        }
      }
    }
    // Markdown titles load after the Vue patch. Correct their layout before it is painted too.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(align)
    observer?.observe(root)
    const frame = window.requestAnimationFrame(align)
    const timeout = window.setTimeout(() => stopHolding(), 800)
    stopHolding = () => {
      live = false
      observer?.disconnect()
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
    return align
  }

  watch(
    windowSource,
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
        return
      }
      const owner = scrollOwner(root)
      // Sticky positioning starts at the scroll owner's padding edge. Cancel only that inset
      // for this new header; neither the sidebar nor the editor's existing spacing is changed.
      strip?.style.setProperty(
        '--abele-timeline-sticky-top',
        `${-parseFloat(getComputedStyle(owner).paddingTop || '0')}px`
      )
      const atBoundary = () => {
        if (!history.value) return false
        const top = owner.getBoundingClientRect().top
        const header = history.value.getBoundingClientRect()
        const first = root.firstElementChild?.getBoundingClientRect()
        const edge = first?.top ?? header.bottom
        return (
          header.bottom >= top &&
          edge >= top + header.height - 2 &&
          edge <= top + header.height + 120
        )
      }
      const unfold = async (amount: number) => {
        if (inserting || !atBoundary()) return false
        inserting = true
        // Move the old row down by exactly the input distance, not by the newly inserted
        // day's height. Keep holding through its lazy titles, which arrive after the patch.
        const hadRow = !!root.querySelector('[data-timeline-item]')
        const align = hold(amount)
        const oldHeight = root.getBoundingClientRect().height
        revealPrevious()
        await nextTick()
        align()
        if (!hadRow) {
          owner.scrollTop += root.getBoundingClientRect().height - oldHeight
          owner.scrollTop = Math.max(0, owner.scrollTop - amount)
        }
        previousTop = owner.scrollTop
        inserting = false
        return true
      }
      const wheel = (event: WheelEvent) => {
        stopHolding()
        if (event.ctrlKey || event.metaKey || event.deltaY >= 0 || !atBoundary()) return
        event.preventDefault()
        void unfold(Math.abs(event.deltaY))
      }
      let fingerY: number | null = null
      const touchStart = (event: TouchEvent) => {
        stopHolding()
        fingerY = event.touches.length === 1 ? event.touches[0].clientY : null
      }
      const touchMove = (event: TouchEvent) => {
        const y = event.touches.length === 1 ? event.touches[0].clientY : null
        const delta = y !== null && fingerY !== null ? y - fingerY : 0
        fingerY = y
        stopHolding()
        if (delta <= 0 || !atBoundary()) return
        event.preventDefault()
        void unfold(delta)
      }
      let previousTop = owner.scrollTop
      const scroll = () => {
        const delta = previousTop - owner.scrollTop
        previousTop = owner.scrollTop
        if (alignedTop !== null && Math.abs(owner.scrollTop - alignedTop) < 1) {
          alignedTop = null
          return
        }
        if (delta > 0 && !inserting && atBoundary()) void unfold(delta)
      }
      const key = (event: KeyboardEvent) => {
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
      const pointer = () => stopHolding()
      owner.addEventListener('wheel', wheel, { passive: false })
      owner.addEventListener('touchstart', touchStart, { passive: true })
      owner.addEventListener('touchmove', touchMove, { passive: false })
      owner.addEventListener('scroll', scroll, { passive: true })
      owner.addEventListener('keydown', key)
      owner.addEventListener('pointerdown', pointer)
      disposeInput = () => {
        owner.removeEventListener('wheel', wheel)
        owner.removeEventListener('touchstart', touchStart)
        owner.removeEventListener('touchmove', touchMove)
        owner.removeEventListener('scroll', scroll)
        owner.removeEventListener('keydown', key)
        owner.removeEventListener('pointerdown', pointer)
      }
    },
    { flush: 'post' }
  )
  onScopeDispose(() => {
    disposeInput()
    stopHolding()
  })
}
