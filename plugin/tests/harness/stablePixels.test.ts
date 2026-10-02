import { expect, it } from 'vitest'
import { PIXEL_PROBE } from '../e2e/helpers/stablePixels'

type Capture = { pixels: Buffer; rect: number[]; pixelWidth: number }
const { stableCapture, pixelDifference } = new Function(
  `${PIXEL_PROBE}; return { stableCapture, pixelDifference }`
)() as {
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
