import { expect, it } from 'vitest'
import { readingPositionReachable, drawersClosed } from '../e2e/helpers/readerGestureReadiness'

it('waits for rendered space below the paragraph, even when its source has arrived', () => {
  // At the current end, a requested 193px movement would be clamped to no movement.
  const box = { scrollTop: 688, scrollHeight: 1388, clientHeight: 700 }
  expect(readingPositionReachable(box, 233, 40)).toBe(false)
  box.scrollHeight += 200
  expect(readingPositionReachable(box, 233, 40)).toBe(true)
})

it('waits for the closing drawer backdrop to leave before starting the opposite swipe', () => {
  const drawer = { collapsed: true, backdropEl: { isConnected: true } }
  expect(drawersClosed([drawer])).toBe(false)
  drawer.backdropEl.isConnected = false
  expect(drawersClosed([drawer])).toBe(true)
  drawer.collapsed = false
  expect(drawersClosed([drawer])).toBe(false)
})
