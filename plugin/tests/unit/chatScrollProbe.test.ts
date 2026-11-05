import { expect, it, vi } from 'vitest'
import { visibleChatAnchor } from '../e2e/helpers/visibleChatAnchor'

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom } as DOMRect
}
function box() {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => rect(100, 300)
  Object.defineProperty(el, 'clientHeight', { value: 200 })
  return el
}
function markdown(el: HTMLElement, top: number, bottom: number, positions: number[]) {
  const root = document.createElement('div')
  root.className = 'abele-markdown'
  root.getBoundingClientRect = () => rect(top, bottom)
  const blocks = positions.map((at) => {
    const p = document.createElement('p')
    p.getBoundingClientRect = () => rect(at, at + 30)
    p.getClientRects = vi.fn(() => [p.getBoundingClientRect()] as unknown as DOMRectList)
    root.append(p)
    return p
  })
  el.append(root)
  return blocks
}

it('does not force offscreen markdown to render while sampling a visible anchor', () => {
  const el = box()
  const hidden = markdown(el, -600, -400, [-590])[0]
  const visible = markdown(el, 120, 180, [130])[0]
  expect(visibleChatAnchor(el)).toBe(visible)
  expect(hidden.getClientRects).not.toHaveBeenCalled()
})

it('keeps the first visible block start instead of the clipped paragraph above it', () => {
  const el = box(),
    blocks = markdown(el, 80, 250, [80, 160, 220])
  expect(visibleChatAnchor(el)).toBe(blocks[1])
})

it('retains the message fallback when no markdown start is visible', () => {
  const el = box(),
    message = document.createElement('div')
  message.dataset.messageId = 'sample-message'
  message.getBoundingClientRect = () => rect(60, 250)
  el.append(message)
  expect(visibleChatAnchor(el)).toBe(message)
})
