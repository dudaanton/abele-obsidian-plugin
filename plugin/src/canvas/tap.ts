/** Editor widgets can be rebuilt before Safari's delayed click. Act at a stationary touch release. */
export function bindCanvasTap(button: HTMLButtonElement, action: () => void): () => void {
  const off: (() => void)[] = []
  let start: { id: number; x: number; y: number } | null = null
  let touched = -Infinity
  const listen = (type: string, handler: EventListener, options?: AddEventListenerOptions) => {
    button.addEventListener(type, handler, options)
    off.push(() => button.removeEventListener(type, handler, options))
  }
  listen('pointerdown', (event) => {
    const e = event as PointerEvent
    e.stopPropagation()
    if (e.pointerType === 'mouse') return
    start = { id: e.pointerId, x: e.clientX, y: e.clientY }
  })
  listen('mousedown', (e) => {
    e.stopPropagation()
    if (e.cancelable) e.preventDefault()
  })
  // Touches still belong to the note's native scrolling until a stationary release activates.
  for (const type of ['touchstart', 'touchend'])
    listen(type, (e) => e.stopPropagation(), { passive: true })
  listen('pointermove', (event) => {
    const e = event as PointerEvent
    if (start?.id === e.pointerId && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8)
      start = null
  })
  listen('pointercancel', () => {
    start = null
  })
  listen('pointerup', (event) => {
    const e = event as PointerEvent,
      was = start
    start = null
    e.stopPropagation()
    if (
      !was ||
      was.id !== e.pointerId ||
      Math.hypot(e.clientX - was.x, e.clientY - was.y) > 8 ||
      button.disabled
    )
      return
    if (e.cancelable) e.preventDefault()
    touched = Date.now()
    action()
  })
  listen('click', (event) => {
    const e = event as MouseEvent
    e.preventDefault()
    e.stopPropagation()
    if (button.disabled || (e.detail !== 0 && Date.now() - touched < 600)) return
    action()
  })
  return () => {
    start = null
    off.forEach((fn) => fn())
  }
}
