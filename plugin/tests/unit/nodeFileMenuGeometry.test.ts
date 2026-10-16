import { describe, expect, it } from 'vitest'
import { checkNodeFileMenuGeometry } from '../helpers/nodeFileMenuGeometry'

const viewport = { width: 390, height: 844 }
describe('native file menu geometry', () => {
  it('accepts the settled native phone sheet at the bottom rather than beside the pointer', () => {
    expect(() =>
      checkNodeFileMenuGeometry({ left: 0, right: 390, top: 540, bottom: 844 }, viewport, 200, true)
    ).not.toThrow()
  })
  it('rejects a phone sheet still entering from below the viewport', () => {
    expect(() =>
      checkNodeFileMenuGeometry(
        { left: 0, right: 390, top: 840, bottom: 1144 },
        viewport,
        200,
        true
      )
    ).toThrow('escapes the viewport')
  })
  it.each([
    { left: -10, right: 200, top: 200, bottom: 400 },
    { left: 200, right: 400, top: 200, bottom: 400 },
    { left: 100, right: 300, top: -10, bottom: 200 },
    { left: 100, right: 300, top: 700, bottom: 900 },
  ])('rejects overflow at every viewport edge', (menu) => {
    for (const phone of [false, true])
      expect(() => checkNodeFileMenuGeometry(menu, viewport, 200, phone)).toThrow(
        'escapes the viewport'
      )
  })
  it.each([
    { left: 100, right: 300, top: 202, bottom: 402 },
    { left: 100, right: 300, top: 2, bottom: 202 },
  ])('accepts a desktop menu below or flipped above the pointer', (menu) => {
    expect(() => checkNodeFileMenuGeometry(menu, viewport, 200, false)).not.toThrow()
  })
  it('rejects a detached desktop menu and a phone sheet away from the bottom', () => {
    const menu = { left: 0, right: 390, top: 200, bottom: 500 }
    expect(() => checkNodeFileMenuGeometry(menu, viewport, 50, false)).toThrow('detached')
    expect(() => checkNodeFileMenuGeometry(menu, viewport, 200, true)).toThrow('bottom')
  })
})
