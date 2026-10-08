/** Visible right-edge overflow, serializable for probes running in an Obsidian renderer. */
export function horizontalOverflow(root: HTMLElement): string[] {
  const view = root.ownerDocument.defaultView!
  const box = root.getBoundingClientRect()
  const over: string[] = []
  const walk = (el: Element, clippedAt: number) => {
    const s = view.getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'absolute') return
    if (el.classList.contains('is-measuring')) return
    const r = el.getBoundingClientRect()
    const visibleRight = Math.min(r.right, clippedAt)
    if (r.width > 0 && visibleRight > r.left && visibleRight > box.right + 1) {
      over.push(
        (el.className || el.tagName).toString().slice(0, 40) +
          ' +' +
          Math.round(visibleRight - box.right)
      )
    }
    // Measure the container itself before applying its clip to descendants. An oversized
    // scroller is still a bug; tabs beyond a correctly sized strip's viewport are not.
    const clips = ['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX)
    const host = el as HTMLElement
    const edge = clips
      ? Math.min(clippedAt, r.left + host.clientLeft + host.clientWidth)
      : clippedAt
    for (const child of el.children) walk(child, edge)
  }
  for (const child of root.children) walk(child, Infinity)
  return over
}
