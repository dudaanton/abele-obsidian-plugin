import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import QrCode from '@/components/obsidian/QrCode.vue'
import { readPhoto } from '@/transfer/photo'
import type { Rect } from '@/transfer/scan'
import { token } from './qrPhotoFixture'

it('finds a connection token beside an unrelated QR in the same full-image pass', async () => {
  const codes = [
    { text: 'https://example.org/sample', x: 200, y: 200, size: 300 },
    { text: token, x: 800, y: 400, size: 2400 },
  ].map((code) => {
    const view = mount(QrCode, { props: { text: code.text } })
    const side = Number(view.attributes('viewBox').split(' ')[2])
    const modules = new Uint8Array(side * side)
    for (const [, x, y] of view
      .get('path')
      .attributes('d')
      .matchAll(/M(\d+) (\d+)/g)) {
      modules[Number(y) * side + Number(x)] = 1
    }
    view.unmount()
    return { ...code, side, modules }
  })
  const draw = vi.fn((rect: Rect, size: { width: number; height: number }) => {
    const data = new Uint8ClampedArray(size.width * size.height * 4).fill(255)
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const px = rect.x + ((x + 0.5) * rect.width) / size.width
        const py = rect.y + ((y + 0.5) * rect.height) / size.height
        for (const code of codes) {
          const column = Math.floor(((px - code.x) * code.side) / code.size)
          const row = Math.floor(((py - code.y) * code.side) / code.size)
          if (column < 0 || row < 0 || column >= code.side || row >= code.side) continue
          if (!code.modules[row * code.side + column]) continue
          const index = (y * size.width + x) * 4
          data[index] = data[index + 1] = data[index + 2] = 0
        }
      }
    }
    return { ...size, data, colorSpace: 'srgb' } as ImageData
  })

  expect(await readPhoto(4032, 3024, draw, (text) => text === token)).toBe(token)
  expect(draw).toHaveBeenCalledTimes(1)
})
