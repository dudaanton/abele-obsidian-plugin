import { afterEach, describe, expect, it, vi } from 'vitest'
import { canvasMenu } from '@/canvas/menu'

afterEach(() => vi.useRealTimers())
describe('canvas menus', () => {
  it('consumes outside presses before canvas actions', () => {
    vi.useFakeTimers()
    const stage = document.createElement('div'),
      action = vi.fn()
    document.body.append(stage)
    stage.addEventListener('pointerdown', action)
    const menu = canvasMenu()
    vi.runAllTimers()
    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
    stage.dispatchEvent(event)
    expect(action).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    menu.hide()
    stage.remove()
  })
  it.each(['wheel', 'Escape', 'replacement'])('closes on %s', (reason) => {
    vi.useFakeTimers()
    const menu = canvasMenu(),
      hide = vi.spyOn(menu, 'hide')
    vi.runAllTimers()
    if (reason === 'wheel') document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    else if (reason === 'Escape')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    else canvasMenu().hide()
    expect(hide).toHaveBeenCalledOnce()
    vi.runAllTimers()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(hide).toHaveBeenCalledOnce()
  })
  it('cancels delayed installation when hidden immediately', () => {
    vi.useFakeTimers()
    const menu = canvasMenu(),
      hide = vi.spyOn(menu, 'hide')
    menu.hide()
    vi.runAllTimers()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(hide).toHaveBeenCalledOnce()
  })
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
