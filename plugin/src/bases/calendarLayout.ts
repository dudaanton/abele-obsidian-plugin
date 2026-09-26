/**
 * Where things go on the calendar view of a base — pure, no Obsidian and no Vue, so every rule
 * about placement is tested on its own.
 *
 * Days are `YYYY-MM-DD` strings throughout: they sort as text, they are what the vault writes,
 * and they are what the external calendars already index by. Walking from one day to the next
 * goes through a day number (days since 1970 in UTC), which never meets a clock change.
 */
import type { KitColor } from '@/constants/colors'
import { eventDays, type CalendarEvent } from '@/calendars/events'

export type CalendarMode = 'month' | 'week' | 'year'
export const CALENDAR_MODES: CalendarMode[] = ['month', 'week', 'year']

export const MINUTES_IN_DAY = 24 * 60
/** How long a timed item with no end is drawn. */
export const DEFAULT_DURATION = 60
/** The shortest a timed item is drawn, so a five-minute call still has room for its title. */
export const MIN_DRAWN_DURATION = 30

export interface CalendarItem {
  /** Unique among the items: a note's path, an event's id. */
  id: string
  kind: 'note' | 'event'
  /** The note it opens; empty for an event. */
  path: string
  title: string
  /** First day, `YYYY-MM-DD`. */
  start: string
  /** Last day, never before `start`. */
  end: string
  /** Minutes after midnight on `start`; null for an item with no time. */
  startMinute: number | null
  /** Minutes after midnight on `end`; null when there is no end time. */
  endMinute: number | null
  color: KitColor | null
  completed: boolean
}

// ---- days ------------------------------------------------------------------------------------

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/

export function dayNumber(day: string): number {
  const m = DAY_RE.exec(day)
  if (!m) return NaN
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000)
}

export function dayString(n: number): string {
  const d = new Date(n * 86_400_000)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export const addDays = (day: string, n: number): string => dayString(dayNumber(day) + n)

/** 0 for Sunday … 6 for Saturday, as `Date.getDay`. */
export const weekday = (day: string): number => (((dayNumber(day) + 4) % 7) + 7) % 7

/** The first day of the week `day` is in. */
export function startOfWeek(day: string, mondayFirst: boolean): string {
  const shift = (weekday(day) - (mondayFirst ? 1 : 0) + 7) % 7
  return addDays(day, -shift)
}

export const daysBetween = (from: string, to: string): string[] => {
  const out: string[] = []
  for (let n = dayNumber(from), last = dayNumber(to); n <= last; n++) out.push(dayString(n))
  return out
}

/** The seven days of the week `day` is in. */
export const weekDays = (day: string, mondayFirst: boolean): string[] => {
  const first = startOfWeek(day, mondayFirst)
  return daysBetween(first, addDays(first, 6))
}

const pad2 = (v: number) => String(v).padStart(2, '0')
export const monthStart = (year: number, month: number): string => `${year}-${pad2(month + 1)}-01`
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

/**
 * The days a month is drawn with, whole weeks from the one holding the 1st to the one holding
 * the last day — four to six rows, as the mini calendar draws it.
 */
export function monthGrid(year: number, month: number, mondayFirst: boolean): string[] {
  const first = monthStart(year, month)
  const last = `${year}-${pad2(month + 1)}-${pad2(daysInMonth(year, month))}`
  const from = startOfWeek(first, mondayFirst)
  const to = addDays(startOfWeek(last, mondayFirst), 6)
  return daysBetween(from, to)
}

// ---- reading property values ---------------------------------------------------------------

export interface ReadDate {
  day: string
  minute: number | null
}

const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2}))?/

/**
 * A day, and a time when the value carries one, out of whatever a base hands over: a date
 * value, text, a list whose first element is a date. Only a value that *starts* with a date
 * counts — a title that mentions one does not.
 */
export function readDate(raw: unknown): ReadDate | null {
  if (raw == null) return null
  const text = (Array.isArray(raw) ? String(raw[0] ?? '') : String(raw)).trim()
  const m = DATE_TIME_RE.exec(text)
  if (!m || Number.isNaN(dayNumber(m[1]))) return null
  if (m[2] === undefined) return { day: m[1], minute: null }
  const minute = +m[2] * 60 + +m[3]
  return { day: m[1], minute: minute < MINUTES_IN_DAY ? minute : null }
}

const TIME_RE = /^(\d{1,2}):(\d{2})/

/**
 * A time of day in minutes: `HH:mm` text, or the number YAML makes of `9:30` written without
 * quotes (it reads it in base 60, as 570).
 */
export function readTime(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 && raw < MINUTES_IN_DAY ? raw : null
  }
  const m = TIME_RE.exec(String(raw).trim())
  if (!m) return null
  const minute = +m[1] * 60 + +m[2]
  return +m[2] < 60 && minute < MINUTES_IN_DAY ? minute : null
}

export interface ItemSource {
  path: string
  title: string
  start: unknown
  startTime?: unknown
  end?: unknown
  endTime?: unknown
  color?: KitColor | null
  completed?: boolean
}

/**
 * A note as the calendar places it, following the task model: on its date, or on its end date
 * when it has only that (a task with nothing but `due`); across the days between when it has
 * both. A time comes from the date value itself or from the separate time property.
 * Null when there is no date to place it by.
 */
export function toItem(source: ItemSource): CalendarItem | null {
  const s = readDate(source.start)
  const e = readDate(source.end)
  if (!s && !e) return null
  const base = {
    id: source.path,
    kind: 'note' as const,
    path: source.path,
    title: source.title,
    color: source.color ?? null,
    completed: !!source.completed,
  }
  if (!s) {
    const due = e as ReadDate
    const minute = due.minute ?? readTime(source.endTime)
    return { ...base, start: due.day, end: due.day, startMinute: minute, endMinute: null }
  }
  const startMinute = s.minute ?? readTime(source.startTime)
  let end = s.day
  let endMinute: number | null = null
  if (e && e.day >= s.day) {
    const eMinute = e.minute ?? readTime(source.endTime)
    if (e.day > s.day) {
      end = e.day
      endMinute = eMinute
    } else if (startMinute !== null && eMinute !== null && eMinute > startMinute) {
      endMinute = eMinute
    }
  }
  return { ...base, start: s.day, end, startMinute, endMinute }
}

// ---- placing -------------------------------------------------------------------------------

export const isMultiDay = (item: CalendarItem): boolean => item.end > item.start
export const isTimed = (item: CalendarItem): boolean =>
  item.startMinute !== null && !isMultiDay(item)

export interface PlacedItem {
  item: CalendarItem
  day: string
  /** It began on an earlier day. */
  fromBefore: boolean
  /** It goes on to a later day. */
  goesOn: boolean
}

/** Longer spans first, then things with no time, then by time, then by title. */
export function compareItems(a: CalendarItem, b: CalendarItem): number {
  const spanA = isMultiDay(a) ? 1 : 0
  const spanB = isMultiDay(b) ? 1 : 0
  if (spanA !== spanB) return spanB - spanA
  if (spanA) {
    if (a.start !== b.start) return a.start < b.start ? -1 : 1
    if (a.end !== b.end) return a.end > b.end ? -1 : 1
  }
  const tA = a.startMinute ?? -1
  const tB = b.startMinute ?? -1
  if (!spanA && tA !== tB) return tA - tB
  return a.title.localeCompare(b.title)
}

/**
 * Every item on each day from `from` to `to` it covers, in the order a day lists them. A span
 * reaching outside the range is clipped to it, so a year-long item costs the days drawn, not
 * the days it lasts.
 */
export function placeByDay(
  items: readonly CalendarItem[],
  from: string,
  to: string
): Map<string, PlacedItem[]> {
  const out = new Map<string, PlacedItem[]>()
  const first = dayNumber(from)
  const last = dayNumber(to)
  for (const item of items) {
    const s = dayNumber(item.start)
    const e = dayNumber(item.end)
    if (e < first || s > last) continue
    for (let n = Math.max(s, first), stop = Math.min(e, last); n <= stop; n++) {
      const day = dayString(n)
      let list = out.get(day)
      if (!list) out.set(day, (list = []))
      list.push({ item, day, fromBefore: n > s, goesOn: n < e })
    }
  }
  for (const list of out.values()) list.sort((a, b) => compareItems(a.item, b.item))
  return out
}

/** How many items each day of the range holds — what the year is tinted by. */
export function countByDay(
  items: readonly CalendarItem[],
  from: string,
  to: string
): Map<string, number> {
  const out = new Map<string, number>()
  const first = dayNumber(from)
  const last = dayNumber(to)
  for (const item of items) {
    const s = Math.max(dayNumber(item.start), first)
    const e = Math.min(dayNumber(item.end), last)
    for (let n = s; n <= e; n++) {
      const day = dayString(n)
      out.set(day, (out.get(day) ?? 0) + 1)
    }
  }
  return out
}

/**
 * One of five tints for a day in the year: 0 for nothing, 1 to 4 relative to the busiest day
 * of that year, so a quiet year still shows where its activity is.
 */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0
  if (max === 1) return 4
  return (1 + Math.min(3, Math.floor((3 * (count - 1)) / (max - 1)))) as 1 | 2 | 3 | 4
}

// ---- the week's hours ----------------------------------------------------------------------

export interface TimedBlock {
  item: CalendarItem
  /** Minutes after midnight where it is drawn from and to. */
  top: number
  bottom: number
  /** Which of `columns` side-by-side places it takes, for items at the same time. */
  column: number
  columns: number
}

/**
 * The timed items of one day as blocks on the hour grid. Items that overlap share the width:
 * each cluster of overlapping items is split into as many columns as it needs at its busiest,
 * and every item takes the first column free at its start.
 */
export function layoutTimed(items: readonly CalendarItem[]): TimedBlock[] {
  const blocks: TimedBlock[] = items
    .filter(isTimed)
    .map((item) => {
      const top = item.startMinute!
      const wanted = item.endMinute ?? top + DEFAULT_DURATION
      const bottom = Math.min(MINUTES_IN_DAY, Math.max(wanted, top + MIN_DRAWN_DURATION))
      return { item, top, bottom, column: 0, columns: 1 }
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom || compareItems(a.item, b.item))

  let cluster: TimedBlock[] = []
  let columnEnds: number[] = []
  let clusterEnd = -1
  const close = () => {
    for (const block of cluster) block.columns = columnEnds.length
    cluster = []
    columnEnds = []
  }
  for (const block of blocks) {
    if (block.top >= clusterEnd) close()
    let column = columnEnds.findIndex((end) => end <= block.top)
    if (column === -1) column = columnEnds.push(block.bottom) - 1
    else columnEnds[column] = block.bottom
    block.column = column
    cluster.push(block)
    clusterEnd = Math.max(clusterEnd, block.bottom)
  }
  close()
  return blocks
}

export const clock = (minute: number): string =>
  `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`

// ---- a new note ----------------------------------------------------------------------------

export interface NewNoteTarget {
  /** Frontmatter key of the date property; null when the date is not a note property. */
  dateKey: string | null
  /** Frontmatter key of the time property; null when there is none. */
  timeKey: string | null
}

/**
 * What a note created on the calendar gets written into its frontmatter: the day, and the hour
 * when it was made on the week's grid — in the time property when there is one, otherwise in
 * the date itself. False when the date is not something a note can hold (a formula).
 */
export function newNoteFrontmatter(
  target: NewNoteTarget,
  day: string,
  minute: number | null
): Record<string, string> | false {
  if (!target.dateKey) return false
  if (minute === null) return { [target.dateKey]: day }
  if (target.timeKey) return { [target.dateKey]: day, [target.timeKey]: clock(minute) }
  return { [target.dateKey]: `${day}T${clock(minute)}` }
}

// ---- external calendars --------------------------------------------------------------------

const minuteOf = (ms: number): number => {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * An event from an external calendar placed like a note: on the days it touches on this
 * device's clock, a day-long one on its own dates. Its id is the occurrence's, so the view
 * finds the event again when it is pressed.
 */
export function eventToItem(event: CalendarEvent, color: KitColor): CalendarItem | null {
  const days = eventDays(event)
  if (!days.length) return null
  const timed = !event.allDay
  const endMinute = timed && event.end > event.start ? minuteOf(event.end) : null
  return {
    id: event.id,
    kind: 'event',
    path: '',
    title: event.title,
    start: days[0],
    end: days[days.length - 1],
    startMinute: timed ? minuteOf(event.start) : null,
    // Until midnight is the end of the day it is on, not the start of the next.
    endMinute: endMinute === 0 ? MINUTES_IN_DAY : endMinute,
    color,
    completed: false,
  }
}
