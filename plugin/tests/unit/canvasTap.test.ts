import { expect, it, vi } from 'vitest'
import { bindCanvasTap } from '@/canvas/tap'
it('opens on the first touch release and ignores its delayed synthetic click', () => {
  const button = document.createElement('button'),
    action = vi.fn(),
    off = bindCanvasTap(button, action)
  button.dispatchEvent(
    new PointerEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 30,
      clientY: 20,
    })
  )
  button.dispatchEvent(
    new PointerEvent('pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 30,
      clientY: 20,
      cancelable: true,
    })
  )
  expect(action).toHaveBeenCalledOnce()
  button.dispatchEvent(new MouseEvent('click', { detail: 1 }))
  expect(action).toHaveBeenCalledOnce()
  button.dispatchEvent(new MouseEvent('click', { detail: 0 }))
  expect(action).toHaveBeenCalledTimes(2)
  off()
  button.click()
  expect(action).toHaveBeenCalledTimes(2)
})
it('does not activate on a moved, cancelled or disabled touch and keeps mouse clicks', () => {
  const button = document.createElement('button'),
    action = vi.fn(),
    off = bindCanvasTap(button, action)
  const event = (type: string, x: number) =>
    button.dispatchEvent(
      new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: 20 })
    )
  event('pointerdown', 30)
  event('pointerup', 100)
  event('pointerdown', 30)
  event('pointercancel', 30)
  event('pointerup', 30)
  button.disabled = true
  event('pointerdown', 30)
  event('pointerup', 30)
  expect(action).not.toHaveBeenCalled()
  button.disabled = false
  button.dispatchEvent(new MouseEvent('click', { detail: 1 }))
  expect(action).toHaveBeenCalledOnce()
  off()
})
