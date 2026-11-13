/** A native touch keeps its initial target even when the host moves a drawer backdrop. */
export function nativeInputReceipt(box: () => HTMLElement | undefined) {
  const touches = new Set<number>()
  return (event: Event): boolean => {
    const el = box()
    if (!el) return false
    if (!event.type.startsWith('touch')) return el.contains(event.target as Node | null)
    const changed = Array.from((event as TouchEvent).changedTouches)
    if (event.type === 'touchstart') {
      for (const touch of changed) {
        const hit = el.ownerDocument.elementFromPoint(touch.clientX, touch.clientY)
        if (hit && el.contains(hit)) touches.add(touch.identifier)
      }
    }
    const received = changed.some((touch) => touches.has(touch.identifier))
    if (event.type === 'touchend' || event.type === 'touchcancel')
      for (const touch of changed) touches.delete(touch.identifier)
    return received
  }
}
