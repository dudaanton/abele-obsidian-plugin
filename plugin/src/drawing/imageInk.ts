/**
 * Drawing on a picture: what the picture comes out as once drawn on. The ink is flattened onto
 * the picture at the picture's own size, in its own format where that can be written — PNG, JPEG,
 * WebP — so saving over it keeps it the kind of file it was; any other picture comes out a PNG.
 */
import { paintItems } from './renderer'
import type { DrawingItem } from './items'

export interface PictureFormat {
  mime: string
  ext: string
  /** The drawn picture can take the original's place: the same kind of file. */
  sameKind: boolean
}

/** What a picture with an extension is written as once drawn on. */
export function formatOf(extension: string): PictureFormat {
  const ext = extension.toLowerCase()
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
  format: PictureFormat
): Promise<Blob> {
  const canvas = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('No 2D canvas'))
  // A JPEG has no see-through: what was see-through becomes white, as paper.
  if (format.mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  paintItems(ctx, items, { x: 0, y: 0, w: width, h: height }, 1)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No picture'))),
      format.mime,
      format.mime === 'image/png' ? undefined : 0.92
    )
  )
}
