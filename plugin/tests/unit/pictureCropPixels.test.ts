import { afterEach, expect, it, vi } from 'vitest'
import { formatOf } from '@/drawing/imageInk'
import { flatten } from '@/drawing/imageInk'
import { turnPictureLeft, wholePicture } from '@/drawing/crop'
import { createCanvas, loadImage, Path2D } from '@napi-rs/canvas'
import { zoomAt } from '@/drawing/camera'

afterEach(() => vi.unstubAllGlobals())
it('turns the kept aspect with the frame, including after a mirror', () => {
  const state = { ...wholePicture(), aspect: '4:3' as const, flipped: true }
  expect(turnPictureLeft(state)).toMatchObject({ upright: true, turns: 3, flipped: true })
  expect(state.upright).toBe(false)
})
it('can zoom out a full resolution photo already below five percent', () => {
  expect(zoomAt({ x: 0, y: 0, zoom: 0.03 }, 100, 100, 0.5, 0.001).zoom).toBe(0.015)
})
const doc = {
  createElementNS: () => {
    const canvas = createCanvas(1, 1)
    Object.assign(canvas, {
      toBlob: (done: (blob: Blob) => void) =>
        done(new Blob([new Uint8Array(canvas.toBuffer('image/png'))])),
    })
    return canvas
  },
} as unknown as Document

it('writes HEIC copies as JPEG and never permits overwrite', () => {
  expect(formatOf('HEIC')).toEqual({ mime: 'image/jpeg', ext: 'jpg', sameKind: false })
})

it('does not add transparent pixels when a crop touches an odd-sized image edge', async () => {
  const source = createCanvas(3, 3)
  const ctx = source.getContext('2d')
  ctx.fillStyle = 'red'
  ctx.fillRect(0, 0, 3, 3)
  const blob = await flatten(doc, source as never, 3, 3, [], formatOf('png'), {
    ...wholePicture(),
    rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  })
  const image = await loadImage(Buffer.from(await blob.arrayBuffer()))
  const output = createCanvas(image.width, image.height)
  output.getContext('2d').drawImage(image, 0, 0)
  expect([image.width, image.height]).toEqual([2, 2])
  expect([...output.getContext('2d').getImageData(1, 1, 1, 1).data]).toEqual([255, 0, 0, 255])
})

it('clips the turned picture to the output bounds', async () => {
  const source = createCanvas(4, 2)
  const ctx = source.getContext('2d')
  ctx.fillStyle = 'red'
  ctx.fillRect(0, 0, 2, 2)
  ctx.fillStyle = 'blue'
  ctx.fillRect(2, 0, 2, 2)
  const blob = await flatten(doc, source as never, 4, 2, [], formatOf('png'), {
    ...wholePicture(),
    turns: 1,
    flipped: true,
    rect: { x: 0, y: 0, w: 1, h: 0.5 },
  })
  const output = await loadImage(Buffer.from(await blob.arrayBuffer()))
  expect([output.width, output.height]).toEqual([2, 2])
  const result = createCanvas(2, 2)
  result.getContext('2d').drawImage(output, 0, 0)
  expect([...result.getContext('2d').getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 255, 255])
})

for (const turns of [0, 1, 2, 3] as const)
  for (const flipped of [false, true]) {
    it(`keeps each synthetic pixel at its crop position after ${turns} turns, mirror ${flipped}`, async () => {
      const source = createCanvas(6, 4)
      const ctx = source.getContext('2d')
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 6; x++) {
          ctx.fillStyle = `rgb(${x * 40},${y * 60},100)`
          ctx.fillRect(x, y, 1, 1)
        }
      const blob = await flatten(doc, source as never, 6, 4, [], formatOf('png'), {
        ...wholePicture(),
        turns,
        flipped,
        rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
      })
      const image = await loadImage(Buffer.from(await blob.arrayBuffer()))
      const output = createCanvas(image.width, image.height)
      output.getContext('2d').drawImage(image, 0, 0)
      expect([image.width, image.height]).toEqual(turns % 2 ? [2, 3] : [3, 2])
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 6; x++) {
          let px = x,
            py = y,
            w = 6,
            h = 4
          for (let n = 0; n < turns; n++) {
            ;[px, py] = [py, w - 1 - px]
            ;[w, h] = [h, w]
          }
          if (flipped) px = w - 1 - px
          if (px < image.width && py < image.height) {
            expect([...output.getContext('2d').getImageData(px, py, 1, 1).data]).toEqual([
              x * 40,
              y * 60,
              100,
              255,
            ])
          }
        }
    })
  }

it('turns the ink with the picture and clips strokes crossing the crop boundary', async () => {
  vi.stubGlobal('Path2D', Path2D)
  const source = createCanvas(12, 8)
  const ctx = source.getContext('2d')
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, 12, 8)
  const blob = await flatten(
    doc,
    source as never,
    12,
    8,
    [
      {
        id: 'sample-line',
        type: 'shape',
        kind: 'line',
        x1: 1,
        y1: 4,
        x2: 11,
        y2: 4,
        color: 'black',
        size: 2,
      },
    ],
    formatOf('png'),
    { ...wholePicture(), turns: 1, rect: { x: 0, y: 0, w: 1, h: 0.5 } }
  )
  const image = await loadImage(Buffer.from(await blob.arrayBuffer()))
  const output = createCanvas(image.width, image.height)
  output.getContext('2d').drawImage(image, 0, 0)
  expect([image.width, image.height]).toEqual([8, 6])
  const ink = [...output.getContext('2d').getImageData(4, 2, 1, 1).data]
  expect(ink[0]).toBeLessThan(100)
  expect([...output.getContext('2d').getImageData(0, 2, 1, 1).data]).toEqual([255, 255, 255, 255])
})
