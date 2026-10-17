import { englishSyncText, type SyncText } from '../sync/presentation'
import { en } from './locales/en/pilot'
import { currentLocale, relativeFormatter, t } from './index'
import { formatWhen } from '../sync/format'
import type { MessageKey } from './types'

const keys = new Map<string, MessageKey>(
  Object.entries(en)
    .filter(([key]) => key.startsWith('settings.sync.presentation.'))
    .map(([key, value]) => [typeof value === 'string' ? value : value.other, key as MessageKey])
)

/** The sync engine supplies templates and values separately; diagnostics are never parsed. */
export const settingsSyncText: SyncText = (template, values, one) => {
  const key = keys.get(template)
  return key
    ? (t as (key: MessageKey, values?: Record<string, string | number>) => string)(key, values)
    : englishSyncText(template, values, one)
}

export function settingsSyncWhen(iso: string): string {
  const locale = currentLocale()
  if (locale.language === 'en') return formatWhen(iso)
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  if (!Number.isFinite(seconds)) return '—'
  const [unit, scale]: [Intl.RelativeTimeFormatUnit, number] =
    Math.abs(seconds) < 60
      ? ['second', 1]
      : Math.abs(seconds) < 3600
        ? ['minute', 60]
        : Math.abs(seconds) < 86400
          ? ['hour', 3600]
          : Math.abs(seconds) < 2592000
            ? ['day', 86400]
            : Math.abs(seconds) < 31536000
              ? ['month', 2592000]
              : ['year', 31536000]
  return relativeFormatter(locale.format, { numeric: 'auto' }).format(
    Math.round(seconds / scale),
    unit
  )
}
