import { resolveLocale } from './core'
/** Cache by canonical locale and sorted options; no ambient timezone/currency mutation. */
function cached<T, O>(make: (locale: string, options: O) => T) {
  const cache = new Map<string, T>()
  return (locale: string, options: O): T => {
    locale = resolveLocale(locale).format
    const key = JSON.stringify([
      locale,
      Object.entries(options ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ])
    let value = cache.get(key)
    if (!value) {
      value = make(locale, options)
      cache.set(key, value)
    }
    return value
  }
}
export const numberFormatter = cached(
  (locale: string, options: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options)
)
export const dateFormatter = cached(
  (locale: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options)
)
export const relativeFormatter = cached(
  (locale: string, options: Intl.RelativeTimeFormatOptions) =>
    new Intl.RelativeTimeFormat(locale, options)
)

export function formatDate(
  value: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions
): string {
  return Number.isFinite(value.getTime()) ? dateFormatter(locale, options).format(value) : '—'
}

export function formatNumber(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions
): string {
  const formatter = numberFormatter(locale, options)
  const digits = formatter
    .formatToParts(value)
    .filter((part) => part.type === 'integer' || part.type === 'fraction')
  const roundedZero =
    value < 0 && digits.length > 0 && digits.every((part) => /^0+$/.test(part.value))
  return formatter.format(Object.is(value, -0) || roundedZero ? 0 : value)
}
