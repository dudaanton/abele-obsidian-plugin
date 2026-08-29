/**
 * Reading back what the other phone is showing.
 *
 * The picture in these tests is drawn from the very frames the sending side produces, so the
 * two halves are checked against each other rather than against a fixture: a change to how a
 * frame is written shows up here as a code that no longer reads.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import qr from 'qrcode-generator'
import { readCodes } from '@/transfer/scan'
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
