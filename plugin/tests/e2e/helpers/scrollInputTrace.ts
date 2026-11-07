/** Diagnostic only: preserve the native accessor and record JS writes separately from events. */
export function traceScrollInput(el: HTMLElement) {
  const events: {
    at: number
    kind: string
    top: number
    requested?: number
    stack?: string
    button?: number
    buttons?: number
    pointer?: ReturnType<typeof pointerGeometry>
  }[] = []
  const win = el.ownerDocument.defaultView!
  const own = Object.getOwnPropertyDescriptor(el, 'scrollTop')
  let owner: object | null = el
  let accessor = own
  while (!accessor && (owner = Object.getPrototypeOf(owner)))
    accessor = Object.getOwnPropertyDescriptor(owner, 'scrollTop')
  if (!accessor?.get || !accessor.set) throw Error('Native scroll accessor unavailable')
  const { get, set } = accessor
  const mark = (kind: string) => {
    events.push({ at: win.performance.now(), kind, top: get.call(el) as number })
  }
  const describe = (target: EventTarget | null) => {
    const node = target as Element | null
    return {
      tag: node?.tagName ?? null,
      classes: node?.getAttribute?.('class') ?? null,
      isContainer: target === el,
      insideContainer: !!node?.nodeType && el.contains(node),
    }
  }
  const pointerGeometry = (x: number, y: number, target: EventTarget | null = null) => {
    const rect = el.getBoundingClientRect()
    const style = win.getComputedStyle(el)
    return {
      x,
      y,
      target: describe(target),
      hit: describe(el.ownerDocument.elementFromPoint(x, y)),
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      clientLeft: el.clientLeft,
      clientWidth: el.clientWidth,
      offsetWidth: el.offsetWidth,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      overflowY: style.overflowY,
      scrollbarWidth: style.scrollbarWidth,
      direction: style.direction,
      devicePixelRatio: win.devicePixelRatio,
    }
  }
  const pointer = (
    kind: string,
    x: number,
    y: number,
    target?: EventTarget | null,
    state?: { button: number; buttons: number }
  ) => {
    events.push({
      at: win.performance.now(),
      kind,
      top: get.call(el) as number,
      pointer: pointerGeometry(x, y, target),
      ...state,
    })
  }
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get() {
      return get.call(el) as number
    },
    set(value: number) {
      events.push({
        at: win.performance.now(),
        kind: 'js-write',
        top: get.call(el) as number,
        requested: value,
        stack: new Error().stack,
      })
      set.call(el, value)
    },
  })
  const onEvent = (event: Event) => mark(event.type)
  const onPointer = (event: MouseEvent) =>
    pointer(event.type, event.clientX, event.clientY, event.target, {
      button: event.button,
      buttons: event.buttons,
    })
  el.addEventListener('scroll', onEvent)
  el.addEventListener('scrollend', onEvent)
  win.addEventListener('mousedown', onPointer, true)
  win.addEventListener('mouseup', onPointer, true)
  let stopped = false
  return {
    events,
    mark,
    pointer,
    stop() {
      if (stopped) return
      stopped = true
      el.removeEventListener('scroll', onEvent)
      el.removeEventListener('scrollend', onEvent)
      win.removeEventListener('mousedown', onPointer, true)
      win.removeEventListener('mouseup', onPointer, true)
      if (own) Object.defineProperty(el, 'scrollTop', own)
      else Reflect.deleteProperty(el, 'scrollTop')
    },
  }
}
