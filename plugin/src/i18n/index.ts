import { english } from './catalogs'
import type { Catalog } from './core'
import { createTranslator, resolveLocale } from './core'
import type { MessageKey, TranslationArgs } from './types'
export {
  numberFormatter,
  dateFormatter,
  relativeFormatter,
  formatDate,
  formatNumber,
} from './format'

let locale = resolveLocale('en')
let translate = createTranslator(locale.language, { en: english })
export function initializeLocale(raw: string, catalog?: Catalog): void {
  locale = resolveLocale(raw)
  const catalogs: Record<string, Catalog> = { en: english }
  if (catalog) catalogs[locale.language] = catalog
  translate = createTranslator(locale.language, catalogs, (language, key) => {
    if (process.env.NODE_ENV !== 'production') console.warn(`[i18n] Missing ${language}/${key}`)
  })
}
export const currentLocale = () => locale
/** Internal adapter used only by the development testing graph. */
export function setTestTranslator(translator: typeof translate): void {
  translate = translator
}
export function t<K extends MessageKey>(key: K, ...args: TranslationArgs<K>): string {
  return translate(key, args[0])
}
