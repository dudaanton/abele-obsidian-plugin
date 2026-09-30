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

/** Holds a visible row through insertions and completed toggles. All scrolling stays native. */
export function useTimelineScroll(
  items: Ref<HTMLElement | null>,
  history: Ref<HTMLElement | null>,
  anchorSpace: Ref<HTMLElement | null>,
  windowSource: () => unknown
) {
  let stopHolding = () => {}
  let disposeInput = () => {}

  const releaseSpace = () => anchorSpace.value?.style.removeProperty('height')
  const releaseUnusedSpace = (owner: HTMLElement) => {
    const space = anchorSpace.value
    if (!space?.style.height) return
    const naturalEnd = Math.max(0, owner.scrollHeight - owner.clientHeight - space.offsetHeight)
    // This room is only for a short list's completed toggle or insertion, never for input.
    // Give it back as soon as the reader returns to the natural scroll range.
    if (owner.scrollTop <= naturalEnd + 0.5) releaseSpace()
  }

  const placeScroll = (owner: HTMLElement, to: number) => {
    const space = anchorSpace.value
    if (space) space.style.removeProperty('height')
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
  }

  const hold = () => {
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
    const offset = row.getBoundingClientRect().top - viewport.top
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
        const shift =
          target.getBoundingClientRect().top - owner.getBoundingClientRect().top - offset
        if (Math.abs(shift) > 0.5) placeScroll(owner, owner.scrollTop + shift)
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
      const scroll = () => {
        followChrome()
        releaseUnusedSpace(owner)
      }
      // Input only releases a pending layout hold. No gesture ownership, prevention,
      // history reveal, synthetic displacement or extra scroll room on any input path.
      const releaseHold = () => stopHolding()
      owner.addEventListener('wheel', releaseHold, { passive: true })
      owner.addEventListener('touchstart', releaseHold, { passive: true })
      owner.addEventListener('keydown', releaseHold)
      owner.addEventListener('pointerdown', releaseHold, { passive: true })
      owner.addEventListener('scroll', scroll, { passive: true })
      disposeInput = () => {
        resize?.disconnect()
        window.cancelAnimationFrame(positionFrame)
        owner.removeEventListener('wheel', releaseHold)
        owner.removeEventListener('touchstart', releaseHold)
        owner.removeEventListener('keydown', releaseHold)
        owner.removeEventListener('pointerdown', releaseHold)
        owner.removeEventListener('scroll', scroll)
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
