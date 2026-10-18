import { expect, it } from 'vitest'
import { distance } from '@/maps/core/distance'

it('measures zero and ordinary straight-line distances in metres', () => {
  expect(distance({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0)
  expect(distance({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111194.9266, 2)
})
it('keeps antipodal distances finite despite floating-point rounding', () => {
  expect(distance({ lat: -87.5, lon: 0 }, { lat: 87.5, lon: 180 })).toBeCloseTo(
    Math.PI * 6_371_000,
    2
  )
})
