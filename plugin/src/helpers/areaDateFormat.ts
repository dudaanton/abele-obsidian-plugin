import dayjs, { type Dayjs } from 'dayjs'
import { currentLocale, dateFormatter, numberFormatter, relativeFormatter } from '@/i18n'

/** Display only: storage and recurrence syntax continue to use their original formats. */
export function areaDate(value: Dayjs, pattern: string): string {
  const locale = currentLocale()
  if (locale.language === 'en') return value.format(pattern)
  const options: Intl.DateTimeFormatOptions = {}
  if (/Y/.test(pattern)) options.year = 'numeric'
  if (/MMMM/.test(pattern)) options.month = 'long'
  else if (/MMM/.test(pattern)) options.month = 'short'
  else if (/MM/.test(pattern)) options.month = '2-digit'
  if (/D/.test(pattern)) options.day = /DD/.test(pattern) ? '2-digit' : 'numeric'
  if (/dddd/.test(pattern)) options.weekday = 'long'
  else if (/ddd/.test(pattern)) options.weekday = 'short'
  else if (/dd/.test(pattern)) options.weekday = 'short'
  return dateFormatter(locale.format, options).format(value.toDate())
}

export function relativeDay(offset: number): string {
  if (currentLocale().language === 'en' && Math.abs(offset) <= 1)
    return ['Yesterday', 'Today', 'Tomorrow'][offset + 1]
  return relativeFormatter(currentLocale().format, { numeric: 'auto' }).format(offset, 'day')
}

export function areaCompactDate(value: Dayjs, now: Dayjs = dayjs()): string {
  return areaDate(value, value.isSame(now, 'year') ? 'DD.MM' : 'DD.MM.YYYY')
}

export function durationPart(value: number, unit: 'hour' | 'minute'): string {
  if (currentLocale().language === 'en') return `${value}${unit === 'hour' ? 'h' : 'm'}`
  return numberFormatter(currentLocale().format, {
    style: 'unit',
    unit,
    unitDisplay: 'narrow',
  }).format(value)
}

export function areaDuration(seconds: number, padMinutes = false): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (currentLocale().language === 'en')
    return hours > 0
      ? `${hours}h ${padMinutes ? String(minutes).padStart(2, '0') : minutes}m`
      : `${minutes}m`
  return hours > 0
    ? `${durationPart(hours, 'hour')} ${durationPart(minutes, 'minute')}`
    : durationPart(minutes, 'minute')
}
