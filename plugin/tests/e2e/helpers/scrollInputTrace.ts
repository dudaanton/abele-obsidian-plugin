/** Diagnostic only: preserve the native accessor and record JS writes separately from events. */
export function traceScrollInput(el: HTMLElement) {
  const events: { at: number; kind: string; top: number; requested?: number; stack?: string }[] = []
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
  el.addEventListener('scroll', onEvent)
  el.addEventListener('scrollend', onEvent)
  win.addEventListener('mouseup', onEvent, true)
  let stopped = false
  return {
    events,
    mark,
    stop() {
      if (stopped) return
      stopped = true
      el.removeEventListener('scroll', onEvent)
      el.removeEventListener('scrollend', onEvent)
      win.removeEventListener('mouseup', onEvent, true)
      if (own) Object.defineProperty(el, 'scrollTop', own)
      else Reflect.deleteProperty(el, 'scrollTop')
    },
  }
}
