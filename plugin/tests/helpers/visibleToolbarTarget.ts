/** A flex list may overflow without being the element that accepts horizontal scrolling. */
export function findToolbarScroller(item: HTMLElement, toolbar: HTMLElement): HTMLElement {
  for (
    let parent = item.parentElement;
    parent && parent !== toolbar;
    parent = parent.parentElement
  ) {
    const overflow = parent.ownerDocument.defaultView!.getComputedStyle(parent).overflowX
    if (
      parent.scrollWidth > parent.clientWidth + 1 &&
      (overflow === 'auto' || overflow === 'scroll')
    )
      return parent
  }
  return toolbar
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Also serialized into the page; use fresh viewport rectangles on every attempt. */
export function visibleToolbarTarget(
  item: Box,
  toolbar: Box,
  viewport: Box
): { point: { x: number; y: number } } | { scroll: 'left' | 'right' } | { unavailable: true } {
  const left = Math.max(toolbar.left, viewport.left)
  const right = Math.min(toolbar.right, viewport.right)
  const top = Math.max(toolbar.top, viewport.top)
  const bottom = Math.min(toolbar.bottom, viewport.bottom)
  if (left >= right || top >= bottom || item.bottom <= top || item.top >= bottom)
    return { unavailable: true }
  if (item.right > right) return { scroll: 'left' }
  if (item.left < left) return { scroll: 'right' }
  return {
    point: {
      x: (item.left + item.right) / 2,
      y: (Math.max(item.top, top) + Math.min(item.bottom, bottom)) / 2,
    },
  }
}
