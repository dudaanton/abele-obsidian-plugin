import { describe, expect, it } from 'vitest'
import { editableTapPoints } from '../helpers/editableTapPoints'

describe('editable tap-area sampling', () => {
  it('still probes the corners of a square field', () => {
    const points = editableTapPoints({ left: 10, top: 20, width: 320, height: 128 }, [
      '0px',
      '0px',
      '0px',
      '0px',
    ])
    expect(points).toContainEqual([12, 22])
    expect(points).toContainEqual([328, 146])
    expect(points).toHaveLength(9)
  })

  it.each([
    ['999px', 64, 64],
    ['50% 50%', 160, 64],
  ] as const)('respects CSS radius normalization for %s', (radius, rx, ry) => {
    const points = editableTapPoints(
      { left: 0, top: 0, width: 320, height: 128 },
      Array(4).fill(radius)
    )
    for (const [x, y] of points) {
      const cx = Math.max(rx, Math.min(320 - rx, x))
      const cy = Math.max(ry, Math.min(128 - ry, y))
      expect(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2).toBeLessThan(1)
    }
  })

  it('keeps every point inside the clipped phone input corners', () => {
    const points = editableTapPoints({ left: 10, top: 20, width: 320, height: 128 }, [
      '40px',
      '40px',
      '40px',
      '40px',
    ])
    for (const [x, y] of points) {
      const cx = Math.max(50, Math.min(290, x))
      const cy = Math.max(60, Math.min(108, y))
      expect(Math.hypot(x - cx, y - cy)).toBeLessThan(40)
    }
    // Still sample the narrow strips beside the text and above/below it.
    expect(points).toContainEqual([12, 84])
    expect(points).toContainEqual([328, 84])
    expect(points).toContainEqual([170, 22])
    expect(points).toContainEqual([170, 146])
  })
})
