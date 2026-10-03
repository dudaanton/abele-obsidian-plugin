import { expect, it, vi } from 'vitest'
import { bindCanvasTap } from '@/canvas/tap'
it('allows a vertical scroll gesture to start on an embed button without cancelling the browser touch stream', () => {
  const button = document.createElement('button'),
    action = vi.fn(),
    off = bindCanvasTap(button, action)
  try {
    button.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 30,
        clientY: 20,
      })
    )
    const start = new Event('touchstart', { cancelable: true, bubbles: true })
    button.dispatchEvent(start)
    expect(start.defaultPrevented).toBe(false)
    button.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 30,
        clientY: 120,
      })
    )
    button.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'touch' }))
    const end = new Event('touchend', { cancelable: true, bubbles: true })
    button.dispatchEvent(end)
    expect(end.defaultPrevented).toBe(false)
    expect(action).not.toHaveBeenCalled()
  } finally {
    off()
  }
})
it('does not mistake a scroll that returns to its initial position for a stationary tap', () => {
  const button = document.createElement('button'),
    action = vi.fn(),
    off = bindCanvasTap(button, action)
  try {
    const pointer = (type: string, y: number) =>
      button.dispatchEvent(
        new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: 30, clientY: y })
      )
    pointer('pointerdown', 20)
    pointer('pointermove', 120)
    pointer('pointerup', 20)
    expect(action).not.toHaveBeenCalled()
  } finally {
    off()
  }
})
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
