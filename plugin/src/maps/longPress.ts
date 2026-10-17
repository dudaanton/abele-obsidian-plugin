/** A map-local gesture: moving, another finger, cancellation and closing all abandon it. */
export function mapLongPress(el: HTMLElement, open: (x: number, y: number) => void): () => void {
  const win = el.ownerDocument.defaultView
  let timer = 0
  let start: { x: number; y: number } | null = null
  const cancel = () => {
    win.clearTimeout(timer)
    start = null
  }
  const down = (event: TouchEvent) => {
    cancel()
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    start = { x: touch.clientX, y: touch.clientY }
    timer = win.setTimeout(() => {
      if (start) open(start.x, start.y)
      start = null
    }, 550)
  }
  const move = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (
      !touch ||
      event.touches.length !== 1 ||
      (start && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 8)
    )
      cancel()
  }
  el.addEventListener('touchstart', down, { passive: true })
  el.addEventListener('touchmove', move, { passive: true })
  el.addEventListener('touchend', cancel)
  el.addEventListener('touchcancel', cancel)
  return () => {
    cancel()
    el.removeEventListener('touchstart', down)
    el.removeEventListener('touchmove', move)
    el.removeEventListener('touchend', cancel)
    el.removeEventListener('touchcancel', cancel)
  }
}
