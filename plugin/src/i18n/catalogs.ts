import { streamBMeta as deStreamBMeta } from './locales/de/streamBMeta'
import { streamBMeta as esStreamBMeta } from './locales/es/streamBMeta'
import { streamBMeta as lvStreamBMeta } from './locales/lv/streamBMeta'
import { streamBMeta as ruStreamBMeta } from './locales/ru/streamBMeta'
import { streamBMeta as enStreamBMeta } from './locales/en/streamBMeta'
import { streamBCounts as deStreamBCounts } from './locales/de/streamBCounts'
import { streamBCounts as esStreamBCounts } from './locales/es/streamBCounts'
import { streamBCounts as lvStreamBCounts } from './locales/lv/streamBCounts'
import { streamBCounts as ruStreamBCounts } from './locales/ru/streamBCounts'
import { streamBCounts as enStreamBCounts } from './locales/en/streamBCounts'
import { streamBErrors as deStreamBErrors } from './locales/de/streamBErrors'
import { streamBErrors as esStreamBErrors } from './locales/es/streamBErrors'
import { streamBErrors as lvStreamBErrors } from './locales/lv/streamBErrors'
import { streamBErrors as ruStreamBErrors } from './locales/ru/streamBErrors'
import { streamBErrors as enStreamBErrors } from './locales/en/streamBErrors'
import { streamB as deStreamB } from './locales/de/streamB'
import { streamB as esStreamB } from './locales/es/streamB'
import { streamB as lvStreamB } from './locales/lv/streamB'
import { streamB as ruStreamB } from './locales/ru/streamB'
import { streamB as enStreamB } from './locales/en/streamB'
import { repository as deRepository } from './locales/de/repository'
import { repository as esRepository } from './locales/es/repository'
import { repository as lvRepository } from './locales/lv/repository'
import { repository as ruRepository } from './locales/ru/repository'
import { repository as enRepository } from './locales/en/repository'
import { chat as deChat } from './locales/de/chat'
import { chat as esChat } from './locales/es/chat'
import { chat as lvChat } from './locales/lv/chat'
import { chat as ruChat } from './locales/ru/chat'
import { chat as enChat } from './locales/en/chat'
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
import { streamC as enStreamC } from './locales/en/streamC'
import { streamC as ruStreamC } from './locales/ru/streamC'
import { streamC as lvStreamC } from './locales/lv/streamC'
import { streamC as esStreamC } from './locales/es/streamC'
import { streamC as deStreamC } from './locales/de/streamC'
import { extra as enStreamCExtra } from './locales/en/streamCExtra'
import { extra as ruStreamCExtra } from './locales/ru/streamCExtra'
import { extra as lvStreamCExtra } from './locales/lv/streamCExtra'
import { extra as esStreamCExtra } from './locales/es/streamCExtra'
import { extra as deStreamCExtra } from './locales/de/streamCExtra'

export const english = {
  ...en,
  ...enTasks,
  ...enStreamC,
  ...enStreamCExtra,
  ...enChat,
  ...enRepository,
  ...enStreamB,
  ...enStreamBErrors,
  ...enStreamBCounts,
  ...enStreamBMeta,
}

export type TranslationCatalog = {
  [K in keyof typeof en]: (typeof en)[K] extends string ? string : Exclude<Message, string>
}
// Keep the full registry available to tooling without retaining it in English-only consumers.
export const catalogs = /* @__PURE__ */ (() => ({
  en: english,
  ru: {
    ...ru,
    ...ruTasks,
    ...ruStreamC,
    ...ruStreamCExtra,
    ...ruChat,
    ...ruRepository,
    ...ruStreamB,
    ...ruStreamBErrors,
    ...ruStreamBCounts,
    ...ruStreamBMeta,
  },
  lv: {
    ...lv,
    ...lvTasks,
    ...lvStreamC,
    ...lvStreamCExtra,
    ...lvChat,
    ...lvRepository,
    ...lvStreamB,
    ...lvStreamBErrors,
    ...lvStreamBCounts,
    ...lvStreamBMeta,
  },
  es: {
    ...es,
    ...esTasks,
    ...esStreamC,
    ...esStreamCExtra,
    ...esChat,
    ...esRepository,
    ...esStreamB,
    ...esStreamBErrors,
    ...esStreamBCounts,
    ...esStreamBMeta,
  },
  de: {
    ...de,
    ...deTasks,
    ...deStreamC,
    ...deStreamCExtra,
    ...deChat,
    ...deRepository,
    ...deStreamB,
    ...deStreamBErrors,
    ...deStreamBCounts,
    ...deStreamBMeta,
  },
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
