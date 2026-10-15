import { mount } from '@vue/test-utils'
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import jpeg from 'jpeg-js'
import QrCode from '@/components/obsidian/QrCode.vue'
import { readPhoto } from '@/transfer/photo'
import type { Rect } from '@/transfer/scan'

// A photo scan must remain available offline, including the initial WASM load.
beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'))
})
afterAll(() => {
  vi.restoreAllMocks()
})

// Invented payload with the length and alphabet of a connection token.
const token = Array.from(
  { length: 270 },
  (_, i) =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[(i * 37 + i * i) % 64]
).join('')
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
interface Photo {
  name: string
  level?: 'L' | 'M' | 'Q' | 'H'
  fraction?: number
  tilt?: number
  rotate?: number
  inverted?: boolean
  glare?: number
  screen?: number
  contrast?: number
  jpeg?: boolean
  downscale?: number
  centreX?: number
  centreY?: number
}

// The component's actual modules, projected from a 12 MP frame to the reader's
// working resolution. Subpixel samples model slight blur and camera resampling.
function photo(options: Photo, rect: Rect, size: { width: number; height: number }): ImageData {
  const wrapper = mount(QrCode, { props: { text: token, level: options.level ?? 'M' } })
  const side = Number(wrapper.attributes('viewBox').split(' ')[2])
  const modules = new Set(
    [
      ...wrapper
        .find('path')
        .attributes('d')
        .matchAll(/M(\d+) (\d+)/g),
    ].map(([, x, y]) => `${x},${y}`)
  )
  wrapper.unmount()
  const { width, height } = size
  const data = new Uint8ClampedArray(width * height * 4)
  // A desktop SVG displayed at 480 CSS pixels, rather than infinitely sharp modules.
  const displaySide = 480
  const display = new Uint8Array(displaySide * displaySide)
  for (let y = 0; y < displaySide; y++)
    for (let x = 0; x < displaySide; x++) {
      display[y * displaySide + x] = modules.has(
        `${Math.floor((x * side) / displaySide)},${Math.floor((y * side) / displaySide)}`
      )
        ? 20
        : 235
    }
  const sample = (x: number, y: number) =>
    x < 0 || y < 0 || x >= displaySide || y >= displaySide ? 235 : display[y * displaySide + x]
  const codeSize = 4032 * (options.fraction ?? 0.4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let value = 0
      for (const offset of [-0.3, 0.3]) {
        const step = options.downscale ?? 1
        let u =
          (Math.round((rect.x + ((x + offset) * rect.width) / width) / step) * step -
            4032 * (options.centreX ?? 0.5)) /
          codeSize
        let v =
          (Math.round((rect.y + ((y + offset) * rect.height) / height) / step) * step -
            3024 * (options.centreY ?? 0.5)) /
          codeSize
        const denominator = 1 + (options.tilt ?? 0) * v * 2
        u /= denominator
        v /= denominator
        for (let turn = 0; turn < (options.rotate ?? 0); turn++) [u, v] = [-v, u]
        const sx = (u + 0.5) * displaySide,
          sy = (v + 0.5) * displaySide
        const ix = Math.floor(sx),
          iy = Math.floor(sy),
          fx = sx - ix,
          fy = sy - iy
        let light =
          sample(ix, iy) * (1 - fx) * (1 - fy) +
          sample(ix + 1, iy) * fx * (1 - fy) +
          sample(ix, iy + 1) * (1 - fx) * fy +
          sample(ix + 1, iy + 1) * fx * fy
        if (options.inverted) light = 255 - light
        light = 125 + (light - 125) * (options.contrast ?? 1)
        light += (options.glare ?? 0) * Math.exp(-((u - 0.1) ** 2 + (v + 0.1) ** 2) * 5)
        light += (options.screen ?? 0) * Math.sin(x * 2.4) * Math.sin(y * 1.8)
        value += Math.min(255, Math.max(0, light)) / 2
      }
      const index = (y * width + x) * 4
      data[index] = data[index + 1] = data[index + 2] = value
      data[index + 3] = 255
    }
  if (options.jpeg) {
    const decoded = jpeg.decode(jpeg.encode({ data, width, height }, 65).data)
    return { data: new Uint8ClampedArray(decoded.data), width, height } as ImageData
  }
  return { data, width, height } as ImageData
}

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
