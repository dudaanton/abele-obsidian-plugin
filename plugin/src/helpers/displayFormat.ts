export type TimestampValue = string | number | Date | null | undefined

/** Presentation only: storage/serialization is deliberately left to the caller. */
export function formatTimestamp(
  value: TimestampValue,
  options: {
    now?: Date
    mode?: 'relative' | 'absolute'
    timeZone?: string
    diagnostic?: boolean
  } = {}
): { label: string; exact: string; datetime: string | undefined } {
  const unknown: { label: string; exact: string; datetime: string | undefined } = {
    label: 'Time unknown',
    exact: 'Time unknown',
    datetime: undefined,
  }
  if (value === null || value === undefined || value === '') return unknown
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return unknown
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  })
  const parts = (d: Date) =>
    Object.fromEntries(formatter.formatToParts(d).map((p) => [p.type, p.value]))
  const p = parts(date)
  const clock = `${p.hour}:${p.minute}`
  const exact = `${p.day}.${p.month}.${p.year}, ${clock}${options.diagnostic ? `:${p.second} ${timeZone} (${p.timeZoneName})` : ''}`
  // Calendar arithmetic in the selected zone, not elapsed milliseconds over a DST change.
  const ordinal = (v: Record<string, string>) =>
    Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day)) / 86400000
  const now = options.now ?? new Date()
  const day = Number.isFinite(now.getTime())
    ? relativeDayLabel(ordinal(p) - ordinal(parts(now)))
    : ''
  return {
    label: options.mode !== 'absolute' && day ? `${day}, ${clock}` : exact,
    exact,
    datetime: date.toISOString(),
  }
}

/** Existing binary-size presentation; deliberately keeps MB even above one gigabyte. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Whole minutes; row and summary padding remain an explicit consumer policy. */
export function formatDuration(seconds: number, padMinutes = false): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${padMinutes ? String(minutes).padStart(2, '0') : minutes}m`
  return `${minutes}m`
}

export function formatTokenCount(
  value: number,
  options: { decimals?: number; uppercase?: boolean; millions?: boolean } = {}
): string {
  if (options.millions && value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000)
    return `${(value / 1000).toFixed(options.decimals ?? 1)}${options.uppercase ? 'K' : 'k'}`
  return String(value)
}

/** Not CSV: no quoting, sorting or deduplication. */
export function parseCommaList(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Caller supplies a local-day difference, not elapsed milliseconds or UTC dates. */
export function relativeDayLabel(dayDifference: number): string {
  return dayDifference === 0
    ? 'Today'
    : dayDifference === -1
      ? 'Yesterday'
      : dayDifference === 1
        ? 'Tomorrow'
        : ''
}
