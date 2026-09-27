/**
 * One frame of the history timeline, painted on a canvas: eras behind, the rows with their bars
 * and points, "+N" and density where a row is crowded, the names of the rows, the axis, the year
 * under the pointer and the overview at the foot. Everything is one picture — ten thousand bars
 * are ten thousand rectangles, not ten thousand elements — and only what is on screen is drawn.
 *
 * Every colour and font is the theme's (`timelineText`).
 */
import type { HistLang } from '@/bases/historyDates'
import { density, isPoint, visibleRange, type TimelineItem } from '@/bases/timelineLayout'
import { tToX, xToT, type Ticks, type Viewport } from '@/bases/timelineScale'
import type { Hit, LaneBox, Scene } from './timelineScene'
import { paintAxis, paintCursor, paintLaneNames, paintOverview } from './timelineChrome'
import { datesOf, fontOf, labelWidth, measure, withAlpha, type Palette } from './timelineText'

export interface Frame {
  scene: Scene
  view: Viewport
  width: number
  height: number
  scrollY: number
  palette: Palette
  lang: HistLang
  ticks: Ticks
  today: number
  hovered: TimelineItem | null
  selected: TimelineItem | null
  /** The pointer's x over the drawing, for the year line; null when it is away. */
  cursorX: number | null
  /** The whole data's stretch, for the overview. */
  extent: [number, number]
  /** A loaded picture for a URL, or null while it loads. */
  image(url: string): HTMLImageElement | null
  /** Whether round pictures are drawn at the start of bars. */
  covers: boolean
}

const PAD = 6
const POINT = 10
/**
 * How far to the left of the screen something is still looked at: its label, beside a point or
 * a short bar, may reach into sight after the thing itself has gone. Longer labels are rare
 * enough to lose.
 */
const LABEL_REACH = 640

/** Paints a frame and says where the pressable things ended up. */
export function paint(ctx: CanvasRenderingContext2D, f: Frame): Hit[] {
  const hits: Hit[] = []
  const { scene, palette: p, width, height } = f
  const m = scene.metrics
  const areaX = m.labelW
  const top = m.axisH + scene.eraRows * m.eraH
  const bottom = height - m.minimapH
  const t0 = xToT(f.view, 0)
  const t1 = xToT(f.view, width - areaX)
  const X = (t: number) => areaX + tToX(f.view, t)

  ctx.clearRect(0, 0, width, height)
  ctx.textBaseline = 'middle'

  // Behind the rows: the eras, the grid of the axis, the picked life's band, today.
  ctx.save()
  ctx.beginPath()
  ctx.rect(areaX, top, width - areaX, bottom - top)
  ctx.clip()
  scene.eras.forEach((era, i) => {
    if (era.to < t0 || era.from > t1) return
    ctx.fillStyle = withAlpha(i % 2 ? p.faint : p.accent, i % 2 ? 0.05 : 0.06)
    ctx.fillRect(X(era.from), top, X(era.to) - X(era.from), bottom - top)
  })
  ctx.strokeStyle = p.border
  ctx.lineWidth = 1
  for (const tick of f.ticks.major) {
    const x = Math.round(X(tick.t)) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
  }
  const focus = scene.focus
  if (focus) {
    const s = focus.selected
    const color = colorOf(p, s)
    ctx.fillStyle = withAlpha(color, 0.08)
    ctx.fillRect(X(s.from), top, X(s.to) - X(s.from), bottom - top)
    ctx.strokeStyle = withAlpha(color, 0.6)
    for (const t of [s.solidFrom, s.solidTo]) {
      const x = Math.round(X(t)) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, top)
      ctx.lineTo(x, bottom)
      ctx.stroke()
    }
  }
  if (f.today >= t0 && f.today <= t1) {
    ctx.strokeStyle = p.accent
    ctx.setLineDash([3, 3])
    const x = Math.round(X(f.today)) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // The rows.
  for (const box of scene.boxes) {
    const y0 = top + box.top - f.scrollY
    if (y0 > bottom || y0 + box.height < top) continue
    paintLane(ctx, f, box, y0, X, t0, t1, hits)
    ctx.strokeStyle = p.border
    ctx.beginPath()
    ctx.moveTo(0, Math.round(y0 + box.height) + 0.5)
    ctx.lineTo(width, Math.round(y0 + box.height) + 0.5)
    ctx.stroke()
  }
  ctx.restore()

  // The names of the rows: a column on a computer, a line over each row on a phone.
  paintLaneNames(ctx, f, top, bottom)
  paintAxis(ctx, f, X, t0, t1, hits)
  paintCursor(ctx, f, top, bottom)
  paintOverview(ctx, f, bottom)
  return hits
}

const colorOf = (p: Palette, item: TimelineItem) => (item.color ? p.colors[item.color] : p.accent)

function paintLane(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  box: LaneBox,
  y0: number,
  X: (t: number) => number,
  t0: number,
  t1: number,
  hits: Hit[]
): void {
  const { palette: p, scene } = f
  const m = scene.metrics
  const linesTop = y0 + m.laneHead
  const focus = scene.focus
  const shown = visibleRange(box.items, box.longest, t0 - LABEL_REACH / f.view.ppy, t1)
  for (const item of shown) {
    const place = box.pack.placed.get(item)
    if (!place) continue
    const y = linesTop + place.line * m.lineH + (m.lineH - m.barH) / 2
    if (y > f.height || y + m.barH < 0) continue
    const dim = !!focus && item !== focus.selected && !focus.near.has(item)
    ctx.globalAlpha = dim ? 0.3 : 1
    paintItem(ctx, f, item, y, place.labeled, X, hits)
    if (focus && focus.near.has(item) && !isPoint(item)) {
      // The years lived at the same time, underlined.
      const a = Math.max(item.start.at, focus.selected.start.at)
      const b = Math.min(item.solidTo, focus.selected.solidTo)
      if (b > a) {
        ctx.fillStyle = p.text
        ctx.fillRect(X(a), y + m.barH + 1, Math.max(2, X(b) - X(a)), 2)
      }
    }
    ctx.globalAlpha = 1
  }
  if (focus) {
    const y = linesTop + (focus.restLine - 1) * m.lineH + m.lineH / 2
    ctx.fillStyle = p.faint
    ctx.font = fontOf(p, false)
    ctx.textAlign = 'left'
    ctx.fillText('Not at the same time', m.labelW + 8, y)
  }
  if (box.clusters.length) {
    const lines = Math.max(1, box.pack.lines)
    const by = linesTop + lines * m.lineH + 4
    const dy = by + m.bubbleH + 2
    // How many are alive where: the row's band of density under its bubbles.
    const bins = Math.max(1, Math.floor((f.width - m.labelW) / 3))
    const counts = density(box.items, t0, t1, bins)
    let max = 0
    for (const c of counts) max = Math.max(max, c)
    const color = box.lane.color ? p.colors[box.lane.color] : p.accent
    const w = (f.width - m.labelW) / bins
    for (let i = 0; i < bins; i++) {
      if (!counts[i]) continue
      ctx.fillStyle = withAlpha(color, 0.08 + (0.75 * counts[i]) / max)
      ctx.fillRect(m.labelW + i * w, dy, w + 0.5, m.densityH)
    }
    ctx.font = fontOf(p, true)
    ctx.textAlign = 'center'
    for (const cluster of box.clusters) {
      if (cluster.t < t0 || cluster.t > t1) continue
      const text = `+${cluster.count}`
      const w = measure(ctx, text, ctx.font) + 16
      const x = X(cluster.t) - w / 2
      const h = m.bubbleH - 4
      ctx.beginPath()
      ctx.roundRect(x, by, w, h, h / 2)
      ctx.fillStyle = p.secondary
      ctx.fill()
      ctx.strokeStyle = withAlpha(color, 0.8)
      ctx.stroke()
      ctx.fillStyle = p.text
      ctx.fillText(text, x + w / 2, by + h / 2 + 0.5)
      hits.push({ kind: 'cluster', cluster, x, y: by, w, h })
    }
    ctx.textAlign = 'left'
  }
}

function paintItem(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  item: TimelineItem,
  y: number,
  labeled: boolean,
  X: (t: number) => number,
  hits: Hit[]
): void {
  const { palette: p, scene } = f
  const m = scene.metrics
  const h = m.barH
  const color = colorOf(p, item)
  const areaX = m.labelW
  const selected = item === f.selected
  const hovered = item === f.hovered

  if (isPoint(item)) {
    const x = X(item.from)
    const r = POINT / 2
    ctx.beginPath()
    ctx.moveTo(x, y + h / 2 - r)
    ctx.lineTo(x + r, y + h / 2)
    ctx.lineTo(x, y + h / 2 + r)
    ctx.lineTo(x - r, y + h / 2)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    if (selected || hovered) {
      ctx.strokeStyle = selected ? p.text : p.muted
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.lineWidth = 1
    }
    let lx = x + r + PAD
    const reach = lx + labelWidth(ctx, f.palette, item, f.lang, f.covers, h)
    if (labeled && reach > f.scene.metrics.labelW) lx = paintLabel(ctx, f, item, lx, y, h, false)
    hits.push({ kind: 'item', item, x: x - r, y, w: Math.max(POINT, lx - x + r), h })
    return
  }

  const x0 = X(item.from)
  const xs0 = X(item.solidFrom)
  const xs1 = Math.max(X(item.solidTo), xs0 + 3)
  const x1 = Math.max(X(item.to), xs1)
  const fill = withAlpha(color, 0.38)
  if (xs0 > x0 + 0.5) {
    const g = ctx.createLinearGradient(x0, 0, xs0, 0)
    g.addColorStop(0, withAlpha(color, 0))
    g.addColorStop(1, fill)
    ctx.fillStyle = g
    ctx.fillRect(x0, y, xs0 - x0, h)
  }
  if (x1 > xs1 + 0.5) {
    const g = ctx.createLinearGradient(xs1, 0, x1, 0)
    g.addColorStop(0, fill)
    g.addColorStop(1, withAlpha(color, 0))
    ctx.fillStyle = g
    ctx.fillRect(xs1, y, x1 - xs1, h)
  }
  ctx.beginPath()
  ctx.roundRect(xs0, y, xs1 - xs0, h, 4)
  ctx.fillStyle = fill
  ctx.fill()
  // The solid start, a line of the full colour: the bar reads as the row's even when faint.
  if (!item.start.fuzzy && xs1 - xs0 > 6) {
    ctx.fillStyle = color
    ctx.fillRect(xs0, y + 3, 2.5, h - 6)
  }
  if (selected || hovered) {
    ctx.beginPath()
    ctx.roundRect(xs0 - 1.5, y - 1.5, xs1 - xs0 + 3, h + 3, 5)
    ctx.strokeStyle = selected ? p.text : p.muted
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.lineWidth = 1
  }
  let right = x1
  if (labeled) {
    const w = labelWidth(ctx, p, item, f.lang, f.covers, h)
    const inside = w + 2 * PAD <= x1 - x0
    // Inside, the label keeps to the screen's left edge while its bar runs on past it — as long
    // as what is left of the bar on screen holds it; a label cut by the edge says nothing.
    const shown = x1 - Math.max(x0, areaX)
    if (!inside) {
      // Drawn while any of it is in sight; the edge of the drawing cuts the rest.
      if (x1 + PAD + w > areaX) right = paintLabel(ctx, f, item, x1 + PAD, y, h, false)
    } else if (shown >= w + 2 * PAD) {
      const lx = Math.min(Math.max(x0 + PAD, areaX + PAD), x1 - PAD - w)
      paintLabel(ctx, f, item, lx, y, h, true)
    } else {
      // Only the name, when the dates no longer fit what is left of the bar on screen.
      const name = measure(ctx, item.title, fontOf(f.palette, true))
      if (shown >= name + 2 * PAD)
        paintLabel(ctx, f, item, Math.max(x0, areaX) + PAD, y, h, true, false)
    }
  }
  hits.push({ kind: 'item', item, x: x0, y, w: Math.max(4, right - x0), h })
}

/** The round picture, the name and the dates; returns where the label ends. */
function paintLabel(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  item: TimelineItem,
  x: number,
  y: number,
  h: number,
  inside: boolean,
  full = true
): number {
  const p = f.palette
  if (full && f.covers && item.cover) {
    const d = h + 2
    const cx = x + d / 2
    const cy = y + h / 2
    const img = f.image(item.cover)
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2)
    ctx.fillStyle = p.secondary
    ctx.fill()
    if (img) {
      ctx.clip()
      // Cover the circle, cropped to the middle, whatever the picture's shape.
      const k = Math.max(d / img.naturalWidth, d / img.naturalHeight)
      const w = img.naturalWidth * k
      const hh = img.naturalHeight * k
      ctx.drawImage(img, cx - w / 2, cy - hh / 2, w, hh)
    }
    ctx.restore()
    ctx.beginPath()
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2)
    ctx.strokeStyle = p.background
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.lineWidth = 1
    x += d + 4
  }
  const mid = y + h / 2 + 0.5
  ctx.textAlign = 'left'
  ctx.font = fontOf(p, true)
  ctx.fillStyle = p.text
  ctx.fillText(item.title, x, mid)
  x += measure(ctx, item.title, ctx.font) + 5
  if (!full) return x
  const dates = datesOf(item, f.lang)
  ctx.font = fontOf(p, false)
  ctx.fillStyle = inside ? p.text : p.muted
  if (inside) ctx.globalAlpha *= 0.75
  ctx.fillText(dates, x, mid)
  if (inside) ctx.globalAlpha /= 0.75
  return x + measure(ctx, dates, ctx.font)
}
