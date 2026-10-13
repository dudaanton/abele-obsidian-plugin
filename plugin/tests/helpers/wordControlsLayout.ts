export function measureWordControls(modal: HTMLElement, body: HTMLElement, content: HTMLElement) {
  const win = modal.ownerDocument.defaultView!
  const rect = (el: Element) => {
    const r = el.getBoundingClientRect()
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    }
  }
  const name = (el: Element) => ((el.className || el.tagName) + '').split(' ')[0].slice(0, 48)
  const viewport = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight }
  const bodyBox = rect(body)
  const visibleBody = {
    left: Math.max(0, bodyBox.left),
    right: Math.min(bodyBox.right, viewport.right),
    top: Math.max(0, bodyBox.top),
    bottom: Math.min(bodyBox.bottom, viewport.bottom),
  }
  const over: { name: string; by: number; bounds: ReturnType<typeof rect> }[] = []
  const cuts: { name: string; by: number; bounds: ReturnType<typeof rect> }[] = []
  const overflow = win.getComputedStyle(body).overflowY
  const remainingScroll =
    overflow === 'auto' || overflow === 'scroll'
      ? Math.max(0, body.scrollHeight - body.clientHeight - body.scrollTop)
      : 0
  // Match phoneLayout's visible descendant walker and stop at intentional horizontal scrollers.
  const walk = (el: HTMLElement) => {
    const css = win.getComputedStyle(el)
    if (
      css.visibility === 'hidden' ||
      css.display === 'none' ||
      css.position === 'absolute' ||
      el.classList.contains('is-measuring')
    )
      return
    const r = rect(el)
    const by = Math.max(visibleBody.left - r.left, r.right - visibleBody.right)
    if (r.width > 0 && by > 1) over.push({ name: name(el), by, bounds: r })
    // Below-fold content is valid only if scrolling the body can reveal its painted content.
    const painted =
      el.tagName === 'IMG' ||
      Array.from(el.childNodes).some((node) => node.nodeType === 3 && !!node.textContent?.trim())
    const below = r.bottom - remainingScroll - visibleBody.bottom
    const above = visibleBody.top - (r.top + body.scrollTop)
    if (painted && r.width > 0 && r.height > 0 && Math.max(below, above) > 1)
      cuts.push({ name: name(el), by: Math.max(below, above), bounds: r })
    if (css.overflowX === 'auto' || css.overflowX === 'scroll') return
    for (const child of Array.from(el.children)) walk(child as HTMLElement)
  }
  walk(content)
  const title = modal.querySelector('.modal-title')
  const dismiss = modal.querySelector('.modal-close-button,.modal-header-button')
  // phoneLayout checks the dismiss action separately instead of asserting the sheet's box.
  for (const action of [title, dismiss]) {
    if (!action) continue
    const r = rect(action)
    const by = Math.max(-r.left, r.right - viewport.right, -r.top, r.bottom - viewport.bottom)
    if (r.width <= 0 || r.height <= 0 || by > 0)
      cuts.push({ name: name(action), by: Math.max(0, by), bounds: r })
  }
  if (!dismiss) cuts.push({ name: 'missing dismiss action', by: 0, bounds: rect(modal) })
  return {
    clipped: over.length > 0 || cuts.length > 0,
    over,
    cuts,
    bounds: {
      sheet: rect(modal),
      body: bodyBox,
      content: rect(content),
      visibleBody,
      viewport,
      title: title ? rect(title) : null,
      dismiss: dismiss ? rect(dismiss) : null,
      scroll: {
        top: body.scrollTop,
        height: body.scrollHeight,
        clientHeight: body.clientHeight,
        remaining: remainingScroll,
      },
    },
  }
}
