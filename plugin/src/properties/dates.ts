/**
 * A date property: the value stepped a day at a time, and how far away it is from now.
 *
 * The value is kept as it was written. `2026-03-01` stays a date; `2026-03-01T09:30` stays a date
 * and time, the time untouched by a step — and so do seconds, a space in place of the `T`, or a
 * zone at the end. Only the day changes. An empty or missing value counts as today, so + on a
 * property just added gives tomorrow. Anything that is not a date is not this widget's value.
 *
 * Arithmetic is done on the calendar date itself rather than on a moment in time, so a step over
 * a change to summer time is still exactly one day, and a month's end rolls into the next month.
 */

export interface DateValue {
  year: number
  month: number
  day: number
  /** `HH:mm` when the value has a time, else null. */
  time: string | null
  hour: number | null
  minute: number | null
  second: number | null
  /** What follows the date, kept as written: `T09:30`, ` 09:30:15`, `T09:30+02:00`… */
  rest: string
  /** The zone, when the value names one: a moment, not a wall-clock time. */
  zone: string | null
}

const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:([T ])(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

const isEmpty = (value: unknown) =>
  value == null || (typeof value === 'string' && value.trim() === '')

/** The parts of a date value, or null when the value is not a date. */
export function parseDateValue(value: unknown): DateValue | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const m = DATE_RE.exec(text)
  if (!m) return null
  const [, y, mo, d, sep, h, mi, s, zone] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  // 2026-02-30 is not a day.
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  const hasTime = sep !== undefined
  if (hasTime && (Number(h) > 23 || Number(mi) > 59)) return null
  return {
    year,
    month,
    day,
    time: hasTime ? `${h}:${mi}` : null,
    hour: hasTime ? Number(h) : null,
    minute: hasTime ? Number(mi) : null,
    second: s !== undefined ? Number(s) : null,
    rest: text.slice(10),
    zone: zone ?? null,
  }
}

/** Whether a value is this widget's to draw: a date, or nothing yet. */
export function isDateValue(value: unknown): boolean {
  return isEmpty(value) || parseDateValue(value) !== null
}

/** `YYYY-MM-DD` of a local day. */
export function formatDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The calendar day `days` away from `YYYY-MM-DD`, as `YYYY-MM-DD`. */
function shiftDay(year: number, month: number, day: number, days: number): string {
  const d = new Date(Date.UTC(year, month - 1, day + days))
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/**
 * The value `days` days on, in the shape it was written: a date stays a date, a date and time
 * keeps its time. An empty value counts as `today`. Null when the value is not a date.
 */
export function stepDate(value: unknown, days: number, today: Date = new Date()): string | null {
  if (isEmpty(value))
    return shiftDay(today.getFullYear(), today.getMonth() + 1, today.getDate(), days)
  const parsed = parseDateValue(value)
  if (!parsed) return null
  return shiftDay(parsed.year, parsed.month, parsed.day, days) + parsed.rest
}

/**
 * The value with its day replaced by `day` (`YYYY-MM-DD`) and, when given, its time by `time`
 * (`HH:mm`) — what a date picker hands back, written in the shape the value had. A value that had
 * no time gets one only when a time is given.
 */
export function withDay(value: unknown, day: string, time?: string | null): string {
  const parsed = parseDateValue(value)
  if (!time) return parsed && parsed.time ? day + parsed.rest : day
  if (!parsed || parsed.time === null) return `${day}T${time}`
  // Keep the separator, the seconds and the zone; the hour and minute are the picker's.
  return day + parsed.rest.slice(0, 1) + time + parsed.rest.slice(6)
}

/** The moment a value stands for: local wall-clock time unless it names a zone. */
export function dateOf(parsed: DateValue, time: string | null = parsed.time): Date {
  if (parsed.zone && parsed.time !== null) {
    return new Date(
      `${pad(parsed.year, 4)}-${pad(parsed.month)}-${pad(parsed.day)}T${parsed.time}:${pad(parsed.second ?? 0)}${parsed.zone}`
    )
  }
  const [h, m] = time ? time.split(':').map(Number) : [0, 0]
  return new Date(parsed.year, parsed.month - 1, parsed.day, h, m, parsed.second ?? 0)
}

/** `HH:mm` from a time property written beside a date (`dueTime: 14:30`), else null. */
export function timeOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${pad(Number(m[1]))}:${m[2]}`
}

const DAY_MS = 86_400_000

/**
 * How far a value is from `now`, in words: `today`, `in 3 days`, `2 days ago` for a date; for a
 * date with a time `in 1 d 5 h`, and `in 5 h` or `in 25 min` when less than a day is left.
 * `time` stands in for a value without one of its own (a task keeps it in `dueTime`).
 */
export function relativeTime(
  value: unknown,
  now: Date = new Date(),
  time: string | null = null
): string | null {
  const parsed = parseDateValue(value)
  if (!parsed) return null
  const clock = parsed.time ?? time
  if (clock === null) {
    const days = Math.round(
      (Date.UTC(parsed.year, parsed.month - 1, parsed.day) -
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
        DAY_MS
    )
    if (days === 0) return 'today'
    if (days === 1) return 'tomorrow'
    if (days === -1) return 'yesterday'
    const n = Math.abs(days)
    return days > 0 ? `in ${n} days` : `${n} days ago`
  }
  const diff = dateOf(parsed, clock).getTime() - now.getTime()
  const minutes = Math.floor(Math.abs(diff) / 60_000)
  if (minutes < 1) return 'now'
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  let span: string
  if (hours < 1) span = `${minutes} min`
  else if (days < 1) span = `${hours} h`
  else span = hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`
  return diff > 0 ? `in ${span}` : `${span} ago`
}
