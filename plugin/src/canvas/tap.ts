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
/** Delay a single activation just long enough to distinguish a double activation. */
export function bindCanvasPicture(
  picture: HTMLElement,
  single: () => void,
  double: () => void
): () => void {
  let timer = 0
  let touch = -Infinity
  let first: { x: number; y: number } | null = null
  let start: { id: number; x: number; y: number } | null = null
  const off: (() => void)[] = []
  const cancel = () => {
    picture.win.clearTimeout(timer)
    timer = 0
    first = null
  }
  const listen = (type: string, handler: EventListener, options?: AddEventListenerOptions) => {
    picture.addEventListener(type, handler, options)
    off.push(() => picture.removeEventListener(type, handler, options))
  }
  // Keep editor embed selection out of the gesture without cancelling native note scrolling.
  for (const type of ['touchstart', 'touchend'])
    listen(type, (event) => event.stopPropagation(), { passive: true })
  listen('mousedown', (event) => {
    event.stopPropagation()
    if (event.cancelable) event.preventDefault()
  })
  const once = () => {
    cancel()
    timer = picture.win.setTimeout(() => {
      timer = 0
      first = null
      single()
    }, 300)
  }
  listen('pointerdown', (event) => {
    const e = event as PointerEvent
    if (e.pointerType === 'mouse') return
    e.stopPropagation()
    if (start) {
      start = null
      cancel()
      return
    }
    start = { id: e.pointerId, x: e.clientX, y: e.clientY }
  })
  listen('pointermove', (event) => {
    const e = event as PointerEvent
    if (start?.id === e.pointerId && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
      start = null
      cancel()
    }
  })
  listen('pointercancel', () => {
    start = null
    cancel()
  })
  listen('pointerup', (event) => {
    const e = event as PointerEvent,
      was = start
    if (e.pointerType === 'mouse') return
    start = null
    touch = Date.now()
    e.stopPropagation()
    if (!was || was.id !== e.pointerId || Math.hypot(e.clientX - was.x, e.clientY - was.y) > 8)
      return
    if (e.cancelable) e.preventDefault()
    if (timer && first && Math.hypot(e.clientX - first.x, e.clientY - first.y) <= 24) {
      cancel()
      double()
    } else {
      once()
      first = { x: e.clientX, y: e.clientY }
    }
  })
  listen('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (Date.now() - touch < 600) return
    if ((event as MouseEvent).detail < 2) once()
  })
  listen('dblclick', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (Date.now() - touch < 600) return
    cancel()
    double()
  })
  return () => {
    cancel()
    start = null
    off.forEach((fn) => fn())
  }
}
