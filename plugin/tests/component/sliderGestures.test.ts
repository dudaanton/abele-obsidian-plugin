import { expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Slider from '@/components/obsidian/Slider.vue'

it('keeps the full mobile thumb available for native dragging on a compact range', () => {
  const view = mount(Slider, {
    props: { modelValue: 0, max: 1000, thumbDragOnly: true },
    attachTo: document.body,
  })
  const input = view.element as HTMLInputElement
  input.style.setProperty('--slider-thumb-width', '36px')
  expect(getComputedStyle(input).getPropertyValue('--slider-thumb-width')).toBe('36px')
  expect(input.value).toBe('0')
  vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 240 } as DOMRect)
  const event = new PointerEvent('pointerdown', {
    pointerType: 'touch',
    clientX: 24,
    clientY: 22,
    isPrimary: true,
    bubbles: true,
    cancelable: true,
  })
  input.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  expect(input.getAttribute('data-ignore-swipe')).toBe('true')
  input.value = '800'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  expect(view.emitted('input')).toEqual([[800]])
  expect(view.emitted('update:model-value')).toEqual([[800]])
  view.unmount()
})

it('claims a track touch before native range input and rejects late native changes after a swipe', async () => {
  const view = mount(Slider, { props: { modelValue: 425, max: 1000, thumbDragOnly: true } })
  const input = view.element as HTMLInputElement
  vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200 } as DOMRect)
  const pointer = new Event('pointerdown', { bubbles: true, cancelable: true })
  Object.defineProperties(pointer, {
    pointerType: { value: 'touch' },
    clientX: { value: 150 },
    clientY: { value: 22 },
  })
  const touch = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'touches', {
      value: type === 'touchend' ? [] : [{ clientX: x, clientY: 22 }],
    })
    input.dispatchEvent(event)
  }
  const native = vi.fn()
  input.addEventListener('input', native)
  input.addEventListener('change', native)
  input.dispatchEvent(pointer)
  // Some hosts deliver native range events before touchstart, or after touchend.
  input.value = '775'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  touch('touchstart', 150)
  touch('touchmove', 190)
  touch('touchend', 190)
  input.value = '1000'
  input.dispatchEvent(new Event('change', { bubbles: true }))
  expect(pointer.defaultPrevented).toBe(true)
  expect(native).not.toHaveBeenCalled()
  expect(view.emitted('input')).toBeUndefined()
  expect(view.emitted('update:model-value')).toBeUndefined()
  expect(input.value).toBe('425')
  expect(input.hasAttribute('data-ignore-swipe')).toBe(false)
  // The same focused range still accepts an ordinary keyboard edit.
  await view.trigger('keydown', { key: 'ArrowRight' })
  input.value = '426'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  expect(view.emitted('input')).toEqual([[426]])
  expect(view.emitted('update:model-value')).toEqual([[426]])
  view.unmount()
})
