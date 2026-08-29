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
 * the native decoder reads them all in a single pass. The bundled fallback reads one.
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
