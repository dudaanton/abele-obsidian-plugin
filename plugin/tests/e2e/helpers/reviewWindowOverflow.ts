/** Painted horizontal bounds, serializable for the live renderer probe. */
export function reviewWindowOverflow(root: HTMLElement): string[] {
  const view = root.ownerDocument.defaultView!
  const modal = root.closest('.modal')
  const bounds = (modal ?? root).getBoundingClientRect()
  const result: string[] = []
  const clip = (el: Element, left: number, right: number) => {
    if (!['hidden', 'clip', 'auto', 'scroll'].includes(view.getComputedStyle(el).overflowX))
      return { left, right }
    const box = el.getBoundingClientRect(),
      host = el as HTMLElement
    return {
      left: Math.max(left, box.left + host.clientLeft),
      right: Math.min(right, box.left + host.clientLeft + host.clientWidth),
    }
  }
  let inherited = { left: -Infinity, right: Infinity }
  for (let el = modal ? root.parentElement : null; el; el = el.parentElement) {
    inherited = clip(el, inherited.left, inherited.right)
    if (el === modal) break
  }
  const walk = (el: Element, left: number, right: number) => {
    const style = view.getComputedStyle(el),
      box = el.getBoundingClientRect()
    if (!box.width || style.display === 'none' || style.visibility === 'hidden') return
    const visibleLeft = Math.max(left, box.left),
      visibleRight = Math.min(right, box.right)
    if (
      visibleRight > visibleLeft &&
      (visibleLeft < Math.max(0, bounds.left) - 1 ||
        visibleRight > Math.min(view.innerWidth, bounds.right) + 1)
    )
      result.push(
        el.tagName +
          ':' +
          String(el.className) +
          ':' +
          Math.round(visibleLeft) +
          '..' +
          Math.round(visibleRight)
      )
    const next = clip(el, left, right)
    for (const child of el.children) walk(child, next.left, next.right)
  }
  walk(root, inherited.left, inherited.right)
  return result
}
