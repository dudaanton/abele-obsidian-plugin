export const languages = ['en', 'ru', 'lv', 'es', 'de'] as const
export type Language = (typeof languages)[number]
export type Message = string | (Partial<Record<Intl.LDMLPluralRule, string>> & { other: string })
export type Catalog = Record<string, Message>

export function resolveLocale(raw?: string): { language: Language; format: string } {
  try {
    const format = Intl.getCanonicalLocales((raw || 'en').replace(/_/g, '-'))[0]
    const base = format.split('-')[0]
    if (languages.includes(base as Language)) return { language: base as Language, format }
  } catch {
    /* Unsupported host/custom locales use the English baseline. */
  }
  return { language: 'en', format: 'en' }
}

const rules = new Map<string, Intl.PluralRules>()
export function pluralRules(locale: string): Intl.PluralRules {
  let rule = rules.get(locale)
  if (!rule) rules.set(locale, (rule = new Intl.PluralRules(resolveLocale(locale).format)))
  return rule
}

/** Pure and instance-local. Warnings never include substitution values. */
export function createTranslator(
  language: string,
  catalogs: Record<string, Catalog>,
  missing?: (locale: string, key: string) => void
) {
  const warned = new Set<string>()
  const lookup = (locale: string, key: string): Message | undefined => {
    const catalog = Object.hasOwn(catalogs, locale) ? catalogs[locale] : undefined
    return catalog && Object.hasOwn(catalog, key) ? catalog[key] : undefined
  }
  return (key: string, params: Record<string, string | number> = {}): string => {
    let locale = language
    let message = lookup(locale, key)
    if (!message) {
      if (!warned.has(key)) {
        warned.add(key)
        missing?.(locale, key)
      }
      locale = 'en'
      message = lookup('en', key)
    }
    if (!message) return `⟦${key}⟧`
    const text =
      typeof message === 'string'
        ? message
        : (message[pluralRules(locale).select(Number(params.count))] ?? message.other)
    return text.replace(/\{(\w+)\}/g, (token, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : token
    )
  }
}
