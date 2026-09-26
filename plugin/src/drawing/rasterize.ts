/**
 * A drawing, or a part of it, as an ordinary picture: for a PNG file, the clipboard, and a model
 * that looks at it — models take pictures, not SVG.
 *
 * Painted by the same painter as the tab (`renderer.ts`), on white paper, as large as asked up to
 * a limit on its longer side: a small part is enlarged so handwriting in it can be read.
 */
import { PAPER, paperOf } from './drawingFile'
import { paintItems } from './renderer'
import type { DrawingItem, Rect } from './items'

export interface RasterOptions {
  /** The longest side of the picture, in pixels. */
  maxSide?: number
  /** The most a drawing's unit is enlarged. */
  maxScale?: number
}

/** The scale a part is painted at. */
export function rasterScale(area: Rect, { maxSide = 2048, maxScale = 4 }: RasterOptions = {}) {
  return Math.min(maxScale, maxSide / Math.max(1, area.w, area.h))
}

/** A canvas with the part of the drawing painted on it — all of it, when no part is named. */
export function drawingCanvas(
  doc: Document,
  items: readonly DrawingItem[],
  area: Rect | null = null,
  options: RasterOptions = {}
): HTMLCanvasElement {
  const part = area ?? paperOf(items)
  const k = rasterScale(part, options)
  const canvas = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement
  canvas.width = Math.max(1, Math.round(part.w * k))
  canvas.height = Math.max(1, Math.round(part.h * k))
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(k, 0, 0, k, -part.x * k, -part.y * k)
  // Notes as their cards: a picture cannot hold the note itself.
  paintItems(ctx, items, part, k, undefined, true)
  return canvas
}

/** The part as a PNG. */
export function drawingPng(
  doc: Document,
  items: readonly DrawingItem[],
  area: Rect | null = null,
  options: RasterOptions = {}
): Promise<Blob> {
  const canvas = drawingCanvas(doc, items, area, options)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No picture'))), 'image/png')
  )
}

/** A part of a drawing with room round it, for what the lasso picked. */
export const withMargin = (r: Rect, by = 16): Rect => ({
  x: r.x - by,
  y: r.y - by,
  w: r.w + 2 * by,
  h: r.h + 2 * by,
})
