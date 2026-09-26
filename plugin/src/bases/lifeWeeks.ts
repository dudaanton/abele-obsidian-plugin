/**
 * A life in weeks — the poster where every box is one week of a life: a row per year of age,
 * fifty-two boxes to a row. Pure, no Obsidian and no Vue.
 *
 * A row starts on a birthday, so its weeks are counted from the birthday and not from the
 * calendar's Monday: week 1 of age 30 is the seven days from the thirtieth birthday. A year is
 * 365 or 366 days, one or two more than 52 weeks, and the last week of each row takes them —
 * it runs eight or nine days — so every row starts on its birthday again. A birthday on
 * 29 February falls on the 28th in a year without one.
 *
 * Days are `YYYY-MM-DD` strings, as in `calendarLayout`: walking between them goes through day
 * numbers in UTC, which no clock change and no time zone moves.
 */
import { dayNumber, dayString, type CalendarItem } from './calendarLayout'

export const WEEKS_PER_ROW = 52
/** The half of a row, where a slightly wider gap is drawn. */
const HALF_ROW = 26
/** Rows between the wider gaps, so the decades read at a glance. */
const DECADE = 10
export const DEFAULT_LIFE_YEARS = 80
/** The longest life a view may be asked to draw. */
export const MAX_LIFE_YEARS = 120

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A date written the way the settings keep it, and a real day of the calendar. */
export function isBirthDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = DAY_RE.exec(value)
  if (!m) return false
  return dayString(dayNumber(value)) === value && +m[2] >= 1 && +m[2] <= 12
}

/** The birthday at `age`: the same month and day, or 28 February for a 29th that year lacks. */
export function birthday(birth: string, age: number): string {
  const year = Number(birth.slice(0, 4)) + age
  const rest = birth.slice(4)
  if (rest === '-02-29' && dayString(dayNumber(`${year}-02-29`)) !== `${year}-02-29`)
    return `${year}-02-28`
  return `${String(year).padStart(4, '0')}${rest}`
}

export interface LifeWeekPlace {
  /** Years of age: the row. */
  age: number
  /** 0 to 51: the column. */
  week: number
  /** `age * 52 + week`: the week's place in the whole life. */
  index: number
}

export interface LifeWeek extends LifeWeekPlace {
  start: string
  end: string
}

/** The week of the life a day is in; null for a day before the birth. */
export function lifeWeekOf(birth: string, day: string): LifeWeekPlace | null {
  const n = dayNumber(day)
  if (n < dayNumber(birth)) return null
  let age = Number(day.slice(0, 4)) - Number(birth.slice(0, 4))
  if (n < dayNumber(birthday(birth, age))) age--
  const from = dayNumber(birthday(birth, age))
  const week = Math.min(WEEKS_PER_ROW - 1, Math.floor((n - from) / 7))
  return { age, week, index: age * WEEKS_PER_ROW + week }
}

/** The days the week at `index` covers; the last of a row runs to the eve of the birthday. */
export function lifeWeekAt(birth: string, index: number): LifeWeek {
  const age = Math.floor(index / WEEKS_PER_ROW)
  const week = index % WEEKS_PER_ROW
  const from = dayNumber(birthday(birth, age)) + week * 7
  const end = week === WEEKS_PER_ROW - 1 ? dayNumber(birthday(birth, age + 1)) - 1 : from + 6
  return { age, week, index, start: dayString(from), end: dayString(end) }
}

/**
 * How many items each week of `rows` years holds, by the week's index. An item is counted once
 * in every week it touches; what lies before the birth or past the last row is left out.
 */
export function lifeCounts(
  items: readonly CalendarItem[],
  birth: string,
  rows: number
): Uint32Array {
  const counts = new Uint32Array(rows * WEEKS_PER_ROW)
  const first = dayNumber(birth)
  const last = dayNumber(birthday(birth, rows)) - 1
  for (const item of items) {
    const s = Math.max(dayNumber(item.start), first)
    const e = Math.min(dayNumber(item.end), last)
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) continue
    const from = lifeWeekOf(birth, dayString(s))
    const to = lifeWeekOf(birth, dayString(e))
    if (!from || !to) continue
    for (let i = from.index; i <= to.index; i++) counts[i]++
  }
  return counts
}

export interface LifeSummary {
  /** Weeks in the expected life. */
  total: number
  /** Weeks behind: the ones before this one. */
  lived: number
  /** Weeks ahead, this one among them. */
  left: number
  /** This week's index, -1 when it is outside the expected life. */
  current: number
  /** How much of it is behind, to one decimal. */
  percent: number
}

export function lifeSummary(birth: string, years: number, today: string): LifeSummary {
  const total = years * WEEKS_PER_ROW
  const now = lifeWeekOf(birth, today)
  const lived = now ? Math.min(total, now.index) : 0
  const current = now && now.index < total ? now.index : -1
  return {
    total,
    lived,
    left: total - lived,
    current,
    percent: Math.round((lived / total) * 1000) / 10,
  }
}

/** Rows to draw: the expected years, or up to this year of age for someone already past them. */
export function lifeRows(birth: string, years: number, today: string): number {
  const now = lifeWeekOf(birth, today)
  return Math.min(MAX_LIFE_YEARS + 30, Math.max(years, now ? now.age + 1 : 0))
}

/** The expected age a view's option asks for, or `fallback` when it asks for nothing sensible. */
export function lifeYears(option: unknown, fallback: number): number {
  const text = typeof option === 'number' || typeof option === 'string' ? String(option).trim() : ''
  if (!/^\d+$/.test(text)) return fallback
  const years = Number(text)
  return years >= 1 && years <= MAX_LIFE_YEARS ? years : fallback
}

// ---- the grid ------------------------------------------------------------------------------

export interface LifeGrid {
  rows: number
  /** A week's box, in CSS pixels. */
  cell: number
  gap: number
  /** Room on the left for the ages. */
  label: number
  /** Room on top for the week numbers; none when the boxes are too small to be numbered. */
  top: number
  /** Extra room at the half of a row, and between decades. */
  half: number
  decade: number
  width: number
  height: number
  /** Boxes large enough to carry their count. */
  numbers: boolean
  /** Every how many years an age is written. */
  ageStep: number
}

const MAX_CELL = 20
const MIN_CELL = 3
/** From this size a box has room for the number of items in it. */
const NUMBER_CELL = 15

/** The largest boxes that put fifty-two weeks across `width`, and where everything goes. */
export function lifeGrid(width: number, rows: number): LifeGrid {
  const label = width < 520 ? 16 : 28
  let cell = MAX_CELL
  let gap = 2
  let half = 4
  const across = () => label + WEEKS_PER_ROW * cell + (WEEKS_PER_ROW - 1) * gap + half
  while (cell > MIN_CELL) {
    gap = cell >= 10 ? 2 : 1
    half = gap * 2
    if (across() <= width) break
    cell--
  }
  gap = cell >= 10 ? 2 : 1
  half = gap * 2
  const top = cell >= 8 ? 14 : 0
  const decade = gap * 3
  const grid: LifeGrid = {
    rows,
    cell,
    gap,
    label,
    top,
    half,
    decade,
    width: across(),
    height: 0,
    numbers: cell >= NUMBER_CELL,
    ageStep: cell >= 9 ? 5 : 10,
  }
  grid.height = rowY(grid, rows - 1) + cell
  return grid
}

const columnX = (g: LifeGrid, column: number): number =>
  g.label + column * (g.cell + g.gap) + (column >= HALF_ROW ? g.half : 0)

export const rowY = (g: LifeGrid, row: number): number =>
  g.top + row * (g.cell + g.gap) + Math.floor(row / DECADE) * g.decade

/** The top left corner of the week at `index`. */
export function weekOrigin(g: LifeGrid, index: number): [number, number] {
  return [columnX(g, index % WEEKS_PER_ROW), rowY(g, Math.floor(index / WEEKS_PER_ROW))]
}

/** The week whose box is under a point of the grid; null over a gap, a label or past the end. */
export function weekAtPoint(g: LifeGrid, x: number, y: number): number | null {
  const pitch = g.cell + g.gap
  let column = Math.floor((x - g.label) / pitch)
  if (column >= HALF_ROW) column = Math.floor((x - g.label - g.half) / pitch)
  let row = Math.min(g.rows - 1, Math.floor((y - g.top) / pitch))
  while (row > 0 && rowY(g, row) > y) row--
  if (column < 0 || column >= WEEKS_PER_ROW || row < 0) return null
  const cx = columnX(g, column)
  const cy = rowY(g, row)
  if (x < cx || x >= cx + g.cell || y < cy || y >= cy + g.cell) return null
  return row * WEEKS_PER_ROW + column
}
