import { initializeLocale as initialize } from '@/i18n'
import { catalogs } from '@/i18n/catalogs'
import { resolveLocale } from '@/i18n/core'

/** Existing translation assertions provide catalogs explicitly, without production downloads. */
export function initializeLocale(raw: string): void {
  initialize(raw, catalogs[resolveLocale(raw).language])
}
