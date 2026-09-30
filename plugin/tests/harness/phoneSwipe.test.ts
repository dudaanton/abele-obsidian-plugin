import { describe, expect, it } from 'vitest'
import { swipeDriverArgs } from '../e2e/helpers/phone'

describe('physical swipe driver requests', () => {
  it('keeps the default swipe command unchanged', () => {
    expect(swipeDriverArgs(10, 20, 10, 100)).toEqual(['swipe', '10', '20', '10', '100'])
  })

  it('passes explicit velocity through the driver gesture endpoint for a slow measured pan', () => {
    expect(swipeDriverArgs(10, 20, 10, 100, 160)).toEqual([
      'call',
      '/swipe',
      JSON.stringify({ x1: 10, y1: 20, x2: 10, y2: 100, velocity: 160 }),
    ])
  })
})
