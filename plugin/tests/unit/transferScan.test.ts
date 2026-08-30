/**
 * Reading back what the other phone is showing.
 *
 * The picture in these tests is drawn from the very frames the sending side produces, so the
 * two halves are checked against each other rather than against a fixture: a change to how a
 * frame is written shows up here as a code that no longer reads.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import qr from 'qrcode-generator'
import { readCodes, readableSize, closerLooks, READABLE_PIXELS } from '@/transfer/scan'
import { toFrames } from '@/transfer/frames'

/** The same picture a screen would show: dark modules, light plate, a quiet zone around it. */
function render(text: string, scale = 4, quiet = 4): ImageData {
  const code = qr(0, 'M')
  code.addData(text)
  code.make()

  const count = code.getModuleCount()
  const side = (count + quiet * 2) * scale
  const data = new Uint8ClampedArray(side * side * 4).fill(255)

  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (!code.isDark(row, column)) continue
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const pixel = (((row + quiet) * scale + y) * side + (column + quiet) * scale + x) * 4
          data[pixel] = 0
          data[pixel + 1] = 0
          data[pixel + 2] = 0
        }
      }
    }
  }

  return { data, width: side, height: side, colorSpace: 'srgb' } as ImageData
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reading a picture of a code', () => {
  it('reads back the frame that was drawn', async () => {
    const [frame] = toFrames(
      Uint8Array.from({ length: 200 }, (_, i) => i % 256),
      'ABCD'
    )

    await expect(readCodes(render(frame))).resolves.toEqual([frame])
  })

  it('reads a full-sized frame, not just a short one', async () => {
    const frames = toFrames(
      Uint8Array.from({ length: 1200 }, (_, i) => (i * 13) % 256),
      'WXYZ'
    )

    await expect(readCodes(render(frames[0]))).resolves.toEqual([frames[0]])
  })

  it('finds nothing in a picture with no code in it', async () => {
    const blank = {
      data: new Uint8ClampedArray(64 * 64 * 4).fill(255),
      width: 64,
      height: 64,
      colorSpace: 'srgb',
    } as ImageData

    await expect(readCodes(blank)).resolves.toEqual([])
  })
})

describe('when the engine brings its own decoder', () => {
  it('uses it, and takes every code it found', async () => {
    const detect = vi.fn().mockResolvedValue([{ rawValue: 'ONE' }, { rawValue: 'TWO' }])
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        detect = detect
      }
    )

    await expect(readCodes(render('ABL1:ABCD:1/1:AAAA'))).resolves.toEqual(['ONE', 'TWO'])
    expect(detect).toHaveBeenCalled()
  })

  /** One frame it could not read is one frame lost; the next one round is along in a moment. */
  it('falls back to the bundled one when it throws', async () => {
    const [frame] = toFrames(
      Uint8Array.from({ length: 100 }, (_, i) => i),
      'ABCD'
    )
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        detect = vi.fn().mockRejectedValue(new Error('no'))
      }
    )

    await expect(readCodes(render(frame))).resolves.toEqual([frame])
  })

  it('falls back when it is there but finds nothing', async () => {
    const [frame] = toFrames(
      Uint8Array.from({ length: 100 }, (_, i) => i),
      'ABCD'
    )
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        detect = vi.fn().mockResolvedValue([])
      }
    )

    await expect(readCodes(render(frame))).resolves.toEqual([frame])
  })
})

/**
 * A photograph of a screen full of codes.
 *
 * This is the case the whole feature turns on: a phone whose webview has no camera can only
 * take photos, and taking one photo per code is what made a real transfer unusable. Chromium's
 * own decoder reads every code in a picture; the bundled one reads a single code, so the
 * picture is looked at again square by square until they have all been found.
 */

/**
 * How much of a photograph is looked at, at a time.
 *
 * One code in three would not read off a phone that has no camera in its webview and could
 * only photograph them. A photograph is twelve megapixels: a canvas of it and the bytes of
 * that canvas come to fifty megabytes before the decoder has allocated anything, on a device
 * that refuses rather than swaps — and refuses silently, handing back a picture of nothing.
 * So the picture is drawn at a size a code is still legible at and no larger.
 */
describe('the size a picture is read at', () => {
  it('leaves a small one exactly as it is', () => {
    expect(readableSize(640, 480)).toEqual({ width: 640, height: 480 })
  })

  it('brings a phone photograph down to something a phone can hold', () => {
    const size = readableSize(4032, 3024)

    expect(size.width * size.height).toBeLessThanOrEqual(READABLE_PIXELS)
    // A code needs its modules to survive, which they do not if the picture is squashed.
    expect(size.width / size.height).toBeCloseTo(4032 / 3024, 2)
  })

  it('keeps enough of it for the modules of a code to survive', () => {
    const size = readableSize(4032, 3024)

    // A frame is 93 modules across; a code filling a third of the frame is still 4 px a module.
    expect(size.width / 3 / 93).toBeGreaterThan(3)
  })
})

describe('the squares looked at when the whole picture gave nothing', () => {
  const looks = () => closerLooks(4032, 3024)

  it('covers the picture in two grids, so a code has somewhere to sit whole', () => {
    expect(looks()).toHaveLength(2 * 2 + 3 * 3)
  })

  it('stays inside the picture, wherever the square would have run over the edge', () => {
    for (const look of looks()) {
      expect(look.x).toBeGreaterThanOrEqual(0)
      expect(look.y).toBeGreaterThanOrEqual(0)
      expect(look.x + look.width).toBeLessThanOrEqual(4032)
      expect(look.y + look.height).toBeLessThanOrEqual(3024)
    }
  })

  /** A code cut in half by a boundary reads in no square at all, so the squares overlap. */
  it('overlaps its neighbours rather than tiling the picture exactly', () => {
    const across = looks().filter((look) => look.y === 0 && look.height > 0)
    const covered = across.reduce((sum, look) => sum + look.width, 0)

    expect(covered).toBeGreaterThan(4032)
  })

  it('leaves each square small enough to be worth drawing at its own size', () => {
    for (const look of looks()) {
      expect(readableSize(look.width, look.height).width).toBeLessThanOrEqual(look.width)
    }
  })
})
