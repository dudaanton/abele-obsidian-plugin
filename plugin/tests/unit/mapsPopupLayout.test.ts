import { expect, it } from 'vitest'
import { popupLayout } from '@/maps/core/popupLayout'

it('keeps a long popup within a narrow pane at either edge and chooses the roomier vertical side', () => {
  for (const x of [5, 246, 330]) {
    const result = popupLayout({ width: 336, height: 672 }, { x, y: 240 })
    expect(result.left).toBeGreaterThanOrEqual(0)
    expect(result.left + result.width).toBeLessThanOrEqual(336)
    expect(result.anchor.startsWith('top')).toBe(true)
    expect(Math.abs(result.offset[0])).toBeLessThanOrEqual(18)
  }
  expect(
    popupLayout({ width: 336, height: 672 }, { x: 100, y: 600 }).anchor.startsWith('bottom')
  ).toBe(true)
})
