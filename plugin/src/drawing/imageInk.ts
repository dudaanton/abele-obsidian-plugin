/**
 * Drawing on a picture: what the picture comes out as once drawn on. The ink is flattened onto
 * the picture at the picture's own size, in its own format where that can be written — PNG, JPEG,
 * WebP — so saving over it keeps it the kind of file it was. HEIC copies become JPEG; other
 * unsupported output formats become PNG.
 */
import { paintItems } from './renderer'
import type { DrawingItem } from './items'
import { croppedSize, orientPicture, wholePicture, type CropState } from './crop'

export interface PictureFormat {
  mime: string
  ext: string
  /** The drawn picture can take the original's place: the same kind of file. */
  sameKind: boolean
}

/** What a picture with an extension is written as once drawn on. */
export function formatOf(extension: string): PictureFormat {
  const ext = extension.toLowerCase()
  if (ext === 'heic' || ext === 'heif') return { mime: 'image/jpeg', ext: 'jpg', sameKind: false }
  if (ext === 'jpg' || ext === 'jpeg') return { mime: 'image/jpeg', ext, sameKind: true }
  if (ext === 'webp') return { mime: 'image/webp', ext, sameKind: true }
  return { mime: 'image/png', ext: 'png', sameKind: ext === 'png' }
}

/** The name a drawn copy of a picture goes by, beside it: free, `drawn`, then numbered. */
export function drawnPath(
  dir: string,
  basename: string,
  ext: string,
  taken: (p: string) => boolean
) {
  const base = `${dir}${basename} drawn`
  for (let n = 1; ; n++) {
    const path = `${base}${n > 1 ? ` ${n}` : ''}.${ext}`
    if (!taken(path)) return path
  }
}

/** The picture with the ink on it, at the picture's own size. */
export function flatten(
  doc: Document,
  image: CanvasImageSource,
  width: number,
  height: number,
  items: readonly DrawingItem[],
  format: PictureFormat,
  crop: CropState = wholePicture()
): Promise<Blob> {
  const size = croppedSize(crop, width, height)
  let canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(Math.max(1, size.width), Math.max(1, size.height))
      : (doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement)
  canvas.width = Math.max(1, size.width)
  canvas.height = Math.max(1, size.height)
  let ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx && 'convertToBlob' in canvas) {
    canvas = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement
    canvas.width = Math.max(1, size.width)
    canvas.height = Math.max(1, size.height)
    ctx = canvas.getContext('2d')
  }
  if (!ctx) return Promise.reject(new Error('No 2D canvas'))
  // A JPEG has no see-through: what was see-through becomes white, as paper.
  if (format.mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  const shownW = crop.turns % 2 ? height : width
  const shownH = crop.turns % 2 ? width : height
  // Rounded dimensions and origin must still fit together at the far edge of an odd-sized photo.
  const x = Math.max(0, Math.min(shownW - canvas.width, Math.round(crop.rect.x * shownW)))
  const y = Math.max(0, Math.min(shownH - canvas.height, Math.round(crop.rect.y * shownH)))
  ctx.translate(-x, -y)
  orientPicture(ctx, width, height, crop, shownW / 2, shownH / 2)
  ctx.drawImage(image, 0, 0, width, height)
  paintItems(ctx, items, { x: 0, y: 0, w: width, h: height }, 1)
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: format.mime, quality: 0.92 })
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No picture'))),
      format.mime,
      format.mime === 'image/png' ? undefined : 0.92
    )
  )
}
