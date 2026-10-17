import { afterEach, expect, it, vi } from 'vitest'
import { mapLongPress } from '@/maps/longPress'
afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})
const touch = (el: HTMLElement, type: string, points: { clientX: number; clientY: number }[]) => {
  const event = new Event(type)
  Object.defineProperty(event, 'touches', { value: points })
  el.dispatchEvent(event)
}
it('opens at the held position, cancels on movement and multitouch, and cleans up on close', () => {
  vi.useFakeTimers()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const open = vi.fn()
  const dispose = mapLongPress(el, open)
  touch(el, 'touchstart', [{ clientX: 10, clientY: 20 }])
  vi.advanceTimersByTime(550)
  expect(open).toHaveBeenCalledWith(10, 20)
  open.mockClear()
  touch(el, 'touchstart', [{ clientX: 10, clientY: 20 }])
  touch(el, 'touchmove', [{ clientX: 40, clientY: 20 }])
  vi.advanceTimersByTime(550)
  expect(open).not.toHaveBeenCalled()
  touch(el, 'touchstart', [{ clientX: 10, clientY: 20 }])
  touch(el, 'touchstart', [
    { clientX: 10, clientY: 20 },
    { clientX: 40, clientY: 40 },
  ])
  vi.advanceTimersByTime(550)
  expect(open).not.toHaveBeenCalled()
  touch(el, 'touchstart', [{ clientX: 10, clientY: 20 }])
  dispose()
  touch(el, 'touchstart', [{ clientX: 10, clientY: 20 }])
  vi.advanceTimersByTime(1000)
  expect(open).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
