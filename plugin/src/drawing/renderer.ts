/**
 * Paints a drawing on a canvas: only what the view shows, each item's shape made once and kept
 * (by the item object, which a change replaces), and nothing smaller than a pixel.
 *
 * A drawing of thousands of strokes may take longer to paint than a frame lasts. So each full
 * paint is kept as a picture along with the camera it was painted for, and while the view is being
 * moved or zoomed, the picture is what is shown — shifted and scaled to the new camera — and the
 * full paint comes when the movement rests. When a full paint is quick, it is simply done every
 * frame.
 */
import { MARKER_OPACITY, inkLiteral, strokePath } from '@/reader/ink/stroke'
import { arrowHeadPath, baselineOf } from './drawingFile'
import { paintNoteCard } from './noteCard'
import {
  TEXT_FONT,
  boundsOf,
  intersects,
  setTextMeasure,
  textLines,
  type DrawingItem,
  type Rect,
} from './items'
import { visibleRect, type Camera } from './camera'

const paths = new WeakMap<DrawingItem, Path2D>()

function pathOf(item: DrawingItem): Path2D | null {
  if (item.type === 'text' || item.type === 'note') return null
  const known = paths.get(item)
  if (known) return known
  let d: string
  if (item.type === 'stroke') d = strokePath(item)
  else {
    const { x1, y1, x2, y2 } = item
    if (item.kind === 'rect') d = `M${x1} ${y1}L${x2} ${y1}L${x2} ${y2}L${x1} ${y2}Z`
    else if (item.kind === 'ellipse') {
      const cx = (x1 + x2) / 2
      const cy = (y1 + y2) / 2
      const rx = Math.abs(x2 - x1) / 2
      const ry = Math.abs(y2 - y1) / 2
      d = `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`
    } else d = `M${x1} ${y1}L${x2} ${y2}` + (item.kind === 'arrow' ? arrowHeadPath(item) : '')
  }
  const path = new Path2D(d)
  paths.set(item, path)
  return path
}

/**
 * One item painted, the context already set to the drawing's units. A note is painted as its
 * card only when asked (`notes`): in the drawing's tab the note itself shows under the canvas.
 */
export function paintItem(ctx: CanvasRenderingContext2D, item: DrawingItem, notes = false): void {
  if (item.type === 'note') {
    if (notes) paintNoteCard(ctx, item)
    return
  }
  const color = inkLiteral(item.color)
  if (item.type === 'text') {
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = color
    ctx.font = `${item.size}px ${TEXT_FONT}`
    ctx.textBaseline = 'alphabetic'
    textLines(item).forEach((line, i) =>
      ctx.fillText(line, item.x, item.y + baselineOf(item.size, i))
    )
    return
  }
  const path = pathOf(item)
  if (!path) return
  if (item.type === 'stroke' && item.tool === 'pen') {
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = color
    ctx.fill(path)
    return
  }
  const marker = item.type === 'stroke'
  ctx.globalAlpha = marker ? MARKER_OPACITY : 1
  ctx.globalCompositeOperation = marker ? 'multiply' : 'source-over'
  ctx.strokeStyle = color
  ctx.lineWidth = item.size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(path)
}

/** Paints the items that fall in a part of the drawing; says how many. */
export function paintItems(
  ctx: CanvasRenderingContext2D,
  items: readonly DrawingItem[],
  area: Rect,
  zoom: number,
  skip?: ReadonlySet<string>,
  notes = false
): number {
  let n = 0
  // Smaller than this on screen, an item is a speck nobody can see: it is left out.
  const speck = 0.4 / zoom
  for (const item of items) {
    if (skip?.has(item.id)) continue
    const b = boundsOf(item)
    if (!intersects(b, area) || (b.w < speck && b.h < speck)) continue
    paintItem(ctx, item, notes)
    n++
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  return n
}

/** How long a full paint may take before moving the view shows the kept picture instead. */
const QUICK_MS = 8

export class DrawingRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private readonly snap: HTMLCanvasElement
  private snapCamera: Camera | null = null
  /** How long the last full paint took. */
  lastPaintMs = 0
  lastPainted = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ratio: () => number
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No 2D canvas')
    this.ctx = ctx
    this.snap = canvas.ownerDocument.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'canvas'
    ) as HTMLCanvasElement
    setTextMeasure((text, size) => {
      ctx.font = `${size}px ${TEXT_FONT}`
      return ctx.measureText(text).width
    })
  }

  /** The view's size in CSS pixels. */
  get width(): number {
    return this.canvas.width / this.ratio()
  }

  get height(): number {
    return this.canvas.height / this.ratio()
  }

  /** Makes the canvas the size of its element, at the screen's pixel density. */
  resize(width: number, height: number): void {
    const r = this.ratio()
    this.canvas.width = Math.max(1, Math.round(width * r))
    this.canvas.height = Math.max(1, Math.round(height * r))
    this.snapCamera = null
  }

  /** Whether a full paint is quick enough to be done on every frame of a movement. */
  get quick(): boolean {
    return this.lastPaintMs <= QUICK_MS
  }

  private setCamera(ctx: CanvasRenderingContext2D, c: Camera): void {
    const r = this.ratio()
    ctx.setTransform(r * c.zoom, 0, 0, r * c.zoom, -c.x * r * c.zoom, -c.y * r * c.zoom)
  }

  /** Paints everything the camera shows, and keeps the picture. */
  paint(items: readonly DrawingItem[], camera: Camera, skip?: ReadonlySet<string>): void {
    const t0 = performance.now()
    const { ctx } = this
    this.blank()
    this.setCamera(ctx, camera)
    this.lastPainted = paintItems(
      ctx,
      items,
      visibleRect(camera, this.width, this.height),
      camera.zoom,
      skip
    )
    this.lastPaintMs = performance.now() - t0
    this.keep(camera)
  }

  /** Paints again only a part of the drawing — where something was just erased or added. */
  paintArea(items: readonly DrawingItem[], camera: Camera, area: Rect): void {
    const { ctx } = this
    this.setCamera(ctx, camera)
    ctx.save()
    ctx.beginPath()
    ctx.rect(area.x, area.y, area.w, area.h)
    ctx.clip()
    ctx.clearRect(area.x, area.y, area.w, area.h)
    paintItems(ctx, items, area, camera.zoom)
    ctx.restore()
    this.keep(camera)
  }

  /** Adds items on top of what is painted, without painting the rest again. */
  paintOnTop(items: readonly DrawingItem[], camera: Camera): void {
    this.setCamera(this.ctx, camera)
    for (const item of items) paintItem(this.ctx, item)
    this.ctx.globalAlpha = 1
    this.ctx.globalCompositeOperation = 'source-over'
    this.keep(camera)
  }

  /** The kept picture, moved and scaled to where a camera now looks. */
  paintKept(camera: Camera): boolean {
    const was = this.snapCamera
    if (!was) return false
    const { ctx } = this
    const k = camera.zoom / was.zoom
    const r = this.ratio()
    this.blank()
    const dx = (was.x - camera.x) * camera.zoom * r
    const dy = (was.y - camera.y) * camera.zoom * r
    ctx.drawImage(this.snap, dx, dy, this.snap.width * k, this.snap.height * k)
    return true
  }

  /**
   * The whole canvas, clear: the paper is the surface's, under it, and so are the notes shown on
   * the drawing, which the ink goes over.
   */
  private blank(): void {
    const { ctx } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private keep(camera: Camera): void {
    if (this.snap.width !== this.canvas.width || this.snap.height !== this.canvas.height) {
      this.snap.width = this.canvas.width
      this.snap.height = this.canvas.height
    }
    const s = this.snap.getContext('2d')
    if (!s) return
    s.setTransform(1, 0, 0, 1, 0, 0)
    s.clearRect(0, 0, this.snap.width, this.snap.height)
    s.drawImage(this.canvas, 0, 0)
    this.snapCamera = { ...camera }
  }
}
