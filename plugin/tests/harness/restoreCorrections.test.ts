import { describe, expect, it } from 'vitest'
import { correctiveScrollFrames } from '../e2e/helpers/restoreCorrections'

describe('visible restore corrections', () => {
  it('does not count retry calls that leave the scroll viewport unchanged', () => {
    expect(correctiveScrollFrames([1, 3, 5, 7], [0, 90, 90, 90, 90, 90, 90, 90])).toEqual([1])
  })
  it('counts a restore applied in the renderer measurement frame after the request', () => {
    expect(correctiveScrollFrames([1], [0, 0, 90, 90])).toEqual([2])
  })
  it('keeps subsequent corrections but does not count native render anchoring without a request', () => {
    expect(correctiveScrollFrames([1, 5], [0, 90, 90, 95, 95, 105, 105])).toEqual([1, 5])
  })
  it('keeps an early pre-sample restore and never attributes arbitrarily late movement to it', () => {
    expect(correctiveScrollFrames([-1], [90, 90, 90, 100])).toEqual([0])
    expect(correctiveScrollFrames([0], [0, 0, 0, 0, 100])).toEqual([])
  })
})
