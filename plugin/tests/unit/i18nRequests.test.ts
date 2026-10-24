import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { catalogs } from '@/i18n/catalogs'
import ledger from '@/i18n/requests-ledger.json'

it('has reviewed file request strings in every catalog', () => {
  for (const [key, entry] of Object.entries(ledger)) {
    expect(createHash('sha256').update(catalogs.en[key]).digest('hex')).toBe(entry.englishHash)
    for (const locale of ['ru', 'lv', 'es', 'de'] as const) {
      expect(catalogs[locale][key], `${locale}: ${key}`).toBeTruthy()
      expect([...catalogs[locale][key].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort()).toEqual(
        [...catalogs.en[key].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort()
      )
    }
  }
})
