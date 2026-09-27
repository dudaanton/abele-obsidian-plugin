/**
 * The frame around the history timeline's rows, painted over them: the names of the rows, the
 * axis with its years and the strip of eras, the year under the pointer, and the overview of the
 * whole base at the foot, with where the screen is.
 */
import { formatYear, type HistLang } from '@/bases/historyDates'
import { density } from '@/bases/timelineLayout'
import { calendarOf, xToT, type Ticks } from '@/bases/timelineScale'
import type { Hit } from './timelineScene'
import type { Frame } from './timelineDraw'
import { ellipsis, fontOf, measure, withAlpha } from './timelineText'

export function paintLaneNames(ctx: CanvasRenderingContext2D, f: Frame, top: number, bottom: number) {
  const { palette: p, scene } = f
  const m = scene.metrics
  if (scene.focus) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, top, f.width, bottom - top)
  ctx.clip()
  if (m.labelW) {
    ctx.fillStyle = p.background
    ctx.fillRect(0, top, m.labelW, bottom - top)
    ctx.strokeStyle = p.border
    ctx.beginPath()
    ctx.moveTo(m.labelW - 0.5, top)
    ctx.lineTo(m.labelW - 0.5, bottom)
    ctx.stroke()
  }
  for (const box of scene.boxes) {
    if (!box.lane.label) continue
    const y0 = top + box.top - f.scrollY
    if (y0 > bottom || y0 + box.height < top) continue
    const color = box.lane.color ? p.colors[box.lane.color] : p.accent
    const y = m.labelW ? y0 + m.laneHead + m.lineH / 2 : y0 + m.laneHead / 2 + 1
    const x = m.labelW ? 14 : 10
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.textAlign = 'left'
    ctx.font = fontOf(p, true, m.labelW ? p.small : p.smaller)
    ctx.fillStyle = m.labelW ? p.text : p.muted
    const room = m.labelW ? m.labelW - x - 14 : f.width
    ctx.fillText(ellipsis(ctx, box.lane.label, room), x + 10, y)
    if (m.labelW) {
      ctx.font = fontOf(p, false)
      ctx.fillStyle = p.faint
      const n = box.lane.count
      ctx.fillText(n === 1 ? '1 note' : `${n} notes`, x + 10, y + p.small + 4)
    }
  }
  ctx.restore()
}

export function paintAxis(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  X: (t: number) => number,
  t0: number,
  t1: number,
  hits: Hit[]
): void {
  const { palette: p, scene, width } = f
  const m = scene.metrics
  ctx.fillStyle = p.background
  ctx.fillRect(0, 0, width, m.axisH)
  ctx.strokeStyle = p.border
  ctx.beginPath()
  ctx.moveTo(0, m.axisH - 0.5)
  ctx.lineTo(width, m.axisH - 0.5)
  ctx.stroke()
  ctx.save()
  ctx.beginPath()
  ctx.rect(m.labelW, 0, width - m.labelW, f.height)
  ctx.clip()
  ctx.strokeStyle = p.faint
  for (const t of f.ticks.minor) {
    const x = Math.round(X(t)) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, m.axisH - 5)
    ctx.lineTo(x, m.axisH)
    ctx.stroke()
  }
  ctx.font = fontOf(p, true, p.small)
  ctx.textAlign = 'left'
  for (const tick of f.ticks.major) {
    const x = Math.round(X(tick.t)) + 0.5
    ctx.strokeStyle = p.muted
    ctx.beginPath()
    ctx.moveTo(x, m.axisH - 10)
    ctx.lineTo(x, m.axisH)
    ctx.stroke()
    ctx.fillStyle = p.text
    ctx.fillText(tick.label, x + 4, m.axisH / 2 - 2)
  }
  if (scene.eras.length) {
    // The strip of eras, their names in it; eras that overlap take a line each.
    const rows = scene.eraRows
    ctx.fillStyle = p.background
    ctx.fillRect(m.labelW, m.axisH, width - m.labelW, rows * m.eraH)
    ctx.font = fontOf(p, true)
    scene.eras.forEach((era, i) => {
      if (era.to < t0 || era.from > t1) return
      const a = Math.max(m.labelW, X(era.from))
      const b = Math.min(width, X(era.to))
      if (b - a < 2) return
      const y = m.axisH + (scene.eraLines.get(era) ?? 0) * m.eraH
      ctx.fillStyle = withAlpha(i % 2 ? p.faint : p.accent, i % 2 ? 0.14 : 0.18)
      ctx.fillRect(a, y + 2, b - a - 1, m.eraH - 4)
      if (era === f.selected) {
        ctx.strokeStyle = p.text
        ctx.strokeRect(a + 0.5, y + 2.5, b - a - 2, m.eraH - 5)
      }
      ctx.fillStyle = p.text
      const room = b - a - 12
      if (room > 20) ctx.fillText(ellipsis(ctx, era.title, room), a + 6, y + m.eraH / 2 + 0.5)
      hits.push({ kind: 'era', item: era, x: a, y: y + 2, w: b - a, h: m.eraH - 4 })
    })
    ctx.strokeStyle = p.border
    ctx.beginPath()
    ctx.moveTo(m.labelW, m.axisH + rows * m.eraH - 0.5)
    ctx.lineTo(width, m.axisH + rows * m.eraH - 0.5)
    ctx.stroke()
  }
  ctx.restore()
}

export function paintCursor(ctx: CanvasRenderingContext2D, f: Frame, top: number, bottom: number) {
  const { palette: p, scene } = f
  const m = scene.metrics
  if (f.cursorX === null || f.cursorX < m.labelW) return
  const x = Math.round(f.cursorX) + 0.5
  ctx.strokeStyle = withAlpha(p.text, 0.45)
  ctx.setLineDash([2, 3])
  ctx.beginPath()
  ctx.moveTo(x, top)
  ctx.lineTo(x, bottom)
  ctx.stroke()
  ctx.setLineDash([])
  const t = xToT(f.view, f.cursorX - m.labelW)
  const label = cursorLabel(t, f)
  ctx.font = fontOf(p, true)
  const w = measure(ctx, label, ctx.font) + 12
  const h = p.smaller + 8
  const bx = Math.min(f.width - w - 2, Math.max(m.labelW + 2, x - w / 2))
  const by = m.axisH - h - 3
  ctx.beginPath()
  ctx.roundRect(bx, by, w, h, h / 2)
  ctx.fillStyle = p.text
  ctx.fill()
  ctx.fillStyle = p.background
  ctx.textAlign = 'center'
  ctx.fillText(label, bx + w / 2, by + h / 2 + 0.5)
  ctx.textAlign = 'left'
}

/** The year under the pointer — or its month, zoomed in far enough to tell. */
export function cursorLabel(t: number, f: { ticks: Ticks; lang: HistLang }): string {
  if (f.ticks.step >= 1) return formatYear(t, f.lang)
  const [y, month, day] = calendarOf(t)
  const names = f.lang === 'ru' ? MONTHS_RU : MONTHS_EN
  const year = formatYear(y, f.lang)
  return f.ticks.step < 1 / 12
    ? `${day} ${names[month - 1]} ${year}`
    : `${names[month - 1]} ${year}`
}

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const MONTHS_RU = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
]

export function paintOverview(ctx: CanvasRenderingContext2D, f: Frame, y: number) {
  const { palette: p, scene, width } = f
  const m = scene.metrics
  const h = m.minimapH
  ctx.fillStyle = p.secondary
  ctx.fillRect(0, y, width, h)
  ctx.strokeStyle = p.border
  ctx.beginPath()
  ctx.moveTo(0, y + 0.5)
  ctx.lineTo(width, y + 0.5)
  ctx.stroke()
  const [a, b] = f.extent
  if (b <= a) return
  const bins = Math.max(1, Math.floor(width / 3))
  const counts = density(scene.all, a, b, bins)
  let max = 0
  for (const c of counts) max = Math.max(max, c)
  const w = width / bins
  ctx.fillStyle = withAlpha(p.muted, 0.5)
  for (let i = 0; i < bins; i++) {
    if (!counts[i]) continue
    const bh = Math.max(1, ((h - 10) * counts[i]) / max)
    ctx.fillRect(i * w, y + h - 4 - bh, Math.max(1, w - 0.5), bh)
  }
  // Where the screen is.
  const k = width / (b - a)
  const v0 = (xToT(f.view, 0) - a) * k
  const v1 = (xToT(f.view, width - m.labelW) - a) * k
  const rx = Math.max(0, Math.min(width - 4, v0))
  const rw = Math.max(4, Math.min(width, v1) - rx)
  ctx.fillStyle = withAlpha(p.accent, 0.15)
  ctx.fillRect(rx, y + 3, rw, h - 6)
  ctx.strokeStyle = p.accent
  ctx.lineWidth = 1.5
  ctx.strokeRect(rx + 0.75, y + 3.75, rw - 1.5, h - 7.5)
  ctx.lineWidth = 1
}

/** The overview's stretch of years at a point of it. */
export const overviewT = (extent: [number, number], width: number, x: number): number =>
  extent[0] + (x / Math.max(1, width)) * (extent[1] - extent[0])
