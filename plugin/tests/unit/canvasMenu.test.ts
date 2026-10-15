import { afterEach, describe, expect, it, vi } from 'vitest'
import { canvasMenu } from '@/canvas/menu'

afterEach(() => vi.useRealTimers())
describe('canvas menus', () => {
  it('close on a press outside, even one the canvas keeps from reaching the page', () => {
    vi.useFakeTimers()
    const stage = document.createElement('div')
    stage.addEventListener('pointerdown', (e) => e.stopPropagation())
    document.body.append(stage)
    const menu = canvasMenu(),
      hide = vi.spyOn(menu, 'hide')
    // The press that opened the menu does not close it.
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(hide).not.toHaveBeenCalled()
    vi.runAllTimers()
    const item = document.createElement('div')
    item.className = 'menu'
    document.body.append(item)
    item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(hide).not.toHaveBeenCalled()
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(hide).toHaveBeenCalledOnce()
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(hide).toHaveBeenCalledOnce()
    stage.remove()
    item.remove()
  })
})
