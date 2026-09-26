/**
 * Keeps the editor where it is when the block under a note gets shorter.
 *
 * The footer is one block widget at the end of the document. When a search or a fold shrinks it
 * below what is scrolled past, the browser pulls the scroll back to the new end of the document.
 * CodeMirror then measures, finds itself "scrolled to the bottom" and keeps the bottom pinned by
 * scrolling up again by the whole drop in height (`EditorView.measure`, the `isScrolledToBottom`
 * anchor) — so the note landed at its top, the list searched far below.
 *
 * So when the block shrinks under the scroll, it keeps as much room below its content as the
 * scroll needs to stay put, plus a few pixels so CodeMirror never takes it for the bottom, and
 * the scroll goes back where it was. The room is given back as the user scrolls up past it.
 * It has to get there before CodeMirror measures, and CodeMirror measures in the next animation
 * frame after any change it notices, reading the scroll first — which lays the page out and
 * clamps it on the spot. So it runs from a MutationObserver on the content, a microtask after
 * Vue patches the list and before any frame; from a ResizeObserver, for what grows or shrinks
 * without a mutation (a picture loading); and from a capturing scroll listener on the editor,
 * which runs before CodeMirror's own on the scroller, for a clamp some other code forced.
 */

/** More than CodeMirror's 4 px tolerance for "scrolled to the bottom". */
export const BOTTOM_MARGIN = 8

export interface ScrollBox {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/**
 * The min-height the container needs after a shrink clamped the scroll, or null when the scroll
 * was not clamped by it: it moved up, it is now at the very end, and the container got shorter.
 */
export function heightToHold(
  box: ScrollBox,
  lastTop: number,
  containerHeight: number,
  lastContainerHeight: number
): number | null {
  const clamped =
    box.scrollTop < lastTop - 1 &&
    box.scrollTop + box.clientHeight >= box.scrollHeight - 1 &&
    containerHeight < lastContainerHeight - 1
  if (!clamped) return null
  return containerHeight + (lastTop + box.clientHeight + BOTTOM_MARGIN - box.scrollHeight)
}

/**
 * The min-height left once the room below the viewport beyond the margin is given back, or null
 * when the content fills the container again and no min-height is needed.
 */
export function heightToKeep(box: ScrollBox, held: number, contentHeight: number): number | null {
  const slack = box.scrollHeight - box.scrollTop - box.clientHeight - BOTTOM_MARGIN
  const next = slack > 0 ? held - slack : held
  return next > contentHeight + 0.5 ? next : null
}

/** Watches `content` inside `container`; returns the function that stops it. */
export function keepScrollOnShrink(container: HTMLElement, content: HTMLElement): () => void {
  let scroller: HTMLElement | null = null
  let editor: HTMLElement | null = null
  let lastTop = 0
  let lastContainerHeight = 0

  const held = (): number => parseFloat(container.style.minHeight) || 0

  const check = (): void => {
    if (!scroller) {
      scroller = container.closest<HTMLElement>('.cm-scroller')
      editor = scroller?.parentElement ?? null
      if (!scroller || !editor) return
      editor.addEventListener('scroll', onScroll, { capture: true, passive: true })
      lastTop = scroller.scrollTop
      lastContainerHeight = container.offsetHeight
      return
    }
    const hold = heightToHold(scroller, lastTop, container.offsetHeight, lastContainerHeight)
    if (hold !== null) {
      container.setCssProps({ 'min-height': `${hold}px` })
      scroller.scrollTop = lastTop
    } else if (container.style.minHeight) {
      const keep = heightToKeep(scroller, held(), content.offsetHeight)
      container.setCssProps({ 'min-height': keep === null ? '' : `${keep}px` })
    }
    lastTop = scroller.scrollTop
    lastContainerHeight = container.offsetHeight
  }

  const onScroll = (e: Event): void => {
    if (e.target === scroller) check()
  }

  const resizes = new ResizeObserver(check)
  resizes.observe(content)
  const mutations = new MutationObserver(check)
  mutations.observe(content, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  })

  return () => {
    resizes.disconnect()
    mutations.disconnect()
    editor?.removeEventListener('scroll', onScroll, { capture: true })
    container.setCssProps({ 'min-height': '' })
  }
}
