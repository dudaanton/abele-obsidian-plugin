import { english } from './catalogs'
import { createTranslator } from './core'
import type { MessageKey, TranslationArgs } from './types'

const translate = createTranslator('en', { en: english })

/** Shared request code also serves agents; its descriptions stay independent of UI language. */
export function agentText<K extends MessageKey>(key: K, ...args: TranslationArgs<K>): string {
  return translate(key, args[0])
}
