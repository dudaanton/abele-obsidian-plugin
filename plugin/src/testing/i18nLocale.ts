import { initializeLocale } from '@/i18n'
import { catalogs } from '@/i18n/catalogs'
import { createTranslator, type Catalog } from '@/i18n/core'
import { pseudoMessage } from '@/i18n/pseudo'
import { setTestTranslator } from '@/i18n'
import { nextTick } from 'vue'

/** Reopen the surface after changing locale; never touches host language or saved settings. */
export async function setTestLocale(locale = 'en'): Promise<void> {
  if (locale !== 'en-XA') {
    initializeLocale(locale)
    await nextTick()
    return
  }
  const pseudo: Catalog = Object.fromEntries(
    Object.entries(catalogs.en).map(([key, value]) => [
      key,
      typeof value === 'string'
        ? pseudoMessage(value)
        : Object.fromEntries(
            Object.entries(value).map(([form, text]) => [form, pseudoMessage(text)])
          ),
    ])
  ) as Catalog
  initializeLocale('en')
  setTestTranslator(createTranslator('en-XA', { en: catalogs.en, 'en-XA': pseudo }))
  await nextTick()
}
