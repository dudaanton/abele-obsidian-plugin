import { expect, it } from 'vitest'
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
