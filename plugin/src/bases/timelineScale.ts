/**
 * The history timeline's scale: which stretch of years is on screen, how many pixels a year
 * takes, the zoom steps named in the header, and the ticks of the axis. Pure, no Obsidian.
 *
 * The scale is uniform, always: lengths are what gets compared on a timeline, and a scale that
 * squeezes the quiet centuries would make two lives of the same length look different.
 */
import { astroYear, dayPoint, daysIn, formatYear, humanYear, type HistLang } from './historyDates'

export interface Viewport {
  /** The year at the left edge of the drawing. */
  t0: number
  /** Pixels per year. */
  ppy: number
}

export const tToX = (v: Viewport, t: number): number => (t - v.t0) * v.ppy
export const xToT = (v: Viewport, x: number): number => v.t0 + x / v.ppy

/** The zoom kept on `t` at pixel `x` while pixels per year become `ppy`. */
export const zoomAt = (v: Viewport, x: number, ppy: number): Viewport => ({
  t0: xToT(v, x) - x / ppy,
  ppy,
})

export const ZOOM_LEVELS = ['millennia', 'centuries', 'decades', 'years', 'days'] as const
export type ZoomLevel = (typeof ZOOM_LEVELS)[number]

/** How many years a screen holds at each named step. */
const LEVEL_SPAN: Record<ZoomLevel, number> = {
  millennia: 3000,
  centuries: 400,
  decades: 60,
  years: 8,
  days: 0.25,
}

export const levelPpy = (level: ZoomLevel, width: number): number =>
  Math.max(1, width) / LEVEL_SPAN[level]

/** The named step nearest the zoom, for the header to show as chosen. */
export function nearestLevel(ppy: number, width: number): ZoomLevel {
  const span = Math.max(1, width) / ppy
  let best: ZoomLevel = 'centuries'
  let gap = Infinity
  for (const level of ZOOM_LEVELS) {
    const d = Math.abs(Math.log(span / LEVEL_SPAN[level]))
    if (d < gap) {
      gap = d
      best = level
    }
  }
  return best
}

/** Finest thing the data knows, as a span one screen may be zoomed to hold at most. */
export function finestSpan(precision: 'day' | 'month' | 'year'): number {
  return precision === 'day' ? 1 / 24 : precision === 'month' ? 1 : 5
}

/**
 * The zoom limits: out to where everything (and a margin) fits, but no further than twenty
 * thousand years; in to what the finest date in the base can say.
 */
export function zoomLimits(
  width: number,
  extent: [number, number] | null,
  finest: 'day' | 'month' | 'year'
): [number, number] {
  const w = Math.max(1, width)
  const span = extent ? Math.max(10, (extent[1] - extent[0]) * 1.4) : 3000
  const min = w / Math.min(20_000, Math.max(span, 50))
  const max = w / finestSpan(finest)
  return [Math.min(min, max), max]
}

export const clampPpy = (ppy: number, limits: [number, number]): number =>
  Math.min(limits[1], Math.max(limits[0], ppy))

/**
 * The layout of rows is worked out once per zoom bucket — a factor of √2 — rather than on
 * every frame, so that bars do not jump from row to row while a pinch goes on. A bucket's
 * layout is made at the bucket's smallest zoom: zooming in within it only makes more room.
 */
export const zoomBucket = (ppy: number): number => Math.floor(Math.log(ppy) / Math.log(Math.SQRT2))
export const bucketPpy = (bucket: number): number => Math.SQRT2 ** bucket

export interface Tick {
  t: number
  label: string
}

export interface Ticks {
  major: Tick[]
  minor: number[]
  /** The major step in years. */
  step: number
}

const YEAR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]
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
const MONTH_NAMES_RU = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
]

/** Human years `step` apart, on the line: 500 BC, 1, 500, 1000 — no year zero to land on. */
function yearTicks(t0: number, t1: number, step: number): number[] {
  const out: number[] = []
  const first = Math.floor(humanYear(t0) / step) * step
  for (let h = first; ; h += step) {
    const t = h === 0 ? 1 : astroYear(h)
    if (t > t1) break
    if (t >= t0 && (out.length === 0 || t > out[out.length - 1])) out.push(t)
    if (out.length > 2000) break
  }
  return out
}

function monthTicks(t0: number, t1: number, every: number): number[] {
  const out: number[] = []
  for (let y = Math.floor(t0); y <= Math.floor(t1); y++)
    for (let m = 1; m <= 12; m += every) {
      const t = dayPoint(y, m, 1)
      if (t >= t0 && t <= t1) out.push(t)
    }
  return out
}

function dayTicks(t0: number, t1: number, every: number): number[] {
  const out: number[] = []
  for (let y = Math.floor(t0); y <= Math.floor(t1); y++)
    for (let m = 1; m <= 12; m++) {
      const first = dayPoint(y, m, 1)
      const next = m === 12 ? y + 1 : dayPoint(y, m + 1, 1)
      if (next < t0 || first > t1) continue
      // Weekly ticks start again on the 1st of each month and stop before its last few days.
      for (let d = 1; d <= 31; d += every) {
        const t = dayPoint(y, m, d)
        if (t >= next - 1e-9 || (every > 1 && d + every > 32)) break
        if (t >= t0 && t <= t1) out.push(t)
      }
    }
  return out
}

/** Where a point of the line falls in its calendar: [year, month 1–12, day 1–31]. */
export function calendarOf(t: number): [number, number, number] {
  const y = Math.floor(t)
  for (let m = 12; m >= 1; m--) {
    const first = dayPoint(y, m, 1)
    if (t >= first - 1e-9) return [y, m, 1 + Math.floor((t - first) * daysIn(y) + 1e-6)]
  }
  return [y, 1, 1]
}

/** The axis between `t0` and `t1`, major ticks at least `minPx` apart. */
export function ticks(t0: number, t1: number, ppy: number, lang: HistLang, minPx = 90): Ticks {
  const months = lang === 'ru' ? MONTHS_RU : MONTHS_EN
  const monthNames = lang === 'ru' ? MONTH_NAMES_RU : MONTHS_EN
  // Days, a week, months: below a year a step.
  const sub: [number, 'day' | 'month', number][] = [
    [1 / 365, 'day', 1],
    [7 / 365, 'day', 7],
    [1 / 12, 'month', 1],
    [3 / 12, 'month', 3],
    [6 / 12, 'month', 6],
  ]
  for (const [step, unit, every] of sub) {
    if (step * ppy < minPx) continue
    const at = unit === 'day' ? dayTicks(t0, t1, every) : monthTicks(t0, t1, every)
    const major = at.map((t) => {
      const [y, m, d] = calendarOf(t)
      // A year's first month or day carries the year, the rest their own name.
      const label =
        m === 1 && d === 1
          ? formatYear(y, lang)
          : unit === 'day'
            ? `${d} ${months[m - 1]}`
            : monthNames[m - 1]
      return { t, label }
    })
    const minor = unit === 'day' ? [] : every > 1 ? monthTicks(t0, t1, 1) : dayTicks(t0, t1, 7)
    return { major, minor, step }
  }
  const step = YEAR_STEPS.find((s) => s * ppy >= minPx) ?? YEAR_STEPS[YEAR_STEPS.length - 1]
  const major = yearTicks(t0, t1, step).map((t) => ({ t, label: formatYear(t, lang) }))
  const minorStep = [...YEAR_STEPS]
    .reverse()
    .find((s) => s < step && step % s === 0 && s * ppy >= 8)
  const minor = minorStep
    ? yearTicks(t0, t1, minorStep)
    : step === 1 && ppy / 12 >= 8
      ? monthTicks(t0, t1, 1)
      : []
  return { major, minor, step }
}

/** Where a new note made at `t` is put: the year rounded to the axis's step. */
export function roundToStep(t: number, step: number): number {
  const h = humanYear(t)
  if (step <= 1) return h
  const r = Math.round(h / step) * step
  return r === 0 ? 1 : r
}
