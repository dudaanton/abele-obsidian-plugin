import { describe, expect, it } from 'vitest'
import { outwardBoxShadowReach } from '../helpers/focusRingPaint'

describe('outward box-shadow paint in focus probes', () => {
  it.each([
    ['none', 0],
    ['', 0],
    ['rgba(0, 0, 0, 0.07) 0px 4px 10px 0px inset', 0],
    ['inset 0px 0px 12px 3px rgb(10, 20, 30)', 0],
    ['0px 0px 3px 2px rgba(10, 20, 30, 0.4)', 5],
    ['rgb(10, 20, 30) 0px 0px 0px 4px', 4],
    ['0px 0px 6px', 6],
    ['0px 0px', 0],
    ['0px 0px 2.5px 1.5px #123456', 4],
    // Preserve the probes' existing conservative, separately clamped blur/spread estimate.
    ['0px 0px 8px -2px black', 8],
    ['rgba(0, 0, 0, 0.07) 0px 4px 10px 0px inset, 0px 0px 0px 4px rgba(1, 2, 3, 0.5)', 4],
    ['0px 0px 0px 4px rgba(1, 2, 3, 0.5), rgba(0, 0, 0, 0.07) 0px 4px 10px 0px inset', 4],
    ['inset 0px 0px 20px 4px black, 0px 0px 1px 1px red, 0px 0px 3px 2px blue', 5],
    ['0px 0px 1px 1px rgba(1, 2, 3, 0.5), 0px 0px 3px 4px rgb(4, 5, 6)', 7],
    ['inset 0px 0px 12px 3px black, inset 0px 0px 20px 4px white', 0],
    ['color(srgb 0.1 0.2 0.3 / 0.5) 0px 0px 2px 3px, 0px 0px 4px 3px black', 7],
  ])('%s has %s px of outward reach', (shadow, reach) => {
    expect(outwardBoxShadowReach(shadow)).toBe(reach)
  })
})
