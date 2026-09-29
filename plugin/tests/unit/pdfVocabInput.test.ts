import { describe, expect, it } from 'vitest'
import { PageGesture } from '@/reader/pageGesture'

const pointer = (doc: Document, name: string, x = 10, y = 10) => {
  const event = new Event(name, { bubbles: true })
  Object.assign(event, { clientX: x, clientY: y, pointerType: 'mouse' })
  doc.dispatchEvent(event)
}
const touch = (doc: Document, name: string, count: number) => {
  const event = new Event(name, { bubbles: true })
  Object.assign(event, {
    touches: Array.from({ length: count }, () => ({ clientX: 10, clientY: 10 })),
  })
  doc.dispatchEvent(event)
}

describe('fixed-page mark gestures', () => {
  it('accepts a clean click with the highlight bar open but rejects a drag', () => {
    const doc = document.implementation.createHTMLDocument('page')
    const gesture = new PageGesture(doc, () => true)
    pointer(doc, 'pointerdown')
    pointer(doc, 'pointerup')
    expect(gesture.markTap).toBe(true)
    pointer(doc, 'pointerdown')
    pointer(doc, 'pointermove', 30)
    pointer(doc, 'pointerup', 30)
    expect(gesture.markTap).toBe(false)
  })

  it('rejects canceled touches and pinch-generated clicks', () => {
    const doc = document.implementation.createHTMLDocument('page')
    const gesture = new PageGesture(doc, () => false)
    touch(doc, 'touchstart', 1)
    touch(doc, 'touchcancel', 0)
    expect(gesture.markTap).toBe(false)
    touch(doc, 'touchstart', 2)
    touch(doc, 'touchend', 0)
    expect(gesture.markTap).toBe(false)
  })
})
