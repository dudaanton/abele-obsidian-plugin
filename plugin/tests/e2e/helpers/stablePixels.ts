/** Page-side screenshot helpers; stability does not change the zero-difference assertion. */
export const PIXEL_PROBE = `
  const pixelDifference = (before, after) => {
    if (before.pixels.length !== after.pixels.length || before.pixelWidth !== after.pixelWidth)
      return { count: -1, coordinates: [] }
    let count = 0
    const coordinates = []
    for (let i = 0; i < before.pixels.length; i += 4) {
      if (!before.pixels.subarray(i, i + 4).equals(after.pixels.subarray(i, i + 4))) {
        count++
        if (coordinates.length < 100) coordinates.push({
          x: (i / 4) % before.pixelWidth, y: Math.floor(i / 4 / before.pixelWidth),
          before: [...before.pixels.subarray(i, i + 4)], after: [...after.pixels.subarray(i, i + 4)],
        })
      }
    }
    return { count, coordinates }
  }
  const stableCapture = async (capture, frame, limit = 30) => {
    let previous, same = 0
    for (let i = 0; i < limit; i++) {
      await frame()
      const current = await capture()
      same = previous && JSON.stringify(current.rect) === JSON.stringify(previous.rect) &&
        pixelDifference(previous, current).count === 0 ? same + 1 : 1
      if (same >= 3) return current
      previous = current
    }
    throw Error('timeline raster did not settle over ' + limit + ' frames')
  }
`
