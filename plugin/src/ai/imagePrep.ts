import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

const MAX_DIMENSION = 2048
const MAX_BYTES = 4 * 1024 * 1024 // 4 MB raw (before base64)

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

/** Fast base64 encoding from ArrayBuffer — chunk-based, no per-byte concat */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunks: string[] = []
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length))))
  }
  return btoa(chunks.join(''))
}

function getMime(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] || 'image/png'
}

/** Load an image element from a blob URL */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * Resize image if it exceeds dimension or byte limits.
 * Returns a JPEG data URL (smaller for photos).
 */
async function resizeImage(binary: ArrayBuffer, mime: string): Promise<string> {
  const blob = new Blob([binary], { type: mime })
  const url = URL.createObjectURL(blob)

  try {
    const img = await loadImage(url)
    let { naturalWidth: w, naturalHeight: h } = img

    const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h))
    w = Math.round(w * scale)
    h = Math.round(h * scale)

    const canvas = createEl('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)

    // JPEG for photos (much smaller), keep PNG for small/transparent images
    const useJpeg = binary.byteLength > 500_000 || scale < 1
    const outMime = useJpeg ? 'image/jpeg' : mime
    const quality = useJpeg ? 0.85 : undefined

    return canvas.toDataURL(outMime, quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Read a vault image and return a base64 data URL ready for the API.
 * Resizes large images to fit within API limits.
 */
export async function prepareImageForApi(path: string): Promise<string | null> {
  try {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return null

    const binary = await app.vault.readBinary(file)
    const ext = file.extension.toLowerCase()
    const mime = getMime(ext)

    // SVGs are text-based, send as-is (small)
    if (ext === 'svg') {
      return `data:${mime};base64,${arrayBufferToBase64(binary)}`
    }

    // Check if resize is needed
    const needsResize = binary.byteLength > MAX_BYTES
    if (!needsResize) {
      // Quick check dimensions via Image
      const blob = new Blob([binary], { type: mime })
      const url = URL.createObjectURL(blob)
      try {
        const img = await loadImage(url)
        if (img.naturalWidth <= MAX_DIMENSION && img.naturalHeight <= MAX_DIMENSION) {
          // Small enough — fast path, just encode
          return `data:${mime};base64,${arrayBufferToBase64(binary)}`
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    }

    // Needs resize
    console.debug(
      `Resizing image for API: ${path} (${(binary.byteLength / 1024 / 1024).toFixed(1)} MB)`
    )
    return await resizeImage(binary, mime)
  } catch (e) {
    console.error(`Failed to prepare image: ${path}`, e)
    return null
  }
}

/** Fast base64 encoding for reading vault images (no resize) */
export { arrayBufferToBase64, getMime }
