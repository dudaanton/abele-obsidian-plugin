import { expect, it, vi } from 'vitest'
import { traceScrollInput } from '../e2e/helpers/scrollInputTrace'

it('distinguishes native movement from JS writes without changing the accessor', () => {
  const el = document.createElement('div')
  let position = 2000
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => position,
    set: (top: number) => {
      position = Math.max(0, top)
    },
  })
  const original = Object.getOwnPropertyDescriptor(el, 'scrollTop')
  const trace = traceScrollInput(el)
  trace.mark('hold-origin')
  position -= 750 // Compositor movement does not call the JavaScript setter.
  el.dispatchEvent(new Event('scroll'))
  el.scrollTop = -50
  expect(el.scrollTop).toBe(0)
  expect(trace.events.map(({ kind, top }) => ({ kind, top }))).toEqual([
    { kind: 'hold-origin', top: 2000 },
    { kind: 'scroll', top: 1250 },
    { kind: 'js-write', top: 1250 },
  ])
  expect(trace.events[2].requested).toBe(-50)
  expect(trace.events[2].stack).toContain('chatScrollInputTrace')
  trace.stop()
  trace.stop()
  expect(Object.getOwnPropertyDescriptor(el, 'scrollTop')).toEqual(original)
  el.dispatchEvent(new Event('scroll'))
  window.dispatchEvent(new Event('mouseup'))
  expect(trace.events).toHaveLength(3)
})

it('restores an inherited accessor after tracing', () => {
  const el = document.createElement('div')
  const trace = traceScrollInput(el)
  trace.stop()
  expect(Object.hasOwn(el, 'scrollTop')).toBe(false)
})

it('records requested gutter geometry and the actual pointer target without moving scroll', () => {
  const el = document.createElement('div')
  const overlay = document.createElement('div')
  el.getBoundingClientRect = () => ({ left: 10, right: 510, top: 20, bottom: 820 }) as DOMRect
  Object.defineProperties(el, {
    clientWidth: { value: 485 },
    offsetWidth: { value: 500 },
    clientHeight: { value: 800 },
    scrollHeight: { value: 4000 },
  })
  el.scrollTop = 3200
  document.body.append(el, overlay)
  const hit = vi.spyOn(document, 'elementFromPoint').mockReturnValue(overlay)
  const trace = traceScrollInput(el)
  try {
    trace.pointer('press-target', 507, 815)
    overlay.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 507, clientY: 815 })
    )
    expect(trace.events.map(({ kind }) => kind)).toEqual(['press-target', 'mousedown'])
    expect(trace.events[0].pointer).toMatchObject({
      x: 507,
      y: 815,
      clientWidth: 485,
      offsetWidth: 500,
      rect: { left: 10, right: 510, top: 20, bottom: 820 },
      hit: { isContainer: false, insideContainer: false },
    })
    expect(trace.events[1].pointer?.target).toMatchObject({ tag: 'DIV', insideContainer: false })
    expect(el.scrollTop).toBe(3200)
    trace.stop()
    overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(trace.events).toHaveLength(2)
  } finally {
    trace.stop()
    hit.mockRestore()
    el.remove()
    overlay.remove()
  }
})
