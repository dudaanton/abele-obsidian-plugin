import { expect, it, vi } from 'vitest'
import { bindCanvasLinks } from '@/canvas/links'

it('lets links open without selecting or dragging cards, while leaving pen input to the canvas', () => {
  const stage = document.createElement('div'),
    body = document.createElement('div')
  stage.append(body)
  body.innerHTML = '<a class="internal-link" data-href="sample#Heading"><span>Sample</span></a>'
  const open = vi.fn(),
    hover = vi.fn(),
    down = vi.fn()
  stage.addEventListener('pointerdown', down)
  const off = bindCanvasLinks(body, { open, hover })
  const target = body.querySelector('span')!
  for (const pointerType of ['mouse', 'touch']) {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType }))
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }
  expect(down).not.toHaveBeenCalled()
  expect(open).toHaveBeenCalledTimes(2)
  expect(open.mock.calls[0][0]).toBe(body.querySelector('a'))
  target.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }))
  expect(open).toHaveBeenCalledTimes(3)
  target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(hover).toHaveBeenCalledOnce()
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'pen' }))
  expect(down).toHaveBeenCalledOnce()
  off()
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(open).toHaveBeenCalledTimes(3)
})
