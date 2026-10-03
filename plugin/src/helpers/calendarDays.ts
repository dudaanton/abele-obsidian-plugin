/** Calendar dates use UTC day numbers for arithmetic, not UTC days for local instants. */
export const DAY_MS = 86_400_000
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/
const pad = (n: number) => String(n).padStart(2, '0')

export function dayNumber(day: string): number {
  const m = DAY_RE.exec(day)
  if (!m) return NaN
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS)
}

export function dayString(n: number): string {
  const d = new Date(n * DAY_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export const addDays = (day: string, n: number): string => dayString(dayNumber(day) + n)

/** The day an instant falls on, according to the device's clock. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
