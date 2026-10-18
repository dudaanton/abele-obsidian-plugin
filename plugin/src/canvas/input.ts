import { t } from '@/i18n'
/** Narrow DOM pointer adapter; camera navigation remains in the existing viewer. */
import { toScreen, toWorld } from '../drawing/camera'
import { nanoid } from 'nanoid'
import { lineBounds, linesOf, rawLines, segmentDistance, type CanvasLine } from './core/primitives'
import { inkBounds, inkEntries } from './core/ink'
import { snapMove, type Guide } from './core/snap'
import { endpoint, paintedRoute, routeSamples, sideAt, type Point } from './core/scene'
import { editCanvas } from './core/edit'
import { type CanvasOperation } from './core/edit'
import {
  canvasFingerprint,
  parentsOf,
  type CanvasGraph,
  type CanvasNode,
  type Rect,
  type Side,
} from './core/model'
import {
  cornerPoint,
  hitNode,
  hitResize,
  moveIds,
  movePreview,
  nodesInBox,
  RESIZE_CORNERS,
  resizeRect,
  selectNode,
  type ResizeCorner,
} from './core/selection'
import type { CanvasViewer, CanvasViewerInput } from './Viewer'
import { CanvasInkInput } from './inkAdapter'
import { routePointer } from '../ink/route'
import { CanvasInkEditInput, inkSelectionBounds } from './inkEditAdapter'
import type { CanvasTheme } from './core/painter'

export type CanvasInputTool =
  | 'select'
  | 'connect'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'marker'
  | 'pan'
  | 'eraser'
  | 'partial-eraser'
  | 'lasso'
  | 'frame'
  | 'card'
  | 'shape'
/** A pen touching the screen, as the ink router reads which of its ends it is. */
const PEN_UP = { finger: false, penDown: false }
/** A hovering pen sends moves all the time; this long without one, it is gone. */
const PEN_QUIET = 1000
/** A frame drawn with a click and no drag: about two cards wide. */
export const FRAME_SIZE = { width: 480, height: 320 }
/** The smallest a frame is drawn, in the canvas's own units: the least a resize leaves too. */
const MIN_FRAME = 40
/** A card or shape put down with a click and no drag. */
export const CARD_SIZE = { width: 260, height: 120 }
export const SHAPE_SIZE = { width: 200, height: 120 }
/** A drag shorter than this, on the screen, is a click that puts down the usual size. */
const PLACE_DRAG = 12
/**
 * The rectangle a drag from one point to another draws, in the canvas's units; with Shift (or
 * for a square kind of shape) its sides are made equal, the larger one winning.
 */
export function dragRect(start: [number, number], end: [number, number], square: boolean): Rect {
  let w = end[0] - start[0],
    h = end[1] - start[1]
  if (square) {
    const side = Math.max(Math.abs(w), Math.abs(h))
    w = Math.sign(w || 1) * side
    h = Math.sign(h || 1) * side
  }
  return {
    x: Math.min(start[0], start[0] + w),
    y: Math.min(start[1], start[1] + h),
    width: Math.abs(w),
    height: Math.abs(h),
  }
}
/** A corner pulled with Shift: the card keeps its shape, the larger change winning. */
export function keepRatio(node: Rect, corner: ResizeCorner, rect: Rect): Rect {
  const ratio = node.width / node.height,
    width = Math.max(rect.width, rect.height * ratio),
    height = width / ratio
  return {
    x: corner.endsWith('w') ? node.x + node.width - width : node.x,
    y: corner.startsWith('n') ? node.y + node.height - height : node.y,
    width: Math.round(width),
    height: Math.round(height),
  }
}
/** Every card any part of which lies in a box, for a selection box drawn with Alt. */
export function nodesTouching(graph: CanvasGraph, box: Rect): string[] {
  return graph.nodes
    .filter(
      (n) =>
        n.x < box.x + box.width &&
        n.x + n.width > box.x &&
        n.y < box.y + box.height &&
        n.y + n.height > box.y
    )
    .map((n) => n.id)
}
/**
 * The free strokes and lines whole inside the frames being carried and not picked themselves:
 * drawn in a frame, they belong to it as its cards do.
 */
function freeInFrames(
  graph: CanvasGraph,
  moving: ReadonlySet<string>,
  picked: ReadonlySet<string>
): string[] {
  const frames = graph.nodes.filter((n) => n.type === 'group' && moving.has(n.id))
  const free = new Set<string>()
  for (const frame of frames)
    for (const id of objectsInBox(graph, frame, false))
      if (!picked.has(id) && !graph.nodes.some((n) => n.id === id)) free.add(id)
  return [...free]
}
/**
 * What a selection box picks: cards whole inside it, and the free lines and strokes whole inside
 * it too; with Alt, everything any part of which it touches.
 */
export function objectsInBox(graph: CanvasGraph, box: Rect, touching: boolean): string[] {
  const inside = (r: Rect) =>
    touching
      ? r.x < box.x + box.width &&
        r.x + r.width > box.x &&
        r.y < box.y + box.height &&
        r.y + r.height > box.y
      : r.x >= box.x &&
        r.y >= box.y &&
        r.x + r.width <= box.x + box.width &&
        r.y + r.height <= box.y + box.height
  return [
    ...(touching ? nodesTouching(graph, box) : nodesInBox(graph, box)),
    ...linesOf(graph)
      .filter((l) => inside(lineBounds(l)))
      .map((l) => l.id),
    ...inkEntries(graph)
      .filter((e) => !e.node && inside(inkBounds(e)))
      .map((e) => e.stroke.id),
  ]
}
/** The connection or free line nearest a point within reach, topmost first. */
export function connectionAt(graph: CanvasGraph, point: Point, tolerance: number): string | null {
  const line = [...linesOf(graph)]
    .reverse()
    .find((l) => segmentDistance(point, l.from, l.to) <= tolerance)
  if (line) return line.id
  const edge = [...graph.edges].reverse().find((e) => {
    const samples = routeSamples(paintedRoute(e, graph))
    return samples.slice(1).some((p, i) => segmentDistance(point, samples[i], p) <= tolerance)
  })
  return edge?.id ?? null
}
export interface InputPorts {
  /** The colour and width a pen or marker draws with now. */
  brush(tool?: 'pen' | 'marker'): { color: string; size: number }
  tool(): CanvasInputTool
  /**
   * The Pencil: which eraser its other end is, whether a finger draws too once a pen has been
   * seen, and a word that one just was.
   */
  pencil?(): { eraser: 'eraser' | 'partial-eraser'; fingerDraws: boolean }
  sawPen?(): void
  enabled(): boolean
  /** The canvas is only writing the last change: a stroke may still be drawn, to add after it. */
  holds?(): boolean
  /** A stroke drawn while the last change was being written, to add once it is written. */
  hold?(op: CanvasOperation): void
  selection(): ReadonlySet<string>
  select(ids: Set<string>): void
  multiple(): boolean
  begin(): boolean
  valid(): boolean
  complete(ops: CanvasOperation[]): void
  cancel(): void
  invalid(error: unknown): void
  /**
   * A connection pulled from a card's edge and let go over empty canvas: the host asks what to
   * make there. The gesture's draft stays open until it answers.
   */
  dropped?(drop: CanvasDrop): void
  /** A card or shape put down where it was clicked, or across where it was dragged. */
  placed?(kind: 'card' | 'shape', rect: Rect): void
  /** Picked things carried with Alt held: a copy goes where they were let go. */
  copied?(ids: ReadonlySet<string>, dx: number, dy: number): void
}
/** Where a connection was let go over nothing, and the card edge it came from. */
export interface CanvasDrop {
  source: string
  side: Side
  /** In the canvas's own space, and on the screen for a menu to open at. */
  point: Point
  screen: Point
}
const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
export const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}
interface Gesture {
  graph: CanvasGraph
  ids: Set<string>
  moving: Set<string>
  /** Free strokes and lines standing whole inside a frame being carried: they go with it. */
  free: string[]
  node: string | null
  corner: ResizeCorner | null
  box: boolean
  additive: boolean
  start: [number, number]
  screen: [number, number]
  active: boolean
  ops: CanvasOperation[]
  /** A box drawn with Alt picks everything it touches, not only what is whole inside it. */
  touching: boolean
  /** Carried with Alt: a copy is left where it is let go, the original stays. */
  copy: boolean
  /** A finger on a picked note that scrolls: its body, and where the scroll stood. */
  scroll: { el: HTMLElement; top: number; carry: boolean; timer: number } | null
}
interface ConnectionGesture {
  graph: CanvasGraph
  id: string
  source: string | null
  /** The edge of the source card it was pulled from, when pulled from one of its points. */
  fromSide: Side | null
  /** The card under the pointer and the edge of it the connection would stick to. */
  target: string | null
  toSide: Side | null
  end: 'from' | 'to' | null
  line: CanvasLine | null
  creating: boolean
  start: Point
  screen: Point
  point: Point
  active: boolean
}
const roundRect = (r: Rect): Rect => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  width: Math.round(r.width),
  height: Math.round(r.height),
})
/**
 * The smallest frame, not itself carried, that would hold a carried card whole once it is let
 * go; a frame it already sits in still counts, so the light shows where it stays as well.
 */
export function landingFrame(
  graph: CanvasGraph,
  ids: ReadonlySet<string>,
  moving: ReadonlySet<string>
): string | null {
  const carried = graph.nodes.filter((n) => ids.has(n.id))
  if (!carried.length) return null
  const holds = (g: Rect, n: Rect) =>
    n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height
  const frames = graph.nodes
    .filter((n) => n.type === 'group' && !moving.has(n.id) && carried.every((c) => holds(n, c)))
    .sort((a, b) => a.width * a.height - b.width * b.height)
  return frames[0]?.id ?? null
}
/**
 * Cards let go somewhere else join the frame they now stand whole inside, and leave the one
 * they were carried out of: each carried card whose frame is not carried with it.
 */
export function reparentOps(
  before: CanvasGraph,
  after: CanvasGraph,
  ids: ReadonlySet<string>,
  moving: ReadonlySet<string>
): CanvasOperation[] {
  const parents = parentsOf(before),
    ops: CanvasOperation[] = []
  for (const id of ids) {
    const node = after.nodes.find((n) => n.id === id)
    if (!node) continue
    const was = parents.get(id) ?? null
    if (was && moving.has(was)) continue
    const now = landingFrame(after, new Set([id]), moving)
    if (now !== was && now !== id) ops.push({ op: 'update', id, patch: { abele: { parent: now } } })
  }
  return ops
}
/**
 * A frame resized takes in what now stands whole inside it and lets go of what no longer does;
 * the cards themselves stay where they are.
 */
export function resizedFrameOps(
  before: CanvasGraph,
  after: CanvasGraph,
  frame: string
): CanvasOperation[] {
  const parents = parentsOf(before),
    ops: CanvasOperation[] = []
  for (const node of after.nodes) {
    if (node.id === frame) continue
    const was = parents.get(node.id) ?? null
    const now = landingFrame(after, new Set([node.id]), new Set([node.id]))
    if ((was === frame || now === frame) && now !== was)
      ops.push({ op: 'update', id: node.id, patch: { abele: { parent: now } } })
  }
  return ops
}
/** A frame drawn around a region takes in what lies whole inside it, nested frames intact. */
export function frameOps(graph: CanvasGraph, rect: Rect): CanvasOperation[] {
  const id = nanoid(),
    inside = new Set(nodesInBox(graph, rect)),
    parents = parentsOf(graph),
    top = [...inside].filter((n) => !inside.has(parents.get(n) ?? ''))
  if (!top.length)
    return [
      {
        op: 'add_node',
        node: { id, kind: 'group', label: 'Frame', ...rect },
      },
    ]
  return [
    { op: 'group', id, label: 'Frame', ids: top },
    { op: 'update', id, patch: { ...rect } },
  ]
}
export class CanvasInput implements CanvasViewerInput {
  private readonly ink: CanvasInkInput
  private readonly inkEdit: CanvasInkEditInput
  private connection: ConnectionGesture | null = null
  private gesture: Gesture | null = null
  private readonly overlay: HTMLElement
  private marquee: Rect | null = null
  /** A frame being drawn with the Frame tool, from where the pointer went down. */
  private framing: { start: [number, number]; screen: [number, number]; rect: Rect | null } | null =
    null
  /** A card or shape being put down with the Card or Shape tool. */
  private placing: {
    kind: 'card' | 'shape'
    start: [number, number]
    screen: [number, number]
    rect: Rect | null
    square: boolean
  } | null = null
  /** The frame a card being carried would land in, lit while it is over it. */
  private dropFrame: string | null = null
  /** Lines of alignment with neighbours while cards are carried. */
  private guides: Guide[] = []
  /** The card under a mouse that is not pressed, which shows its connection points. */
  private hovered: string | null = null
  /** Where a pen hovers over the screen without touching it, in screen space. */
  private penHover: [number, number] | null = null
  /** Lets the hovering tip go when the pen goes quiet: a pen taken away may say nothing. */
  private penHoverTimer = 0
  /** Once a pen has touched the canvas, a finger moves it rather than drawing. */
  private penSeen = false
  constructor(
    private readonly viewer: CanvasViewer,
    private readonly ports: InputPorts
  ) {
    this.ink = new CanvasInkInput(viewer, ports)
    this.inkEdit = new CanvasInkEditInput(viewer, ports)
    this.overlay = viewer.el.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    this.overlay.className = 'abele-canvas-selection-layer'
    viewer.stage.append(this.overlay)
    viewer.input = this
  }
  private point(event: PointerEvent): [number, number] {
    const rect = this.viewer.stage.getBoundingClientRect()
    return toWorld(this.viewer.camera, event.clientX - rect.left, event.clientY - rect.top)
  }
  ignores(event: PointerEvent): boolean {
    return this.ink.ignores(event) || this.inkEdit.ignores(event)
  }
  /** A stroke kept while the last change was written is on the canvas now, or given up. */
  released(id: string): void {
    this.ink.release(id)
  }
  paintInk(ctx: CanvasRenderingContext2D, theme: CanvasTheme): void {
    this.ink.paint(ctx, theme)
    this.inkEdit.paint(ctx, theme)
  }
  /** What a pointer coming down would draw with, if it draws at all. */
  private inkFor(event: PointerEvent): 'pen' | 'marker' | null {
    const tool = this.ports.tool(),
      pencil = this.ports.pencil?.()
    if (event.pointerType === 'pen' && pencil && routePointer(PEN_UP, event) === 'erase')
      return null
    if (tool !== 'pen' && tool !== 'marker') return null
    if (event.pointerType === 'touch' && this.penSeen && !pencil?.fingerDraws) return null
    return tool
  }
  down(event: PointerEvent): boolean {
    if (event.button !== 0) return false
    if (!this.ports.enabled()) {
      // While the last change is being written, a stroke is still drawn, and added after it.
      const ink = this.ports.holds?.() ? this.inkFor(event) : null
      return ink ? this.ink.down(event, ink, true) : false
    }
    const tool = this.ports.tool(),
      pencil = this.ports.pencil?.()
    this.dropPenHover()
    if (event.pointerType === 'pen' && pencil) {
      // The Pencil does what the tool in hand does, as a finger or a mouse would; its other end
      // erases whatever is in hand.
      if (!this.penSeen) {
        this.penSeen = true
        this.ports.sawPen?.()
      }
      if (routePointer(PEN_UP, event) === 'erase') return this.inkEdit.down(event, pencil.eraser)
    }
    if (tool === 'pen' || tool === 'marker') {
      // With a pen about, a finger moves the canvas, and a hand resting on it does nothing.
      if (event.pointerType === 'touch' && this.penSeen && !pencil?.fingerDraws) return false
      return this.ink.down(event)
    }
    if (this.inkEdit.down(event)) return true
    if (this.ports.tool() === 'pan') return false
    if (this.ports.tool() === 'frame') {
      this.framing = {
        start: this.point(event),
        screen: [event.clientX, event.clientY],
        rect: null,
      }
      return true
    }
    if (tool === 'card' || tool === 'shape') {
      this.placing = {
        kind: tool,
        start: this.point(event),
        screen: [event.clientX, event.clientY],
        rect: null,
        square: event.shiftKey,
      }
      return true
    }
    if (!event.altKey && this.connectionDown(event)) return true
    if (this.ports.tool() !== 'select') return false
    const graph = this.viewer.graph,
      [x, y] = this.point(event),
      selected = this.ports.selection(),
      // A frame's name stands over its corner, outside its box, and still picks and carries it.
      labelled = (event.target as Element | null)?.closest?.('[data-frame-id]'),
      named = labelled
        ? graph.nodes.find((n) => n.id === (labelled as HTMLElement).dataset.frameId)
        : undefined,
      single = selected.size === 1 ? graph.nodes.find((n) => selected.has(n.id)) : null,
      multiple = event.shiftKey || this.ports.multiple(),
      corner =
        !multiple &&
        single &&
        single.width * this.viewer.camera.zoom >= 72 &&
        single.height * this.viewer.camera.zoom >= 48
          ? hitResize(single, x, y, this.viewer.camera.zoom, event.pointerType !== 'mouse')
          : null,
      node = corner ? single : (named ?? hitNode(graph, x, y))
    if (!node && !multiple && event.pointerType !== 'mouse') {
      this.ports.select(new Set())
      // A finger on empty space moves the canvas; a mouse draws a box to pick what is inside.
      if (event.pointerType !== 'mouse') return false
    }
    if (!corner && (multiple || !node || !selected.has(node.id)))
      this.ports.select(selectNode(selected, node?.id ?? null, multiple))
    const ids = new Set(this.ports.selection())
    // A finger on a picked note whose words run past its foot scrolls them; held still a moment,
    // it carries the card instead.
    const body =
      node &&
      node.type === 'file' &&
      !corner &&
      !(event.target as Element | null)?.closest?.(
        '.abele-canvas-card_panels button, .abele-canvas-card_panels a, .abele-canvas-card_panels .abele-fold-heading, .abele-canvas-card-codes'
      ) &&
      event.pointerType === 'touch' &&
      selected.has(node.id)
        ? this.viewer.scroller(node.id)
        : null
    const scroll =
      body && body.scrollHeight > body.clientHeight + 8
        ? {
            el: body,
            top: body.scrollTop,
            carry: false,
            timer: window.setTimeout(() => {
              if (this.gesture?.scroll && !this.gesture.active) this.gesture.scroll.carry = true
            }, 350),
          }
        : null
    this.gesture = {
      graph,
      ids,
      moving: moveIds(graph, ids),
      free: freeInFrames(graph, moveIds(graph, ids), ids),
      node: node?.id ?? null,
      corner,
      box: !node,
      additive: multiple && !!node,
      start: [x, y],
      screen: [event.clientX, event.clientY],
      active: false,
      ops: [],
      touching: !node && event.altKey,
      copy: !!node && !corner && event.altKey,
      scroll,
    }
    return true
  }
  move(event: PointerEvent): void {
    this.ink.move(event)
    this.inkEdit.move(event)
    if (this.connection) {
      this.connectionMove(event)
      return
    }
    if (this.placing) {
      const p = this.placing
      if (
        !p.rect &&
        Math.hypot(event.clientX - p.screen[0], event.clientY - p.screen[1]) < PLACE_DRAG
      )
        return
      p.rect = dragRect(p.start, this.point(event), p.square || event.shiftKey)
      this.viewer.draw()
      return
    }
    if (this.framing) {
      const f = this.framing
      if (!f.rect && Math.hypot(event.clientX - f.screen[0], event.clientY - f.screen[1]) < 6)
        return
      const [x, y] = this.point(event)
      f.rect = {
        x: Math.min(x, f.start[0]),
        y: Math.min(y, f.start[1]),
        width: Math.abs(x - f.start[0]),
        height: Math.abs(y - f.start[1]),
      }
      this.ports.select(new Set(nodesInBox(this.viewer.graph, f.rect)))
      this.viewer.draw()
      return
    }
    const g = this.gesture
    if (!g || g.additive) return
    if (g.scroll && !g.scroll.carry) {
      window.clearTimeout(g.scroll.timer)
      const zoom = this.viewer.camera.zoom
      g.scroll.el.scrollTop = g.scroll.top - (event.clientY - g.screen[1]) / zoom
      return
    }
    if (g.active && !this.ports.valid()) {
      this.cancel()
      return
    }
    if (!g.active && Math.hypot(event.clientX - g.screen[0], event.clientY - g.screen[1]) < 6)
      return
    const [x, y] = this.point(event),
      // Cards stand on whole units, as Obsidian Canvas keeps them.
      dx = Math.round(x - g.start[0]),
      dy = Math.round(y - g.start[1])
    if (g.box) {
      this.marquee = {
        x: Math.min(x, g.start[0]),
        y: Math.min(y, g.start[1]),
        width: Math.abs(dx),
        height: Math.abs(dy),
      }
      this.ports.select(new Set([...g.ids, ...objectsInBox(g.graph, this.marquee, g.touching)]))
      this.viewer.draw()
      return
    }
    // A pinned card, or one inside what is carried, stays where it was put.
    if (g.graph.nodes.some((n) => g.moving.has(n.id) && n.abele?.pinned === true)) return
    if (!g.active) {
      // Selection alone does not reserve a writer. Refuse a scene changed since pointer-down
      // before deriving resize coordinates from that old scene against a newer baseline.
      if (canvasFingerprint(this.viewer.graph) !== canvasFingerprint(g.graph)) {
        this.cancel()
        return
      }
      if (!this.ports.begin()) {
        this.cancel()
        return
      }
      g.active = true
    }
    let preview: CanvasGraph
    this.guides = []
    if (g.corner) {
      const node = g.graph.nodes.find((n) => n.id === g.node),
        rect = event.shiftKey
          ? keepRatio(node, g.corner, resizeRect(node, g.corner, dx, dy))
          : resizeRect(node, g.corner, dx, dy)
      preview = {
        ...g.graph,
        nodes: g.graph.nodes.map((n) => (n.id === node.id ? { ...n, ...rect } : n)),
      }
      g.ops = [
        { op: 'update', id: node.id, patch: { ...rect } },
        ...(node.type === 'group' ? resizedFrameOps(g.graph, preview, node.id) : []),
      ]
    } else {
      // Lined up with a neighbour within a few pixels, the cards stick there; Cmd or Ctrl held,
      // they go exactly where the pointer takes them.
      const snapped =
        event.metaKey || event.ctrlKey
          ? { dx, dy, guides: [] }
          : snapMove(g.graph, g.ids, g.moving, dx, dy, 6 / this.viewer.camera.zoom)
      const mx = Math.round(snapped.dx),
        my = Math.round(snapped.dy)
      this.guides = snapped.guides
      preview = movePreview(g.graph, g.moving, mx, my)
      if (g.free.length && (mx || my))
        preview = editCanvas(preview, [{ op: 'move', ids: g.free, dx: mx, dy: my }]).graph
      g.ops = [
        { op: 'move', ids: [...g.ids, ...g.free], dx: mx, dy: my },
        ...reparentOps(g.graph, preview, g.ids, g.moving),
      ]
    }
    this.dropFrame = landingFrame(preview, g.ids, g.moving)
    // Avoid validation, asset reloads and full session cloning on every pointer event.
    this.viewer.graph = preview
    this.viewer.draw()
  }
  up(event: PointerEvent): void {
    this.ink.up(event)
    this.inkEdit.up(event)
    if (this.connection) {
      this.connectionUp(event)
      return
    }
    if (this.placing) {
      this.move(event)
      const p = this.placing
      this.placing = null
      const size = p.kind === 'card' ? CARD_SIZE : SHAPE_SIZE
      const rect =
        p.rect && p.rect.width >= 20 && p.rect.height >= 20
          ? p.rect
          : { x: p.start[0] - size.width / 2, y: p.start[1] - size.height / 2, ...size }
      this.viewer.draw()
      this.ports.placed?.(p.kind, roundRect(rect))
      return
    }
    if (this.framing) {
      this.move(event)
      const f = this.framing
      this.framing = null
      // A frame dragged out is as small as it was drawn, down to a sliver that can still be
      // picked; a press without a drag puts down one of the usual size.
      const rect = f.rect
        ? {
            ...f.rect,
            width: Math.max(MIN_FRAME, f.rect.width),
            height: Math.max(MIN_FRAME, f.rect.height),
          }
        : {
            x: f.start[0] - FRAME_SIZE.width / 2,
            y: f.start[1] - FRAME_SIZE.height / 2,
            ...FRAME_SIZE,
          }
      if (this.ports.begin()) this.ports.complete(frameOps(this.viewer.graph, roundRect(rect)))
      this.viewer.draw()
      return
    }
    const g = this.gesture
    if (!g) return
    this.move(event)
    if (this.gesture !== g) return
    this.gesture = null
    this.marquee = null
    this.dropFrame = null
    this.guides = []
    if (g.scroll) window.clearTimeout(g.scroll.timer)
    if (g.active && g.copy) {
      // The originals go back where they were; the copy stands where they were let go.
      const move = g.ops.find((o) => o.op === 'move')
      this.ports.cancel()
      if (move && move.op === 'move') this.ports.copied?.(g.ids, move.dx, move.dy)
    } else if (g.active) {
      if (
        this.ports.valid() &&
        g.ops.length &&
        canvasFingerprint(this.viewer.graph) !== canvasFingerprint(g.graph)
      )
        this.ports.complete(g.ops)
      else this.ports.cancel()
    }
    this.viewer.draw()
  }
  cancel(): void {
    this.ink.cancel()
    this.inkEdit.cancel()
    if (this.connection) {
      const g = this.connection
      this.connection = null
      if (g.active) this.ports.cancel()
      this.viewer.draw()
    }
    if (this.framing) {
      this.framing = null
      this.viewer.draw()
    }
    if (this.placing) {
      this.placing = null
      this.viewer.draw()
    }
    const g = this.gesture
    if (!g) return
    this.gesture = null
    this.marquee = null
    this.dropFrame = null
    if (g.active) this.ports.cancel()
    else if (g.box) this.ports.select(g.ids)
    this.viewer.draw()
  }
  validate(): void {
    this.ink.validate()
    this.inkEdit.validate()
    if ((this.gesture?.active || this.connection?.active) && !this.ports.valid()) this.cancel()
  }
  paint(): void {
    this.overlay.replaceChildren()
    if (this.viewer.step !== null) return
    const graph = this.viewer.graph,
      selected = this.ports.selection(),
      single = selected.size === 1
    const box = (rect: Rect) => {
      const el = this.overlay.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div'),
        [x, y] = toScreen(this.viewer.camera, rect.x, rect.y)
      el.className = 'abele-canvas-selection-box'
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.style.width = `${rect.width * this.viewer.camera.zoom}px`
      el.style.height = `${rect.height * this.viewer.camera.zoom}px`
      this.overlay.append(el)
    }
    if (this.ports.tool() === 'lasso') {
      const rect = inkSelectionBounds(graph, selected)
      if (rect) {
        box(rect)
        const handle = this.overlay.ownerDocument.createElementNS(
            'http://www.w3.org/1999/xhtml',
            'div'
          ),
          [x, y] = toScreen(this.viewer.camera, rect.x + rect.width, rect.y + rect.height)
        handle.className = 'abele-canvas-resize-handle'
        handle.setAttribute('aria-label', t('streamC.56e434627dc26f45'))
        handle.style.left = `${x}px`
        handle.style.top = `${y}px`
        this.overlay.append(handle)
      }
      return
    }
    for (const node of graph.nodes.filter((n) => selected.has(n.id))) {
      box(node)
      // A card too small on the screen for its corners to stand apart keeps them hidden, so they
      // do not cover it: zoomed in, they come back.
      const roomy =
        node.width * this.viewer.camera.zoom >= 72 && node.height * this.viewer.camera.zoom >= 48
      if (!single || !this.ports.enabled() || !roomy || node.abele?.pinned === true) continue
      for (const corner of RESIZE_CORNERS) {
        const handle = this.overlay.ownerDocument.createElementNS(
            'http://www.w3.org/1999/xhtml',
            'div'
          ),
          [wx, wy] = cornerPoint(node, corner),
          [x, y] = toScreen(this.viewer.camera, wx, wy)
        handle.className = 'abele-canvas-resize-handle'
        handle.dataset.corner = corner
        handle.setAttribute('aria-label', t('streamC.c19783d8edc70d82', { v1: String(corner) }))
        handle.style.left = `${x}px`
        handle.style.top = `${y}px`
        this.overlay.append(handle)
      }
    }
    const edge = graph.edges.find((e) => selected.has(e.id)),
      line = linesOf(graph).find((l) => selected.has(l.id)),
      points = edge ? paintedRoute(edge, graph).points : line ? [line.from, line.to] : []
    if (single && points.length && this.ports.enabled()) {
      for (const [end, point] of [
        ['from', points[0]],
        ['to', points[points.length - 1]],
      ] as const) {
        const handle = this.overlay.ownerDocument.createElementNS(
            'http://www.w3.org/1999/xhtml',
            'div'
          ),
          [x, y] = toScreen(this.viewer.camera, point.x, point.y)
        handle.className = 'abele-canvas-resize-handle abele-canvas-endpoint-handle'
        handle.dataset.end = end
        handle.setAttribute('aria-label', t('streamC.bbf76cb6d5ea6f0a', { v1: String(end) }))
        handle.style.left = `${x}px`
        handle.style.top = `${y}px`
        this.overlay.append(handle)
      }
    }
    // The four points on a card's edges a connection is pulled from, and while one is pulled,
    // the points of the card it would stick to, the nearest one lit.
    const pulling =
      this.connection?.active && (this.connection.source || this.connection.end)
        ? this.connection
        : null
    const pointsOf = (node: CanvasNode, lit: Side | null) => {
      for (const side of SIDES) {
        const el = this.overlay.ownerDocument.createElementNS(
            'http://www.w3.org/1999/xhtml',
            'div'
          ),
          p = endpoint(node, side),
          [x, y] = toScreen(this.viewer.camera, p.x, p.y)
        el.className = 'abele-canvas-connect-point'
        // A small card far zoomed out keeps its points smaller than itself; a finger still
        // reaches them as far as before.
        el.style.setProperty(
          '--abele-point-limit',
          `${Math.max(8, (Math.min(node.width, node.height) * this.viewer.camera.zoom) / 3)}px`
        )
        if (side === lit) el.classList.add('is-active')
        el.dataset.side = side
        el.setAttribute('aria-label', t('streamC.3e8c1f27b47e911d', { v1: String(side) }))
        el.style.left = `${x}px`
        el.style.top = `${y}px`
        this.overlay.append(el)
      }
    }
    if (pulling) {
      const target = pulling.target && graph.nodes.find((n) => n.id === pulling.target)
      if (target) {
        box(target)
        pointsOf(target, pulling.toSide)
      }
    } else if (!this.gesture?.active) {
      const card = this.pointsCard()
      if (card) pointsOf(card, null)
    }
    if (this.marquee) box(this.marquee)
    for (const guide of this.gesture?.active ? this.guides : []) {
      const el = this.overlay.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div'),
        cam = this.viewer.camera,
        [x, y] =
          guide.axis === 'x'
            ? toScreen(cam, guide.at, guide.from)
            : toScreen(cam, guide.from, guide.at),
        length = (guide.to - guide.from) * cam.zoom
      el.className = `abele-canvas-guide is-${guide.axis}`
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      if (guide.axis === 'x') el.style.height = `${length}px`
      else el.style.width = `${length}px`
      this.overlay.append(el)
    }
    const tool = this.ports.tool()
    if (this.penHover && (tool === 'pen' || tool === 'marker')) {
      const ink = tool,
        size = Math.max(6, this.ports.brush(ink).size * this.viewer.camera.zoom),
        ring = this.overlay.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div')
      ring.className = 'abele-canvas-pen-hover'
      ring.style.left = `${this.penHover[0]}px`
      ring.style.top = `${this.penHover[1]}px`
      ring.style.width = ring.style.height = `${size}px`
      this.overlay.append(ring)
    }
    if (this.framing?.rect) {
      box(this.framing.rect)
      this.overlay.lastElementChild?.classList.add('abele-canvas-frame-draft')
    }
    if (this.placing?.rect) {
      box(this.placing.rect)
      this.overlay.lastElementChild?.classList.add('abele-canvas-frame-draft')
    }
    const target = this.dropFrame && graph.nodes.find((n) => n.id === this.dropFrame)
    if (target) {
      box(target)
      this.overlay.lastElementChild?.classList.add('abele-canvas-frame-target')
    }
  }
  /** The frame a carried card would land in, for a host that lights it in its own way. */
  landing(): string | null {
    return this.dropFrame
  }
  /** A mouse moving over the canvas with nothing pressed: the card under it shows its points. */
  hover(event: PointerEvent): void {
    const tool = this.ports.tool()
    if (event.pointerType === 'pen') {
      // A pen held over the screen shows the size of its tip where it would touch, while it
      // would draw.
      if (tool !== 'pen' && tool !== 'marker') return this.dropPenHover()
      const r = this.viewer.stage.getBoundingClientRect()
      this.penHover = [event.clientX - r.left, event.clientY - r.top]
      window.clearTimeout(this.penHoverTimer)
      this.penHoverTimer = window.setTimeout(() => this.leave(), PEN_QUIET)
      this.viewer.draw()
      return
    }
    if (event.pointerType !== 'mouse' || (tool !== 'select' && tool !== 'connect')) return
    const [x, y] = this.point(event),
      over = hitNode(this.viewer.graph, x, y),
      near = this.hovered ? this.pointHit(x, y, false) : null,
      id = near ? near.node.id : over && over.type !== 'group' ? over.id : null
    if (id === this.hovered) return
    this.hovered = id
    this.viewer.draw()
  }
  /** A pointer left the canvas, or a pen its reach above the screen: what it hovered is let go. */
  leave(): void {
    this.dropPenHover()
    if (!this.hovered) return
    this.hovered = null
    this.viewer.draw()
  }
  private dropPenHover(): void {
    window.clearTimeout(this.penHoverTimer)
    if (!this.penHover) return
    this.penHover = null
    this.viewer.draw()
  }
  /** A pen carries the canvas only with the Navigate tool in hand; else it draws or does nothing. */
  penPans(): boolean {
    return this.ports.tool() === 'pan'
  }
  /** The card whose edges show their points: the one under the mouse, else the one picked. */
  private pointsCard(): CanvasNode | null {
    const tool = this.ports.tool()
    if ((tool !== 'select' && tool !== 'connect') || !this.ports.enabled()) return null
    const graph = this.viewer.graph,
      selected = this.ports.selection(),
      id = this.hovered ?? (selected.size === 1 ? [...selected][0] : null)
    const node = graph.nodes.find((n) => n.id === id)
    return node && node.type !== 'group' ? node : null
  }
  /** A point on a card's edge within reach: a finger's reach is wider than a mouse's. */
  private pointHit(x: number, y: number, touch: boolean): { node: CanvasNode; side: Side } | null {
    const node = this.pointsCard()
    if (!node) return null
    const reach = (touch ? 22 : 10) / this.viewer.camera.zoom
    // The card's middle stays its body, to carry it: on a small card far zoomed out a finger's
    // reach around its points would otherwise cover the whole card.
    const inset = Math.min(node.width, node.height) * 0.25
    if (
      x > node.x + inset &&
      x < node.x + node.width - inset &&
      y > node.y + inset &&
      y < node.y + node.height - inset
    )
      return null
    const side = SIDES.find((s) => {
      const p = endpoint(node, s)
      return Math.hypot(x - p.x, y - p.y) <= reach
    })
    return side ? { node, side } : null
  }
  /** The connection or free line under a point, the one drawn last winning. */
  private connectionAt(point: Point, tolerance: number): string | null {
    const graph = this.viewer.graph
    const line = [...linesOf(graph)]
      .reverse()
      .find((l) => segmentDistance(point, l.from, l.to) <= tolerance)
    if (line) return line.id
    const edge = [...graph.edges].reverse().find((e) => {
      const samples = routeSamples(paintedRoute(e, graph))
      return samples.slice(1).some((p, i) => segmentDistance(point, samples[i], p) <= tolerance)
    })
    return edge?.id ?? null
  }
  private connectionDown(event: PointerEvent): boolean {
    const graph = this.viewer.graph,
      [x, y] = this.point(event),
      point = { x, y },
      tool = this.ports.tool(),
      selected = this.ports.selection(),
      tolerance = (event.pointerType === 'mouse' ? 10 : 22) / this.viewer.camera.zoom
    let id = nanoid(),
      source: string | null = null,
      fromSide: Side | null = null,
      end: 'from' | 'to' | null = null,
      line: CanvasLine | null = null,
      creating = tool !== 'select'
    // The ends of a picked connection come first: one often sits on a card's edge point, and
    // pulling it moves that end rather than starting a new connection from the card.
    const picked = selected.size === 1 && tool === 'select' ? [...selected][0] : null,
      pickedEdge = picked ? graph.edges.find((e) => e.id === picked) : undefined,
      pickedLine = picked && !pickedEdge ? linesOf(graph).find((l) => l.id === picked) : undefined,
      pickedEnds = pickedEdge
        ? paintedRoute(pickedEdge, graph).points
        : pickedLine
          ? [pickedLine.from, pickedLine.to]
          : [],
      onEnd =
        pickedEnds.length > 0 &&
        [pickedEnds[0], pickedEnds[pickedEnds.length - 1]].some(
          (p) => Math.hypot(x - p.x, y - p.y) <= tolerance
        )
    const pulled = onEnd ? null : this.pointHit(x, y, event.pointerType !== 'mouse')
    if (pulled) {
      // Pulled from a point on a card's edge: a new connection, whatever the tool.
      source = pulled.node.id
      fromSide = pulled.side
      creating = true
    } else if (tool === 'connect') {
      const node = hitNode(graph, x, y)
      if (!node) return false
      source = node.id
    } else if (tool === 'select') {
      const edge = selected.size === 1 ? graph.edges.find((e) => selected.has(e.id)) : undefined,
        selectedLine =
          selected.size === 1 ? linesOf(graph).find((l) => selected.has(l.id)) : undefined,
        points = edge
          ? paintedRoute(edge, graph).points
          : selectedLine
            ? [selectedLine.from, selectedLine.to]
            : []
      if (points.length) {
        if (Math.hypot(x - points[0].x, y - points[0].y) <= tolerance) end = 'from'
        else if (
          Math.hypot(x - points[points.length - 1].x, y - points[points.length - 1].y) <= tolerance
        )
          end = 'to'
      }
      if (end) {
        id = (edge ?? selectedLine).id
        line = selectedLine ?? null
      } else {
        // Bodies of cards win over connections underneath them; selected endpoint handles win above.
        const card = hitNode(graph, x, y)
        if (card && card.type !== 'group') return false
        const hit = this.connectionAt(point, tolerance)
        if (!hit) return false
        id = hit
        line = linesOf(graph).find((l) => l.id === hit) ?? null
      }
      this.ports.select(new Set([id]))
      creating = false
    }
    this.connection = {
      graph,
      id,
      source,
      fromSide,
      target: null,
      toSide: null,
      end,
      line,
      creating,
      start: point,
      point,
      screen: { x: event.clientX, y: event.clientY },
      active: false,
    }
    return true
  }
  private connectionMove(event: PointerEvent): void {
    const g = this.connection
    if (!g || (!g.creating && !g.end && !g.line)) return // Edge body tap selects, never moves cards.
    if (g.active && !this.ports.valid()) {
      this.cancel()
      return
    }
    if (!g.active) {
      if (Math.hypot(event.clientX - g.screen.x, event.clientY - g.screen.y) < 6) return
      if (
        canvasFingerprint(this.viewer.graph) !== canvasFingerprint(g.graph) ||
        !this.ports.begin()
      ) {
        this.cancel()
        return
      }
      g.active = true
    }
    const [x, y] = this.point(event)
    g.point = { x, y }
    if (g.line) {
      const patch = g.end
        ? { [g.end]: g.point }
        : {
            from: { x: g.line.from.x + x - g.start.x, y: g.line.from.y + y - g.start.y },
            to: { x: g.line.to.x + x - g.start.x, y: g.line.to.y + y - g.start.y },
          }
      // Zero-length endpoint previews are allowed visually; completion validates the operation.
      this.viewer.graph = {
        ...g.graph,
        abele: {
          ...g.graph.abele,
          lines: rawLines(g.graph).map((l) =>
            (l as CanvasLine)?.id === g.id ? { ...g.line, ...patch } : l
          ),
        },
      }
    } else {
      const edge = g.graph.edges.find((e) => e.id === g.id),
        node = g.source ? g.graph.nodes.find((n) => n.id === g.source) : undefined,
        points = edge ? paintedRoute(edge, g.graph).points : [],
        over = g.source || g.end ? hitNode(g.graph, x, y) : null,
        target = over && over.id !== g.source && over.type !== 'group' ? over : null
      // Over another card, a line pulled from an edge point, or an end of a picked connection
      // carried to it, sticks to the target's edge nearest the pointer; one dragged from a
      // card's body to the edge facing where it started.
      g.target = target?.id ?? null
      g.toSide = target ? sideAt(target, g.fromSide || g.end ? g.point : g.start) : null
      const at = target && g.toSide ? endpoint(target, g.toSide) : g.point
      const from = node
          ? endpoint(node, g.fromSide ?? sideAt(node, g.point))
          : g.end === 'from'
            ? at
            : (points[0] ?? g.start),
        to = g.end === 'from' ? points[points.length - 1] : at,
        preview: CanvasLine = {
          version: 1,
          id: g.id,
          from,
          to,
          toEnd: this.ports.tool() === 'line' ? 'none' : 'arrow',
        }
      this.viewer.graph = {
        ...g.graph,
        edges: g.graph.edges.filter((e) => e.id !== g.id),
        abele: { ...g.graph.abele, lines: [...rawLines(g.graph), preview] },
      }
      // A connection being pulled out is drawn as picked, in the accent, until it is let go.
      if (g.creating && !this.ports.selection().has(g.id)) this.ports.select(new Set([g.id]))
    }
    this.viewer.draw()
  }
  private connectionUp(event: PointerEvent): void {
    const g = this.connection
    this.connectionMove(event)
    if (!g || this.connection !== g) return
    this.connection = null
    if (!g.active) {
      this.viewer.draw()
      return
    }
    let ops: CanvasOperation[] = []
    if (this.ports.valid()) {
      if (g.line) {
        const changed = linesOf(this.viewer.graph).find((l) => l.id === g.id)
        if (changed && canvasFingerprint(this.viewer.graph) !== canvasFingerprint(g.graph))
          ops = [{ op: 'update', id: g.id, patch: { from: changed.from, to: changed.to } }]
      } else if (g.source || g.end) {
        const target = g.graph.nodes.find((n) => n.id === g.target)
        const home = hitNode(g.graph, g.point.x, g.point.y)?.id === g.source
        if (!target && !home && g.source && g.fromSide && this.ports.dropped) {
          // Let go over nothing: the host offers what to make there; the draft waits for it.
          this.ports.dropped({
            source: g.source,
            side: g.fromSide,
            point: g.point,
            screen: { x: event.clientX, y: event.clientY },
          })
          this.viewer.draw()
          return
        }
        if (target) {
          if (g.source)
            ops = [
              {
                op: 'connect',
                edge: {
                  id: g.id,
                  fromNode: g.source,
                  ...(g.fromSide ? { fromSide: g.fromSide } : {}),
                  toNode: target.id,
                  toSide: g.toSide ?? sideAt(target, g.start),
                },
              },
            ]
          else
            ops = [
              {
                op: 'update',
                id: g.id,
                patch: {
                  [g.end === 'from' ? 'fromNode' : 'toNode']: target.id,
                  [g.end === 'from' ? 'fromSide' : 'toSide']: g.toSide ?? sideAt(target, g.point),
                },
              },
            ]
        }
      } else {
        const line = linesOf(this.viewer.graph).find((l) => l.id === g.id)
        if (line) ops = [{ op: 'add_line', line }]
      }
      try {
        if (
          ops.length &&
          canvasFingerprint(editCanvas(g.graph, ops).graph) === canvasFingerprint(g.graph)
        )
          ops = []
      } catch (error) {
        this.ports.cancel()
        this.ports.invalid(error)
        this.viewer.draw()
        return
      }
    }
    if (ops.length) {
      this.ports.select(new Set([g.id]))
      this.ports.complete(ops)
    } else this.ports.cancel()
    this.viewer.draw()
  }
  destroy(): void {
    this.cancel()
    this.dropPenHover()
    if (this.viewer.input === this) this.viewer.input = undefined
    this.overlay.remove()
  }
}
