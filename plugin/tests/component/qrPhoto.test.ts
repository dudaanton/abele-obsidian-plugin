import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { readPhoto } from '@/transfer/photo'
import { token, photo } from './qrPhotoFixture'
import { decodeAccessToken } from '@/sync/v2/client'

// A photo scan must remain available offline, including the initial WASM load.
beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'))
})
afterAll(() => {
  vi.restoreAllMocks()
})

it('uses a photo payload accepted by connection-token validation', () => {
  expect(() => decodeAccessToken(token)).not.toThrow()
  expect(token).toHaveLength(268)
  expect(token).toContain('+')
  expect(token).toContain('/')
  expect(token).toMatch(/=$/)
})
const cases = [
  { name: '60 percent', fraction: 0.6 },
  { name: '15 percent', fraction: 0.15 },
  { name: 'perspective left', tilt: -0.34 },
  { name: 'perspective right', tilt: 0.34 },
  { name: 'quarter turn', rotate: 1 },
  { name: 'half turn', rotate: 2 },
  { name: 'inverted display', inverted: true },
  { name: 'screen door and moire', screen: 35 },
  { name: 'glare and low contrast', glare: 100, contrast: 0.18 },
  { name: 'deep shade with uneven light', glare: 70, contrast: 0.04 },
  { name: 'JPEG photo', jpeg: true, screen: 15, tilt: 0.18 },
  { name: 'HEIC-like resampling', downscale: 3, tilt: -0.2 },
  { name: 'off-centre small code', fraction: 0.15, centreX: 0.22, centreY: 0.28 },
]
describe.each(['L', 'M', 'Q', 'H'] as const)('connection QR screen photographs (%s)', (level) => {
  it.each(cases)(
    '$name',
    async (options) => {
      let drawingMs = 0
      const start = performance.now()
      expect(
        await readPhoto(
          4032,
          3024,
          (rect, size) => {
            const drawingStart = performance.now()
            const image = photo({ ...options, level }, rect, size)
            drawingMs += performance.now() - drawingStart
            return image
          },
          (text) => text === token
        )
      ).toBe(token)
      console.log(
        `${options.name}: ${Math.round(performance.now() - start - drawingMs)} ms decoding`
      )
    },
    15000
  )
})

it('stops starting crops after the shared time budget expires', async () => {
  const clock = vi
    .spyOn(performance, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValue(1200)
  const draw = vi.fn(
    () =>
      ({ width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) }) as ImageData
  )
  try {
    expect(await readPhoto(4032, 3024, draw, () => true)).toBeNull()
    expect(draw).toHaveBeenCalledTimes(1)
  } finally {
    clock.mockRestore()
  }
})

it('bounds blank-picture attempts even with a frozen clock', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
  const draw = vi.fn(
    () =>
      ({ width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) }) as ImageData
  )
  try {
    expect(await readPhoto(4032, 3024, draw, () => true)).toBeNull()
    expect(draw).toHaveBeenCalledTimes(15)
  } finally {
    clock.mockRestore()
  }
})
