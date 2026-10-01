import { describe, expect, it, vi, afterEach } from 'vitest'
import { bindCheckboxMenu } from '@/checkboxes/gestures'

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn())
  document.body.replaceChildren()
  vi.useRealTimers()
})

function fixture() {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.className = 'task-list-item-checkbox'
  input.dataset.task = ' '
  document.body.append(input)
  const open = vi.fn(() => true)
  cleanups.push(bindCheckboxMenu(document, open))
  return { input, open }
}
function pointer(el: Element, type: string, x = 10) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerType: 'touch',
      clientX: x,
      clientY: 10,
      pointerId: 1,
    })
  )
}

describe('checkbox state menu gestures', () => {
  it('keeps ordinary clicks and short taps native', () => {
    vi.useFakeTimers()
    const { input, open } = fixture()
    pointer(input, 'pointerdown')
    vi.advanceTimersByTime(100)
    pointer(input, 'pointerup')
    input.click()
    expect(input.checked).toBe(true)
    expect(open).not.toHaveBeenCalled()
  })
  it('leaves task-note card checkboxes alone', () => {
    const { input, open } = fixture()
    input.removeAttribute('data-task')
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    expect(open).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
  it('opens on right click without toggling the checkbox', () => {
    const { input, open } = fixture()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    expect(open).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
    expect(input.checked).toBe(false)
  })
  it('opens on hold and consumes only the ensuing click on that checkbox', () => {
    vi.useFakeTimers()
    const { input, open } = fixture()
    pointer(input, 'pointerdown')
    vi.advanceTimersByTime(600)
    pointer(input, 'pointerup')
    input.click()
    expect(open).toHaveBeenCalledOnce()
    expect(input.checked).toBe(false)
    vi.advanceTimersByTime(1200)
    input.click()
    expect(input.checked).toBe(true)
  })
  it.each(['pointermove', 'pointercancel'])('does not open after %s', (event) => {
    vi.useFakeTimers()
    const { input, open } = fixture()
    pointer(input, 'pointerdown')
    pointer(input, event, 35)
    vi.advanceTimersByTime(1000)
    expect(open).not.toHaveBeenCalled()
  })
  it('prevents native text selection during a checkbox hold, then restores it', () => {
    vi.useFakeTimers()
    const { input } = fixture()
    const root = document.createElement('div')
    root.className = 'markdown-preview-view'
    input.replaceWith(root)
    root.append(input)
    pointer(input, 'pointerdown')
    expect(root.classList.contains('abele-checkbox-press')).toBe(true)
    const selecting = new Event('selectstart', { bubbles: true, cancelable: true })
    input.dispatchEvent(selecting)
    expect(selecting.defaultPrevented).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(root.classList.contains('abele-checkbox-press')).toBe(true)
    pointer(input, 'pointerup')
    expect(root.classList.contains('abele-checkbox-press')).toBe(false)
    input.click()
    expect(input.checked).toBe(false)
    const released = new Event('selectstart', { bubbles: true, cancelable: true })
    input.dispatchEvent(released)
    expect(released.defaultPrevented).toBe(false)
  })

  it('releases pending holds on unload', () => {
    vi.useFakeTimers()
    const { input, open } = fixture()
    pointer(input, 'pointerdown')
    cleanups.splice(0).forEach((fn) => fn())
    vi.advanceTimersByTime(1000)
    expect(open).not.toHaveBeenCalled()
  })
})
