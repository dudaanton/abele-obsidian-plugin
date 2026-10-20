import { expect, it, vi } from 'vitest'
import { Menu } from 'obsidian'
import { marginMenu } from '@/debugger/trace/panel'

it.each([false, true])('anchors a keyboard or synthetic menu click to its control: %s', (phone) => {
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  const target = document.createElement('button')
  target.getBoundingClientRect = () => ({ left: phone ? 24 : 680, bottom: 240 }) as DOMRect
  const event = new MouseEvent('click')
  Object.defineProperty(event, 'currentTarget', { value: target })
  marginMenu(
    { controller: { knownBreakpoints: () => [], current: true } } as never,
    'sample-source',
    8,
    event
  )
  expect(show).toHaveBeenCalledWith({ x: phone ? 24 : 680, y: 240 })
  show.mockRestore()
})

it('keeps actual gutter pointer coordinates', () => {
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const event = new MouseEvent('contextmenu', { clientX: 180, clientY: 320 })
  marginMenu(
    { controller: { knownBreakpoints: () => [], current: true } } as never,
    'sample-source',
    8,
    event
  )
  expect(show).toHaveBeenCalledWith(event)
  show.mockRestore()
})
