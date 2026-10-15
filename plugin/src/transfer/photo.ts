import { readableSize, closerLooks, type Rect } from './scan'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url&inline'

let prepared = false

/** Photo decoding includes adaptive binarisation, rotated and inverted codes. */
export async function readPhotoCodes(image: ImageData): Promise<string[]> {
  if (!prepared) {
    // Decode the bundled bytes only on first use. No CDN or network is needed.
    prepareZXingModule({
      overrides: {
        wasmBinary: Uint8Array.from(atob(wasmUrl.split(',')[1]), (character) =>
          character.charCodeAt(0)
        ).buffer,
      },
    })
    prepared = true
  }
  const options = {
    formats: ['QRCode' as const],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    downscaleFactor: 2,
    downscaleThreshold: 400,
    maxNumberOfSymbols: 1,
  }
  const found = await readBarcodes(image, options)
  if (found.length) return found.map((code) => code.text)
  const luminance = new Uint8ClampedArray(image.width * image.height)
  for (let i = 0; i < luminance.length; i++) {
    luminance[i] = (image.data[i * 4] + 2 * image.data[i * 4 + 1] + image.data[i * 4 + 2]) / 4
  }
  const pixels = localContrast(luminance, image.width, image.height)
  const data = new Uint8ClampedArray(image.data.length)
  for (let i = 0; i < pixels.length; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = pixels[i]
    data[i * 4 + 3] = 255
  }
  return (
    await readBarcodes(
      { data, width: image.width, height: image.height, colorSpace: image.colorSpace },
      options
    )
  ).map((code) => code.text)
}

/** Subtract local illumination before amplification, so glare cannot set the
 * threshold for a shaded part of the code. Integral sums keep this linear. */
function localContrast(pixels: Uint8ClampedArray, width: number, height: number) {
  const stride = width + 1
  const sums = new Uint32Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += pixels[y * width + x]
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row
    }
  }
  const output = new Uint8ClampedArray(pixels.length)
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - 16),
      bottom = Math.min(height, y + 17)
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - 16),
        right = Math.min(width, x + 17)
      const mean =
        (sums[bottom * stride + right] -
          sums[top * stride + right] -
          sums[bottom * stride + left] +
          sums[top * stride + left]) /
        ((bottom - top) * (right - left))
      output[y * width + x] = 128 + (pixels[y * width + x] - mean) * 6
    }
  }
  return output
}

/** Canvas drawing is supplied by the client; no full-resolution RGBA photo is
 * allocated here. One time budget covers every crop, not each decoder call. */
export async function readPhoto(
  width: number,
  height: number,
  draw: (rect: Rect, size: { width: number; height: number }) => ImageData,
  accepts: (text: string) => boolean
): Promise<string | null> {
  const started = performance.now()
  const looks = [
    { x: 0, y: 0, width, height },
    { x: width / 4, y: height / 4, width: width / 2, height: height / 2 },
    ...closerLooks(width, height),
  ]
  for (const look of looks) {
    if (performance.now() - started >= 1200) break
    const image = draw(look, readableSize(look.width, look.height))
    for (const text of await readPhotoCodes(image)) if (accepts(text)) return text
    // Give the phone a frame to paint the busy state between bounded attempts.
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  }
  return null
}
