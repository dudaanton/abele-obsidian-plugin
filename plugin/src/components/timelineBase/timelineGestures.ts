/**
 * What a hand does to the history timeline: a mouse drags it along and a finger too, the wheel
 * scrolls the rows or moves along the years, two fingers or Ctrl with the wheel zoom about the
 * point under them, a press picks a note, a double press or Mod opens it, the middle button opens
 * it in a new tab, and a right press — or a long one on a phone — brings Obsidian's menu, with a
 * new note at that year. The pinch is the PDF reader's own (`PinchTracker`), so two fingers are
 * told from one the same way everywhere in the plugin.
 */
import { Keymap, Menu } from 'obsidian'
import { formatYear, type HistLang } from '@/bases/historyDates'
import type { TimelineItem } from '@/bases/timelineLayout'
import { clampPpy, roundToStep, xToT, zoomAt, type Viewport } from '@/bases/timelineScale'
import { PinchTracker, wheelFactor, type Point } from '@/reader/pdfZoom'
import { hitAt, type Hit } from './timelineScene'
import { overviewT } from './timelineChrome'

export interface HoverAt {
  item: TimelineItem
  x: number
  y: number
  t: number
}

/** What the gestures read from the drawing and ask of it. */
export interface GestureHost {
  canvas(): HTMLCanvasElement | undefined
  view(): Viewport
  limits(): [number, number]
  extent(): [number, number]
  labelW(): number
  areaWidth(): number
  width(): number
  height(): number
  /** Where the overview begins, from the top of the drawing. */
  bottom(): number
  scrollY(): number
  maxScroll(): number
  scrollTo(y: number): void
  hits(): readonly Hit[]
  hovered(): TimelineItem | null
  setHovered(item: TimelineItem | null): void
  setCursor(x: number | null): void
  selected(): TimelineItem | null
  canCreate(): boolean
  /** The axis's major step in years. */
  step(): number
  lang(): HistLang
  emit: {
    (e: 'update:view', view: Viewport): void
    (e: 'select', item: TimelineItem | null): void
    (e: 'open', item: TimelineItem, event: MouseEvent | KeyboardEvent | null): void
    (e: 'hover', at: HoverAt | null, event?: MouseEvent): void
    (e: 'create', year: number): void
  }
}

export function createGestures(h: GestureHost) {
  /**
   * The view just asked for, until the drawing has it: two events in one task — a burst of
   * wheel events, a pinch's two fingers — build on each other rather than on a stale view.
   */
  let pending: Viewport | null = null
  const current = (): Viewport => pending ?? h.view()

  const setView = (v: Viewport) => {
    const ppy = clampPpy(v.ppy, h.limits())
    pending = ppy === v.ppy ? v : { t0: v.t0, ppy }
    h.emit('update:view', pending)
    queueMicrotask(() => (pending = null))
  }

  const panBy = (dx: number, dy: number) => {
    if (dx) setView({ t0: current().t0 - dx / current().ppy, ppy: current().ppy })
    if (dy) h.scrollTo(h.scrollY() - dy)
  }

  const zoomBy = (factor: number, x: number) => {
    const ppy = clampPpy(current().ppy * factor, h.limits())
    setView(zoomAt(current(), x - h.labelW(), ppy))
  }

  const local = (e: { clientX: number; clientY: number }): Point => {
    const box = h.canvas()?.getBoundingClientRect()
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) }
  }

  const tAt = (x: number) => xToT(current(), x - h.labelW())

  // Two fingers zoom the years about the point between them.
  let pinchBase: Viewport | null = null
  const pinch = new PinchTracker({
    begin: () => {
      pinchBase = current()
      drag = null
      window.clearTimeout(longPress)
    },
    move: (from, to) => {
      const base = pinchBase
      if (!base) return
      const d0 = Math.hypot(from[0].x - from[1].x, from[0].y - from[1].y)
      const d1 = Math.hypot(to[0].x - to[1].x, to[0].y - to[1].y)
      const box = h.canvas()?.getBoundingClientRect()
      const left = (box?.left ?? 0) + h.labelW()
      const a = (from[0].x + from[1].x) / 2 - left
      const b = (to[0].x + to[1].x) / 2 - left
      const ppy = clampPpy(base.ppy * (d0 > 0 ? d1 / d0 : 1), h.limits())
      const t = xToT(base, a)
      setView({ t0: t - b / ppy, ppy })
    },
    end: () => (pinchBase = null),
  })

  interface Drag {
    id: number
    touch: boolean
    x: number
    y: number
    lastX: number
    lastY: number
    moved: boolean
    overview: boolean
  }
  let drag: Drag | null = null
  let longPress = 0

  const inOverview = (y: number) => y >= h.bottom()

  const centreOnOverview = (x: number) => {
    const t = overviewT(h.extent(), h.width(), x)
    setView({ t0: t - h.areaWidth() / 2 / current().ppy, ppy: current().ppy })
  }

  function onDown(e: PointerEvent) {
    const el = h.canvas()
    if (!el) return
    const touch = e.pointerType === 'touch'
    if (touch && pinch.touch('start', [{ id: e.pointerId, x: e.clientX, y: e.clientY }])) {
      e.preventDefault()
      return
    }
    if (!touch && e.button !== 0) return
    // The keys work once the drawing is pressed; a finger needs neither them nor the ring.
    if (!touch) el.focus({ preventScroll: true })
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // A pointer the browser no longer knows (a synthetic one): the drag works without capture.
    }
    const p = local(e)
    drag = {
      id: e.pointerId,
      touch,
      x: p.x,
      y: p.y,
      lastX: p.x,
      lastY: p.y,
      moved: false,
      overview: inOverview(p.y),
    }
    if (drag.overview) centreOnOverview(p.x)
    window.clearTimeout(longPress)
    if (touch)
      longPress = window.setTimeout(() => {
        if (!drag || drag.moved) return
        const at = drag
        drag = null
        showMenu(at.x, at.y, e)
      }, 550)
  }

  function onMove(e: PointerEvent) {
    const touch = e.pointerType === 'touch'
    if (touch && pinch.touch('move', [{ id: e.pointerId, x: e.clientX, y: e.clientY }])) return
    const p = local(e)
    if (drag && drag.id === e.pointerId) {
      const dx = p.x - drag.lastX
      const dy = p.y - drag.lastY
      if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) > (drag.touch ? 8 : 4)) {
        drag.moved = true
        window.clearTimeout(longPress)
      }
      if (drag.moved) {
        if (drag.overview) centreOnOverview(p.x)
        else panBy(dx, dy)
      }
      drag.lastX = p.x
      drag.lastY = p.y
      return
    }
    if (touch) return
    h.setCursor(p.x)
    const hit = hitAt(h.hits(), p.x, p.y, 2)
    const item = hit && hit.kind !== 'cluster' ? hit.item : null
    if (item !== h.hovered()) {
      h.setHovered(item)
      if (item && h.canvas()) {
        h.emit('hover', { item, x: e.clientX, y: e.clientY, t: tAt(p.x) }, e)
      } else h.emit('hover', null)
    } else if (item) h.emit('hover', { item, x: e.clientX, y: e.clientY, t: tAt(p.x) }, e)
  }

  function onUp(e: PointerEvent) {
    const touch = e.pointerType === 'touch'
    window.clearTimeout(longPress)
    if (touch && pinch.touch('end', [{ id: e.pointerId, x: e.clientX, y: e.clientY }])) {
      drag = null
      return
    }
    const d = drag
    drag = null
    if (!d || d.id !== e.pointerId || d.moved || d.overview) return
    press(local(e), e, d.touch)
  }

  function onCancel(e: PointerEvent) {
    window.clearTimeout(longPress)
    if (e.pointerType === 'touch')
      pinch.touch('cancel', [{ id: e.pointerId, x: e.clientX, y: e.clientY }])
    drag = null
  }

  function onLeave(e: PointerEvent) {
    if (e.pointerType === 'touch') return
    h.setCursor(null)
    if (h.hovered()) {
      h.setHovered(null)
      h.emit('hover', null)
    }
  }

  /** A press that did not move: pick what is under it, open it with Mod, zoom into a "+N". */
  function press(p: Point, e: PointerEvent, touch: boolean) {
    const hit = hitAt(h.hits(), p.x, p.y, touch ? 12 : 2)
    if (!hit) {
      h.emit('select', null)
      return
    }
    if (hit.kind === 'cluster') {
      zoomBy(3, h.labelW() + (hit.cluster.t - current().t0) * current().ppy)
      return
    }
    if (!touch && Keymap.isModEvent(e)) h.emit('open', hit.item, e)
    else h.emit('select', hit.item)
  }

  function onDouble(e: MouseEvent) {
    const p = local(e)
    const hit = hitAt(h.hits(), p.x, p.y, 2)
    if (hit && hit.kind !== 'cluster') h.emit('open', hit.item, e)
  }

  /** The middle button opens a note in a new tab, as on a link. */
  function onAux(e: MouseEvent) {
    if (e.button !== 1) return
    const p = local(e)
    const hit = hitAt(h.hits(), p.x, p.y, 2)
    if (hit && hit.kind !== 'cluster') {
      e.preventDefault()
      h.emit('open', hit.item, e)
    }
  }

  function onMenu(e: MouseEvent) {
    e.preventDefault()
    const p = local(e)
    showMenu(p.x, p.y, e)
  }

  /** Obsidian's own menu: what can be done with the note under the point, and a note at its year. */
  function showMenu(x: number, y: number, e: MouseEvent | PointerEvent) {
    const hit = hitAt(h.hits(), x, y, e instanceof PointerEvent && e.pointerType === 'touch' ? 12 : 2)
    const menu = new Menu()
    if (hit && hit.kind !== 'cluster') {
      const item = hit.item
      menu.addItem((m) =>
        m
          .setTitle('Open note')
          .setIcon('file-text')
          .onClick(() => h.emit('open', item, null))
      )
      menu.addItem((m) =>
        m
          .setTitle('Show who lived then')
          .setIcon('users')
          .onClick(() => h.emit('select', item))
      )
    }
    if (h.canCreate() && x >= h.labelW() && !inOverview(y)) {
      const year = roundToStep(tAt(x), Math.max(1, h.step() / 5))
      menu.addItem((m) =>
        m
          .setTitle(`New note in ${formatYear(year > 0 ? year : year + 1, h.lang())}`)
          .setIcon('plus')
          .onClick(() => h.emit('create', year))
      )
    }
    const box = h.canvas()?.getBoundingClientRect()
    menu.showAtPosition({ x: (box?.left ?? 0) + x, y: (box?.top ?? 0) + y })
  }

  /**
   * Ctrl or Cmd with the wheel, and a trackpad's pinch, zoom; a sideways swipe or Shift moves
   * along the years; the plain wheel scrolls the rows, or moves along when they all fit.
   */
  function onWheel(e: WheelEvent) {
    const p = local(e)
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      zoomBy(wheelFactor(e.deltaY, e.deltaMode), p.x)
      return
    }
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? h.height() : 1
    const dx = (e.shiftKey ? e.deltaY : e.deltaX) * unit
    const dy = e.shiftKey ? 0 : e.deltaY * unit
    if (Math.abs(dx) > Math.abs(dy)) {
      e.preventDefault()
      panBy(-dx, 0)
    } else if (dy) {
      e.preventDefault()
      if (h.maxScroll() > 0) panBy(0, -dy)
      else panBy(-dy, 0)
    }
  }

  /** Arrows move, + and − zoom, Escape lets go of the pick, Enter opens it. */
  function onKey(e: KeyboardEvent) {
    const step = h.areaWidth() / 8
    const mid = h.labelW() + h.areaWidth() / 2
    const act: Record<string, () => void> = {
      ArrowLeft: () => panBy(step, 0),
      ArrowRight: () => panBy(-step, 0),
      ArrowUp: () => panBy(0, 60),
      ArrowDown: () => panBy(0, -60),
      '+': () => zoomBy(1.5, mid),
      '=': () => zoomBy(1.5, mid),
      '-': () => zoomBy(1 / 1.5, mid),
      Escape: () => h.emit('select', null),
      Enter: () => {
        if (h.selected()) h.emit('open', h.selected(), e)
      },
    }
    const run = act[e.key]
    if (!run) return
    e.preventDefault()
    run()
  }

  return {
    onDown,
    onMove,
    onUp,
    onCancel,
    onLeave,
    onDouble,
    onAux,
    onMenu,
    onWheel,
    onKey,
    dispose: () => window.clearTimeout(longPress),
  }
}
