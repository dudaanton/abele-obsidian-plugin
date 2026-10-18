import { formatTimestamp as originalTimestamp } from '@/helpers/displayFormat'
import dayjs, { type Dayjs } from 'dayjs'
import { currentLocale, dateFormatter, relativeFormatter, numberFormatter, t } from './index'

/** Display only; date keys, input values and protocol timestamps retain their formats. */
export function streamBDate(value: Dayjs, pattern: string): string {
  const locale = currentLocale()
  if (locale.language === 'en') return value.format(pattern)
  const options: Intl.DateTimeFormatOptions = {}
  if (/Y/.test(pattern)) options.year = 'numeric'
  if (/MMM/.test(pattern)) options.month = /MMMM/.test(pattern) ? 'long' : 'short'
  if (/D/.test(pattern)) options.day = 'numeric'
  if (/H/.test(pattern))
    Object.assign(options, { hour: '2-digit', minute: '2-digit', hour12: false })
  return dateFormatter(locale.format, options).format(value.toDate())
}

export function streamBAgo(at: number, now = Date.now()): string {
  const min = Math.round((now - at) / 60_000)
  if (min < 1) return t('streamB.justNow.7ddb44')
  const hours = Math.round(min / 60)
  const days = Math.round(hours / 24)
  if (currentLocale().language === 'en') {
    if (min < 60) return `${min} min ago`
    if (hours < 24) return `${hours} h ago`
    return days === 1 ? 'yesterday' : `${days} days ago`
  }
  const relative = relativeFormatter(currentLocale().format, { numeric: 'auto' })
  return min < 60
    ? relative.format(-min, 'minute')
    : hours < 24
      ? relative.format(-hours, 'hour')
      : relative.format(-days, 'day')
}

export const streamBTimestamp = (date: Date): string =>
  currentLocale().language === 'en'
    ? date.toLocaleString()
    : date.toLocaleString(currentLocale().format)

export function streamBGithubDate(iso: string | undefined, short = false): string {
  if (!iso) return ''
  const date = dayjs(iso)
  if (!date.isValid()) return ''
  return streamBDate(
    date,
    short ? (date.isSame(dayjs(), 'year') ? 'D MMM, HH:mm' : 'D MMM YYYY') : 'D MMM YYYY, HH:mm'
  )
}

export const streamBNumber = (value: number): string =>
  currentLocale().language === 'en'
    ? value.toLocaleString()
    : numberFormatter(currentLocale().format, {}).format(value)

/** UI projection of timestamps; ISO values and diagnostic timezone identities stay stable. */
export function streamBTime(
  value: Parameters<typeof originalTimestamp>[0],
  options: Parameters<typeof originalTimestamp>[1] = {}
) {
  const original = originalTimestamp(value, options)
  if (!original.datetime) {
    const label = currentLocale().language === 'en' ? original.label : t('chat.timeUnknown')
    return { ...original, label, exact: label, clock: label, day: label, today: false }
  }
  const date = new Date(original.datetime),
    now = options.now ?? new Date()
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const ordinal = (at: Date) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
        .formatToParts(at)
        .map((p) => [p.type, p.value])
    )
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86400000
  }
  const delta = Number.isFinite(now.getTime()) ? ordinal(date) - ordinal(now) : NaN
  if (currentLocale().language === 'en')
    return {
      ...original,
      clock: original.exact.split(', ')[1].slice(0, 5),
      day: original.exact.split(', ')[0],
      today: delta === 0,
    }
  const locale = currentLocale().format
  const clock = dateFormatter(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
  const day = dateFormatter(locale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  const exact = options.diagnostic
    ? dateFormatter(locale, {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'shortOffset',
      }).format(date) +
      ' ' +
      timeZone
    : day + ', ' + clock
  const relative =
    Math.abs(delta) <= 1 ? relativeFormatter(locale, { numeric: 'auto' }).format(delta, 'day') : ''
  return {
    ...original,
    exact,
    label: options.mode !== 'absolute' && relative ? relative + ', ' + clock : exact,
    clock,
    day,
    today: delta === 0,
  }
}
