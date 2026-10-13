import { expect, it } from 'vitest'
import { selectionDismissPoint } from '../e2e/helpers/selectionDismissPoint'

it('uses the visible part of a control clipped by a horizontally scrolling toolbar', () => {
  const control = document.createElement('button')
  const bar = document.createElement('div')
  bar.append(control)
  document.body.append(bar)
  control.getBoundingClientRect = () => new DOMRect(360, 700, 48, 44)
  bar.getBoundingClientRect = () => new DOMRect(0, 700, 393, 44)
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => control })
  expect(selectionDismissPoint(control, bar, 393, 852)).toEqual({ x: 376.5, y: 722 })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => bar })
  expect(selectionDismissPoint(control, bar, 393, 852)).toBeNull()
  control.remove()
  expect(selectionDismissPoint(control, bar, 393, 852)).toBeNull()
  bar.remove()
})
