import { expect, it } from 'vitest'
import { PIXEL_PROBE } from '../e2e/helpers/stablePixels'

type Capture = { pixels: Buffer; rect: number[]; pixelWidth: number }
const { stableCapture, pixelDifference, viewportRasterCrop } = new Function(
  `${PIXEL_PROBE}; return { stableCapture, pixelDifference, viewportRasterCrop: typeof viewportRasterCrop === 'undefined' ? undefined : viewportRasterCrop }`
)() as {
  viewportRasterCrop: (
    size: { width: number; height: number },
    viewport: { width: number; height: number },
    rect: { x: number; y: number; width: number; height: number }
  ) => { x: number; y: number; width: number; height: number }
  stableCapture: (
    capture: () => Promise<Capture>,
    frame: () => Promise<void>,
    limit?: number
  ) => Promise<Capture>
  pixelDifference: (
    before: Capture,
    after: Capture
  ) => { count: number; coordinates: { x: number; y: number; before: number[]; after: number[] }[] }
}
const shot = (value: number, left = 10): Capture => ({
  pixels: Buffer.from([value, 0, 0, 255]),
  rect: [left, 20, 1, 1],
  pixelWidth: 1,
})

it.each([1, 2])('maps CSS viewport coordinates into a %sx screenshot raster', (scale) => {
  expect(
    viewportRasterCrop(
      { width: 400 * scale, height: 800 * scale },
      { width: 400, height: 800 },
      { x: 24, y: 484, width: 342, height: 159 }
    )
  ).toEqual({ x: 24 * scale, y: 484 * scale, width: 342 * scale, height: 159 * scale })
})

it('rejects offscreen crops instead of comparing clipped or empty rasters', () => {
  expect(() =>
    viewportRasterCrop(
      { width: 800, height: 1600 },
      { width: 400, height: 800 },
      { x: 24, y: 750, width: 342, height: 159 }
    )
  ).toThrow('outside the viewport')
})

it('waits through geometry and raster churn for three identical frame captures', async () => {
  const samples = [shot(1, 9), shot(2), shot(3), shot(3), shot(3)]
  let frames = 0
  const result = await stableCapture(
    async () => samples.shift()!,
    async () => {
      frames++
    }
  )
  expect(result).toEqual(shot(3))
  expect(frames).toBe(5)
})

it('fails rather than selecting the best comparison when frames never settle', async () => {
  let n = 0
  await expect(
    stableCapture(
      async () => shot(n++),
      async () => {},
      4
    )
  ).rejects.toThrow('raster did not settle')
})

it('records exact pixel coordinates and channels without tolerating a one-pixel change', () => {
  const before = {
    pixels: Buffer.from([0, 0, 0, 255, 1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255]),
    rect: [10, 20, 2, 2],
    pixelWidth: 2,
  }
  const after = { ...before, pixels: Buffer.from(before.pixels) }
  after.pixels[8] = 5
  expect(pixelDifference(before, after)).toEqual({
    count: 1,
    coordinates: [{ x: 0, y: 1, before: [4, 5, 6, 255], after: [5, 5, 6, 255] }],
  })
  expect(pixelDifference(before, before).count).toBe(0)
})
