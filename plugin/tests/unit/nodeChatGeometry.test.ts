import { expect, it, vi } from 'vitest'
import { checkNodeChatGeometry } from '../helpers/nodeChatGeometry'

const viewport = { width: 390, height: 844 }
const toolbar = { left: 80, right: 375, top: 770, bottom: 810 }

it('accepts a background navbar beside the foreground chat drawer', () => {
  const hit = vi.fn(() => true)
  expect(() =>
    checkNodeChatGeometry(toolbar, { left: -250, right: 40, top: 760, bottom: 820 }, viewport, hit)
  ).not.toThrow()
  expect(hit).not.toHaveBeenCalled()
})
it('accepts a navbar covered by the chat drawer', () => {
  expect(() =>
    checkNodeChatGeometry(
      toolbar,
      { left: 20, right: 375, top: 760, bottom: 820 },
      viewport,
      () => false
    )
  ).not.toThrow()
})
it('rejects a native navbar painted over the composer', () => {
  expect(() =>
    checkNodeChatGeometry(
      toolbar,
      { left: 20, right: 375, top: 760, bottom: 820 },
      viewport,
      () => true
    )
  ).toThrow('covered')
})
it.each([
  { left: -2, right: 375, top: 770, bottom: 810 },
  { left: 80, right: 395, top: 770, bottom: 810 },
  { left: 80, right: 375, top: -2, bottom: 810 },
  { left: 80, right: 375, top: 770, bottom: 850 },
])('rejects composer actions outside the viewport: %o', (box) => {
  expect(() => checkNodeChatGeometry(box, null, viewport, () => false)).toThrow('viewport')
})
