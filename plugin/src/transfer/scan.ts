/**
 * Reading QR codes out of a picture, wherever the picture came from — a camera frame, a photo
 * taken on the spot, a screenshot someone was sent.
 *
 * Chromium has a decoder built in, and Obsidian on the desktop and on Android is Chromium. On
 * an iPhone it is WebKit, which has none — and a phone is exactly what this feature is for, so
 * a decoder ships with the plugin for that case rather than the feature being desktop-only.
 */
import jsQR from 'jsqr'

interface DetectedBarcode {
  rawValue: string
}

interface BarcodeDetectorLike {
  detect(source: ImageData): Promise<DetectedBarcode[]>
}

type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike

const nativeDetector = (): BarcodeDetectorLike | null => {
  const ctor = (window as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  if (!ctor) return null

  try {
    return new ctor({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

/**
 * Every code in the picture, in whatever order the decoder found them.
 *
 * More than one matters: a series can be photographed as a grid of codes on one screen, and
 * the native decoder reads them all in a single pass. The bundled fallback reads one, and
 * refuses a picture holding more than one outright — which is why the sending side still shows
 * the codes one at a time.
 */
export async function readCodes(image: ImageData): Promise<string[]> {
  const detector = nativeDetector()

  if (detector) {
    try {
      const found = await detector.detect(image)
      if (found.length) return found.map((code) => code.rawValue)
    } catch {
      // A detector that throws on this frame is one frame lost, not a broken scan.
    }
  }

  const found = jsQR(image.data, image.width, image.height)
  return found ? [found.data] : []
}

/**
 * The most pixels a picture is worth reading at once.
 *
 * A phone photograph is twelve megapixels, and reading one means a canvas of it, then the
 * bytes of that canvas — fifty megabytes before the decoder has allocated anything of its own,
 * on a device that will refuse rather than swap. That refusal is silent: the context comes
 * back empty and the code "does not read", which is what one photograph in three was doing.
 * The code only needs a few pixels a module, and this is more than enough for that.
 */
export const READABLE_PIXELS = 1_500_000

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** How large to draw a picture — or a piece of one — before reading it. */
export function readableSize(width: number, height: number): { width: number; height: number } {
  const factor = Math.sqrt(READABLE_PIXELS / (width * height))
  if (factor >= 1) return { width, height }

  // Rounded down, so that "at most this many pixels" is true rather than nearly true.
  return { width: Math.floor(width * factor), height: Math.floor(height * factor) }
}

/** How much of a neighbouring square each one takes in, as a share of its own size. */
const OVERLAP = 0.2

/**
 * Squares of a picture to look at again when the whole of it gave nothing.
 *
 * A code that is a ninth of a photograph is a code that survives neither treatment on its own:
 * shrinking the whole picture enough to be readable costs it the resolution it needed, and
 * leaving it at full size is the fifty megabytes above. A square of the original, drawn at its
 * own size, gives the resolution back for a ninth of the memory.
 *
 * They overlap, because a photograph is never squared up with what it is a photograph of, and
 * a code cut in half by a boundary is one that reads in no square at all.
 */
export function closerLooks(width: number, height: number): Rect[] {
  const looks: Rect[] = []

  for (const divisions of [2, 3]) {
    const across = width / divisions
    const down = height / divisions

    for (let row = 0; row < divisions; row++) {
      for (let column = 0; column < divisions; column++) {
        const x = Math.max(0, Math.round((column - OVERLAP) * across))
        const y = Math.max(0, Math.round((row - OVERLAP) * down))

        looks.push({
          x,
          y,
          width: Math.min(width - x, Math.round(across * (1 + OVERLAP * 2))),
          height: Math.min(height - y, Math.round(down * (1 + OVERLAP * 2))),
        })
      }
    }
  }

  return looks
}
