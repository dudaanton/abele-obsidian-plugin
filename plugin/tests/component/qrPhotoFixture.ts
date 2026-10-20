import { mount } from '@vue/test-utils'
import jpeg from 'jpeg-js'
import QrCode from '@/components/obsidian/QrCode.vue'
import type { Rect } from '@/transfer/scan'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'

// Entirely synthetic. Punctuation in the fake scope exercises +, / and padding
// in standard base64; the key inside the JSON is separately base64url.
export const token = encodeAccessToken({
  v: 1,
  address: 'https://photo-sync.example.test',
  key: 'aB3_'.repeat(10) + 'abc',
  scope: { kind: 'folder', id: 'sample-shared-folder', path: '/Shared/Sample project >>??>>??x' },
})

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
export function photo(
  options: Photo,
  rect: Rect,
  size: { width: number; height: number }
): ImageData {
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
