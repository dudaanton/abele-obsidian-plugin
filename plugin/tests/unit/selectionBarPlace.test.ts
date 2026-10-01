/** Where the bar over selected words goes, clear of the handles and the system's own menu. */
import { describe, it, expect } from 'vitest'
import { CALLOUT_CLEARANCE, HANDLE_CLEARANCE, placeSelectionBar } from '@/helpers/selectionBarPlace'

const bar = { width: 100, height: 30 }

describe('with a finger', () => {
  it('can reserve the native callout below a near-top chat selection', () => {
    const at = placeSelectionBar({ top: 100, bottom: 140, left: 20 }, bar, { width: 390 }, true, { calloutBelow: true })
    expect(at.top).toBe(140 + HANDLE_CLEARANCE + CALLOUT_CLEARANCE)
  })
  it('goes under the words, clear of the end handle', () => {
    const at = placeSelectionBar({ top: 100, bottom: 140, left: 20 }, bar, { width: 390 }, true)
    expect(at).toEqual({ top: 140 + HANDLE_CLEARANCE, left: 20 })
  })

  it('goes above, over the system menu, when there is no room below', () => {
    const words = { top: 500, bottom: 580, left: 20 }
    const at = placeSelectionBar(words, bar, { width: 390, top: 0, bottom: 600 }, true)
    expect(at.top).toBe(500 - 30 - CALLOUT_CLEARANCE)
  })

  it('words filling the whole view: at its bottom edge', () => {
    const words = { top: 10, bottom: 590, left: 20 }
    const at = placeSelectionBar(words, bar, { width: 390, top: 0, bottom: 600 }, true)
    expect(at.top).toBeLessThanOrEqual(600 - 30)
    expect(at.top).toBeGreaterThan(500)
  })

  it('stays inside the width', () => {
    const at = placeSelectionBar({ top: 100, bottom: 140, left: 350 }, bar, { width: 390 }, true)
    expect(at.left).toBe(290)
  })
})

describe('with a mouse', () => {
  it('sits just above the words, or below them at the top', () => {
    expect(
      placeSelectionBar({ top: 100, bottom: 140, left: 0 }, bar, { width: 390 }, false).top
    ).toBe(64)
    expect(
      placeSelectionBar({ top: 10, bottom: 40, left: 0 }, bar, { width: 390 }, false).top
    ).toBe(46)
  })
})
