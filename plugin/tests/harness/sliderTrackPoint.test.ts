import { expect, it } from 'vitest'
import { sliderTrackPoint } from '../e2e/helpers/sliderTrackPoint'

it.each([0, 0.5, 1])('starts on actual track with the thumb at fraction %s', (fraction) => {
  const left = 40,
    width = 240,
    thumb = 36
  const center = left + thumb / 2 + fraction * (width - thumb)
  for (const preferred of [left + width * 0.1, left + width * 0.9]) {
    const point = sliderTrackPoint(left, width, center, thumb, preferred)
    expect(point).toBeGreaterThan(left)
    expect(point).toBeLessThan(left + width)
    expect(Math.abs(point - center)).toBeGreaterThan(thumb / 2 + 4)
    if (Math.abs(preferred - center) > thumb / 2 + 4) expect(point).toBe(preferred)
  }
})
