import { afterEach, expect, it } from 'vitest'
import { reviewWindowOverflow } from '../e2e/helpers/reviewWindowOverflow'

afterEach(() => document.body.replaceChildren())
const box = (el: HTMLElement, left: number, right: number) => {
  el.getBoundingClientRect = () => ({ left, right, width: right - left }) as DOMRect
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: right - left })
}
it.each(['hidden', 'clip'])('measures text through an ancestor with overflow %s', (overflow) => {
  const root = document.createElement('div')
  const parent = document.createElement('span')
  const text = document.createElement('bdi')
  root.append(parent)
  parent.append(text)
  document.body.append(root)
  box(root, 20, 320)
  box(parent, 30, 300)
  box(text, -200, 500)
  parent.style.overflowX = overflow
  expect(reviewWindowOverflow(root)).toEqual([])
  parent.style.overflowX = 'visible'
  expect(reviewWindowOverflow(root)).not.toEqual([])
})
it('still rejects an oversized clipping container itself', () => {
  const root = document.createElement('div'),
    child = document.createElement('div')
  root.append(child)
  document.body.append(root)
  box(root, 20, 320)
  box(child, 30, 500)
  child.style.overflowX = 'hidden'
  expect(reviewWindowOverflow(root)).not.toEqual([])
})

it('includes clipping between the measured content and its modal', () => {
  const modal = document.createElement('div')
  modal.className = 'modal'
  const clip = document.createElement('div'),
    root = document.createElement('div')
  modal.append(clip)
  clip.append(root)
  document.body.append(modal)
  box(modal, 20, 320)
  box(clip, 30, 300)
  box(root, -100, 500)
  clip.style.overflowX = 'hidden'
  expect(reviewWindowOverflow(root)).toEqual([])
  clip.style.overflowX = 'visible'
  expect(reviewWindowOverflow(root)).not.toEqual([])
})
