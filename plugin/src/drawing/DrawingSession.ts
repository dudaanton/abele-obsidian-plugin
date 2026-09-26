/**
 * A drawing open in a tab: its items, the camera, the tools, drawing mode and undo — everything
 * between the surface that is touched (`surface.ts`) and the file that is written (`DrawingView`).
 *
 * Drawing is a mode, turned on and off with the first button of the bar: while it is on, the
 * surface answers the tools; while it is off, every touch moves the drawing. Either way nothing
 * that lands on the surface reaches Obsidian.
 */
import { Platform, type App } from 'obsidian'
import { routePointer } from '@/reader/ink/inkRoute'
import type { InkColor } from '@/reader/ink/stroke'
import { DrawingItems } from './history'
import {
  boundsOf,
  contentBounds,
  newId,
  type DrawingItem,
  type NoteItem,
  type Rect,
  type ShapeKind,
} from './items'
import { NoteLayer } from './noteLayer'
import { fitRect, toWorld, zoomAt, type Camera } from './camera'
import { DrawingSurface, type ToolGesture, type WorldPoint } from './surface'
import type { Backdrop } from './renderer'
import { eraseGesture, strokeGesture, type ToolContext } from './tools'
import { dragGesture, lassoGesture, shapeGesture, textGesture, type EditContext } from './editTools'
import { boxPart } from './selection'
import { DrawingPick } from './pick'
import { WIDTHS, type DrawingModel, type DrawingTool, type Thickness } from './model'

/** How long after the view stops moving a drawing too slow to paint every frame is painted. */
const SETTLE_MS = 140

export interface SessionHost {
  app: App
  /** The drawing's own path, for the notes on it to resolve their links from. */
  path(): string
  /** A note on the drawing was tapped with drawing off. */
  openNote(path: string): void
  /** The drawing changed and is to be written. */
  changed(): void
  /** Drawing mode went off: what is waiting is written now. */
  stopped(): void
}

export class DrawingSession {
  readonly items = new DrawingItems()
  readonly surface: DrawingSurface
  private cam: Camera = { x: 0, y: 0, zoom: 1 }
  private penDown = false
  private penSeen = false
  private settle = 0
  private frame = 0
  private readonly win: Window
  /** What the lasso picked, a text block being typed, and how they are shown. */
  readonly pick: DrawingPick
  /** The notes shown on the drawing, under the ink. */
  readonly notes: NoteLayer

  constructor(
    parent: HTMLElement,
    readonly model: DrawingModel,
    private readonly host: SessionHost
  ) {
    this.win = parent.ownerDocument.defaultView ?? window
    this.surface = new DrawingSurface(parent, {
      drawing: () => this.model.on,
      route: (e) => routePointer({ finger: this.model.finger, penDown: this.penDown }, e),
      pen: (down) => {
        this.penDown = down
        // The first touch of a pen: from now on a finger moves the drawing, and the palm is nothing.
        if (down && !this.penSeen) {
          this.penSeen = true
          this.model.finger = false
        }
      },
      begin: (route, at) => this.begin(route, at),
      camera: () => this.cam,
      setCamera: (c) => this.setCamera(c),
      overlay: (ctx, zoom) => this.pick.paint(ctx, zoom),
      touched: () => this.pick.closeText(),
      tap: (x, y) => this.tapped(x, y),
      drop: (text, x, y) => this.dropped(text, x, y),
    })
    this.notes = new NoteLayer(this.surface.el, host.app, () => host.path())
    this.pick = new DrawingPick(parent, this.items, model, {
      camera: () => this.cam,
      paint: (skip) => {
        this.surface.renderer.paint(this.items.items, this.cam, skip)
        this.layoutNotes()
      },
      paintLive: () => {
        this.surface.paintLive()
        this.layoutNotes()
      },
      changed: () => this.edited(),
    })
    this.surface.onResize = () => this.paint()
    this.model.touch = Platform.isMobile
  }

  destroy(): void {
    this.pick.closeText()
    this.win.clearTimeout(this.settle)
    if (this.frame) this.win.cancelAnimationFrame(this.frame)
    this.notes.destroy()
    this.surface.destroy()
  }

  get camera(): Camera {
    return this.cam
  }

  /** Items read in from the file: undo starts afresh. */
  load(items: DrawingItem[]): void {
    this.surface.cancelAll()
    this.pick.closeText()
    this.items.load(items)
    this.pick.set([])
    this.sync()
    this.paint()
  }

  // ————— Drawing mode and the tools —————

  start(): void {
    if (this.model.on) return
    // A phone has no pen: its finger draws. A tablet's finger moves the drawing, the pen draws.
    if (!this.penSeen) this.model.finger = Platform.isPhone
    this.model.on = true
    this.surface.el.addClass('abele-drawing-surface_drawing')
  }

  stop(): void {
    if (!this.model.on) return
    this.pick.closeText()
    this.pick.set([])
    this.surface.cancelAll()
    this.penDown = false
    this.model.on = false
    this.surface.el.removeClass('abele-drawing-surface_drawing')
    this.host.stopped()
  }

  toggle(): void {
    if (this.model.on) this.stop()
    else this.start()
  }

  setTool(tool: DrawingTool): void {
    this.pick.closeText()
    if (tool !== 'lasso') this.pick.set([])
    this.model.tool = tool
  }

  setShape(kind: ShapeKind): void {
    this.model.shape = kind
    this.setTool('shape')
  }

  /**
   * A colour: for what is picked, when something is; else for the tool in hand — the eraser has
   * none, and the pen is taken up with it.
   */
  setColor(color: InkColor): void {
    if (this.model.picked) this.pick.recolor(color)
    if (this.model.tool === 'marker') this.model.markerColor = color
    else {
      this.model.penColor = color
      if (this.model.tool === 'eraser') this.model.tool = 'pen'
    }
  }

  /** What the lasso picked, taken away. */
  deletePicked(): void {
    this.pick.remove()
  }

  setThickness(thickness: Thickness): void {
    this.model.thickness = thickness
  }

  setFinger(on: boolean): void {
    this.model.finger = on
  }

  undo(): void {
    this.pick.closeText()
    if (this.items.undo()) this.edited()
  }

  redo(): void {
    this.pick.closeText()
    if (this.items.redo()) this.edited()
  }

  private edited(): void {
    this.pick.prune()
    this.sync()
    this.paint()
    this.host.changed()
  }

  private sync(): void {
    this.model.canUndo = this.items.canUndo
    this.model.canRedo = this.items.canRedo
  }

  private toolContext(): ToolContext {
    return {
      items: this.items,
      zoom: () => this.cam.zoom,
      added: (items) => this.surface.renderer.paintOnTop(items, this.cam),
      repaint: (area) => this.surface.renderer.paintArea(this.items.items, this.cam, area),
      changed: () => {
        this.sync()
        this.host.changed()
      },
    }
  }

  private editContext(): EditContext {
    return {
      ...this.toolContext(),
      picked: () => this.pick.ids,
      pick: (ids) => this.pick.set(ids),
      float: (f) => this.pick.float(f),
      editText: (at, item) => this.pick.editText(at, item),
    }
  }

  private begin(route: 'ink' | 'erase', at: WorldPoint): ToolGesture | null {
    const tool = this.model.tool
    if (route === 'erase' || tool === 'eraser') {
      this.pick.set([])
      return eraseGesture(this.toolContext(), at)
    }
    const thick = this.model.thickness
    if (tool === 'pen' || tool === 'marker') {
      const color = tool === 'marker' ? this.model.markerColor : this.model.penColor
      return strokeGesture(this.toolContext(), { tool, color, size: WIDTHS[tool][thick] }, at)
    }
    const ctx = this.editContext()
    if (tool === 'shape') {
      const size = WIDTHS.shape[thick]
      return shapeGesture(ctx, this.model.shape, { color: this.model.penColor, size }, at)
    }
    if (tool === 'text') return textGesture(ctx, at)
    // The lasso: on what is picked it drags it, from the corner it scales it, elsewhere it loops.
    const box = this.pick.box()
    const part = box ? boxPart(box, at.x, at.y, this.cam.zoom) : 'outside'
    if (box && part !== 'outside')
      return dragGesture(ctx, at, box, part === 'handle' ? 'scale' : 'move')
    this.pick.set([])
    return lassoGesture(ctx, at)
  }

  // ————— The camera —————

  setCamera(c: Camera): void {
    this.cam = c
    this.model.zoom = c.zoom
    this.pick.follow(c)
    const r = this.surface.renderer
    if (r.quick) {
      if (!this.frame)
        this.frame = this.win.requestAnimationFrame(() => {
          this.frame = 0
          this.paint()
        })
    } else {
      r.paintKept(c)
      this.win.clearTimeout(this.settle)
      this.settle = this.win.setTimeout(() => this.paint(), SETTLE_MS)
    }
    this.surface.paintLive()
    this.layoutNotes()
  }

  /** Zoomed by a factor about the middle of the view. */
  zoomBy(factor: number): void {
    this.setCamera(zoomAt(this.cam, this.surface.width / 2, this.surface.height / 2, factor))
  }

  /** The whole drawing in view, no larger than 100%; the start of the page for an empty one. */
  fit(): void {
    const b = contentBounds(this.items.items)
    this.setCamera(
      b ? fitRect(b, this.surface.width, this.surface.height) : { x: 0, y: 0, zoom: 1 }
    )
  }

  /** A part of the drawing in view, as large as fits. */
  show(area: Rect): void {
    this.setCamera(fitRect(area, this.surface.width, this.surface.height, 20, 0))
  }

  /** 100%, about the middle of the view. */
  actualSize(): void {
    this.zoomBy(1 / this.cam.zoom)
  }

  paint(): void {
    this.surface.renderer.paint(this.items.items, this.cam, this.pick.hidden())
    this.layoutNotes()
  }

  private layoutNotes(): void {
    const { width, height } = this.surface
    this.notes.sync(this.items.items, this.cam, width, height, this.pick.drag)
  }

  // ————— Notes on the drawing —————

  /** A note put on the drawing: at a point, or in the middle of the view, its text at 100%. */
  addNote(path: string, at?: { x: number; y: number }): void {
    const z = this.cam.zoom
    const w = 360 / z
    const h = 280 / z
    const mid = toWorld(this.cam, this.surface.width / 2, this.surface.height / 2)
    const [x, y] = at ? [at.x, at.y] : [mid[0] - w / 2, mid[1] - h / 2]
    const r1 = (n: number) => Math.round(n * 10) / 10
    const item: NoteItem = {
      id: newId(),
      type: 'note',
      x: r1(x),
      y: r1(y),
      w: r1(w),
      h: r1(h),
      scale: Math.round((1 / z) * 1000) / 1000,
      path,
    }
    this.items.add([item])
    this.edited()
  }

  /** A tap with drawing off: on a note, the note opens. */
  private tapped(x: number, y: number): void {
    if (this.model.on) return
    const items = this.items.items
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.type !== 'note') continue
      const b = boundsOf(item)
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        this.host.openNote(item.path)
        return
      }
    }
  }

  /** A note dragged in from the file list: put on the drawing where it was let go. */
  private dropped(text: string, x: number, y: number): void {
    const { app } = this.host
    const link = /\[\[([^\]|#]+)/.exec(text)?.[1] ?? /\]\(([^)#]+)/.exec(text)?.[1] ?? text.trim()
    let target = ''
    try {
      target = decodeURIComponent(link)
    } catch {
      target = link
    }
    const file = app.metadataCache.getFirstLinkpathDest(target, this.host.path())
    if (file?.extension === 'md') this.addNote(file.path, { x, y })
  }

  /** A picture to draw on: under the ink, and what the whole drawing is fitted to. */
  setBackdrop(backdrop: Backdrop | null): void {
    this.surface.renderer.backdrop = backdrop
    if (backdrop) this.show(backdrop.rect)
    else this.paint()
  }

  get backdrop(): Backdrop | null {
    return this.surface.renderer.backdrop
  }

  /** Items changed from outside the tools — a note renamed — as one step of undo. */
  replaceItems(items: DrawingItem[]): void {
    if (!items.length) return
    this.items.replace(items)
    this.edited()
  }

  /** A note changed: the cards of it show it as it is now. */
  noteChanged(path: string): void {
    this.notes.refresh(path)
  }
}
