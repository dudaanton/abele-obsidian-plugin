import { afterEach, describe, expect, it, vi } from 'vitest'
import { canvasMenu } from '@/canvas/menu'
import { Menu } from 'obsidian'
import { dropMenu } from '@/components/canvas/chromeMenus'

// Obsidian keeps one onHide callback. Model that contract locally so the connection-drop
// regression cannot be hidden by the shared mock's accumulating callbacks.
vi.mock('obsidian', async (original) => {
  const api = await original<typeof import('obsidian')>()
  return {
    ...api,
    Menu: class extends api.Menu {
      private closing: (() => void) | null = null
      onHide(callback: () => void): void {
        this.closing = callback
      }
      hide(): this {
        const callback = this.closing
        this.closing = null
        callback?.()
        return this
      }
    },
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
describe('canvas menus', () => {
  it('releases canvas input when a connection-drop menu closes', () => {
    vi.useFakeTimers()
    const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
    const controls = {
      drop: () => ({ screen: { x: 100, y: 100 } }),
      value: () => 'rectangle',
      dropAdd: vi.fn(),
    }
    dropMenu(controls as unknown as Parameters<typeof dropMenu>[0])
    const menu = shown.mock.contexts[0]
    vi.runAllTimers()
    menu.hide()
    expect(controls.dropAdd).toHaveBeenCalledExactlyOnceWith(null)
    const hide = vi.spyOn(menu, 'hide')
    const press = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.body.dispatchEvent(press)
    document.body.dispatchEvent(escape)
    expect(press.defaultPrevented).toBe(false)
    expect(escape.defaultPrevented).toBe(false)
    expect(hide).not.toHaveBeenCalled()
  })
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
