/**
 * What is picked out of a drawing, and a block of text being typed: which items the lasso holds,
 * the box drawn round them with the handle that scales them, what they look like while dragged,
 * and the text field over the drawing.
 *
 * Picked items are drawn on the canvas like the rest; only while they are dragged are they taken
 * off it and drawn on the live layer, moved and scaled, so a drag of a thousand strokes paints
 * nothing but them.
 */
import type { InkColor } from '@/reader/ink/stroke'
import type { DrawingItems } from './history'
import { LINE_HEIGHT, hasColor, newId, type DrawingItem, type TextItem } from './items'
import type { Camera } from './camera'
import { floated, floatedBox, type Float } from './editTools'
import { HANDLE_RADIUS, pickedBounds } from './selection'
import { paintItem } from './renderer'
import { TextEditor } from './textEditor'
import { TEXT_SIZES, type DrawingModel } from './model'

export interface PickHost {
  camera(): Camera
  /** Paints the canvas again, leaving out some items. */
  paint(skip?: ReadonlySet<string>): void
  paintLive(): void
  /** The drawing changed. */
  changed(): void
}

/** The colour of the box round what is picked: a colour of its own, never one of the ink's. */
const BOX = '#7c5cff'

const r1 = (n: number) => Math.round(n * 10) / 10

export class DrawingPick {
  ids = new Set<string>()
  private floating: Float | null = null
  private editor: TextEditor | null = null
  /** The text block being typed into, left off the canvas while the field shows it. */
  private editing: string | null = null

  constructor(
    private readonly parent: HTMLElement,
    private readonly items: DrawingItems,
    private readonly model: DrawingModel,
    private readonly host: PickHost
  ) {}

  set(ids: Iterable<string>): void {
    this.ids = new Set(ids)
    this.model.picked = this.ids.size
    this.host.paintLive()
  }

  /** Drops from what is picked whatever is no longer there — after undo, say. */
  prune(): void {
    const there = new Set(this.items.items.map((i) => i.id))
    const kept = [...this.ids].filter((id) => there.has(id))
    if (kept.length !== this.ids.size) this.set(kept)
  }

  box() {
    return this.ids.size ? pickedBounds(this.items.items, this.ids) : null
  }

  /** What is being dragged, and how; null while nothing is. */
  get drag(): { ids: ReadonlySet<string>; float: Float } | null {
    return this.floating ? { ids: this.ids, float: this.floating } : null
  }

  /** What the canvas leaves out: what is dragged, the text being typed. */
  hidden(): ReadonlySet<string> | undefined {
    if (this.floating) return this.ids
    if (this.editing) return new Set([this.editing])
    return undefined
  }

  float(f: Float | null): void {
    const was = this.floating
    this.floating = f
    // Off the canvas as the drag begins, back on it as it ends.
    if (!!was !== !!f) this.host.paint(this.hidden())
    this.host.paintLive()
  }

  /** The box round what is picked, and what is dragged, on the live layer. */
  paint(ctx: CanvasRenderingContext2D, zoom: number): void {
    if (!this.ids.size) return
    const box = this.box()
    if (!box) return
    const f = this.floating
    if (f) {
      const dragged = this.items.items.filter((i) => this.ids.has(i.id))
      // An arrow's head does not grow with it in step — it has a least and a most length — so
      // one being scaled is shown as it will be left, not as a picture of it made larger.
      const exact = (i: DrawingItem) => f.k !== 1 && i.type === 'shape' && i.kind === 'arrow'
      ctx.save()
      ctx.transform(f.k, 0, 0, f.k, f.ox - f.ox * f.k + f.dx, f.oy - f.oy * f.k + f.dy)
      for (const item of dragged) if (!exact(item)) paintItem(ctx, item)
      ctx.restore()
      for (const item of dragged) if (exact(item)) paintItem(ctx, floated(item, f))
    }
    const b = f ? floatedBox(box, f) : box
    const pad = 4 / zoom
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.lineWidth = 1.5 / zoom
    ctx.strokeStyle = BOX
    ctx.setLineDash([5 / zoom, 4 / zoom])
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad)
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(b.x + b.w, b.y + b.h, (HANDLE_RADIUS * 0.55) / zoom, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.stroke()
  }

  /** What is picked, in another colour. */
  recolor(color: InkColor): void {
    const changed = this.items.items
      .filter((i) => this.ids.has(i.id) && hasColor(i) && i.color !== color)
      .map((i) => ({ ...i, color }))
    if (!changed.length) return
    this.items.replace(changed)
    this.host.changed()
  }

  /** What is picked, taken away. */
  remove(): void {
    if (!this.ids.size) return
    const ids = [...this.ids]
    this.set([])
    this.items.remove(ids)
    this.host.changed()
  }

  /** Opens a text field: over a block already there, or for a new one at a point. */
  editText(at: { x: number; y: number }, item: DrawingItem | null): void {
    this.closeText()
    this.set([])
    const cam = this.host.camera()
    const text = item?.type === 'text' ? item : null
    const size = text?.size ?? r1(TEXT_SIZES[this.model.thickness] / cam.zoom)
    const place = text
      ? { x: text.x, y: text.y, size, color: text.color }
      : {
          x: r1(at.x),
          y: r1(at.y - (size * LINE_HEIGHT) / 2),
          size,
          color: this.model.penColor,
        }
    if (text) {
      this.editing = text.id
      this.host.paint(this.hidden())
    }
    this.editor = new TextEditor(this.parent, place, text?.text ?? '', cam, (typed) =>
      this.typed(text, place, typed)
    )
  }

  private typed(
    was: TextItem | null,
    place: { x: number; y: number; size: number; color: InkColor },
    typed: string
  ): void {
    this.editor = null
    this.editing = null
    if (was) {
      if (!typed) this.items.remove([was.id])
      else if (typed !== was.text) this.items.replace([{ ...was, text: typed }])
      else {
        this.host.paint()
        return
      }
      this.host.changed()
      return
    }
    if (!typed) return
    this.items.add([{ id: newId(), type: 'text', ...place, text: typed }])
    this.host.changed()
  }

  /** Keeps what is being typed and closes the field. */
  closeText(): void {
    this.editor?.close()
  }

  get typing(): boolean {
    return !!this.editor?.open
  }

  /** The field follows the drawing as it moves. */
  follow(camera: Camera): void {
    this.editor?.place(camera)
  }
}
