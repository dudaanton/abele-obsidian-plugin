import { expect, it } from 'vitest'
import { scrollbarDragPoint } from '../e2e/helpers/scrollbarDragPoint'

it('aims at the interior of an overlay thumb instead of its rounded bottom cap', () => {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ left: 100, right: 520, top: 50, bottom: 650 }) as DOMRect
  Object.defineProperties(el, {
    clientHeight: { value: 600 },
    scrollHeight: { value: 3000 },
    clientWidth: { value: 420 },
    offsetWidth: { value: 420 },
  })
  el.scrollTop = 2400
  expect(scrollbarDragPoint(el)).toEqual({ x: 514, y: 590 })
  el.scrollTop = 1200
  expect(scrollbarDragPoint(el)).toEqual({ x: 514, y: 350 })
  el.scrollTop = 0
  expect(scrollbarDragPoint(el)).toEqual({ x: 514, y: 110 })
})

it('rejects a hidden viewport', () => {
  expect(() => scrollbarDragPoint(document.createElement('div'))).toThrow('visible viewport')
})

it('keeps finite coordinates for short chats without a scroll range', () => {
  const el = document.createElement('div')
  Object.defineProperties(el, {
    clientHeight: { value: 600 },
    scrollHeight: { value: 600 },
  })
  expect(scrollbarDragPoint(el).y).toBe(300)
})
