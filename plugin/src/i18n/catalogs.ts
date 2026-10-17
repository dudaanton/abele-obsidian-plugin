import { en } from './locales/en/pilot'
import { ru } from './locales/ru/pilot'
import { lv } from './locales/lv/pilot'
import { es } from './locales/es/pilot'
import { de } from './locales/de/pilot'
import { pluralRules, type Catalog, type Message } from './core'
import { tasks as enTasks } from './locales/en/tasks'
import { tasks as ruTasks } from './locales/ru/tasks'
import { tasks as lvTasks } from './locales/lv/tasks'
import { tasks as esTasks } from './locales/es/tasks'
import { tasks as deTasks } from './locales/de/tasks'

export const english = { ...en, ...enTasks }

export type TranslationCatalog = {
  [K in keyof typeof en]: (typeof en)[K] extends string ? string : Exclude<Message, string>
}
// Keep the full registry available to tooling without retaining it in English-only consumers.
export const catalogs = /* @__PURE__ */ (() => ({
  en: english,
  ru: { ...ru, ...ruTasks },
  lv: { ...lv, ...lvTasks },
  es: { ...es, ...esTasks },
  de: { ...de, ...deTasks },
}))()

const placeholders = (text: string) =>
  [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',')
export function validateCatalogs(all: Record<string, Catalog>): string[] {
  const errors: string[] = []
  for (const [locale, catalog] of Object.entries(all)) {
    for (const key of new Set([...Object.keys(all.en), ...Object.keys(catalog)])) {
      const source = all.en[key]
      const target = catalog[key]
      if (!source || !target) {
        errors.push(`${locale}/${key}: missing or extra`)
        continue
      }
      if (typeof source !== typeof target) {
        errors.push(`${locale}/${key}: shape`)
        continue
      }
      const expected = placeholders(typeof source === 'string' ? source : source.other)
      const texts = typeof target === 'string' ? [target] : Object.values(target)
      if (texts.some((text) => !text?.trim() || placeholders(text) !== expected))
        errors.push(`${locale}/${key}: placeholders or empty`)
      if (typeof target !== 'string') {
        for (const category of pluralRules(locale).resolvedOptions().pluralCategories) {
          if (!target[category]) errors.push(`${locale}/${key}: missing ${category}`)
        }
        if (!target.other) errors.push(`${locale}/${key}: missing other`)
      }
    }
  }
  return errors
}
