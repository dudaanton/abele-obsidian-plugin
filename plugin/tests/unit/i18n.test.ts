import { describe, expect, it, vi } from 'vitest'
import * as obsidian from 'obsidian'
import { hostLocale } from '../../src/i18n/obsidianLocale'
import { createTranslator, resolveLocale } from '../../src/i18n/core'
import { catalogs, validateCatalogs } from '../../src/i18n/catalogs'
import { pseudoMessage } from '../../src/i18n/pseudo'
import {
  dateFormatter,
  numberFormatter,
  relativeFormatter,
  formatDate,
  formatNumber,
} from '../../src/i18n/format'
import { t } from '../../src/i18n'

describe('UI translation contract', () => {
  it('reads the public host API without browser storage', () => {
    const language = vi.spyOn(obsidian, 'getLanguage').mockReturnValue('es-MX')
    expect(hostLocale()).toEqual({ language: 'es', format: 'es-MX' })
    language.mockRestore()
  })
  it('caches canonical formatters and keeps date, DST and negative-zero presentation safe', () => {
    expect(numberFormatter('de_DE', {})).toBe(numberFormatter('de-DE', {}))
    expect(numberFormatter('invalid!', {}).resolvedOptions().locale).toMatch(/^en/)
    expect(relativeFormatter('ru', {})).toBe(relativeFormatter('ru', {}))
    expect(formatDate(new Date(NaN), 'en', {})).toBe('—')
    const options = {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    } as const
    expect(formatDate(new Date('2026-03-08T06:30:00Z'), 'en', options)).toBe('01:30')
    expect(formatDate(new Date('2026-03-08T07:30:00Z'), 'en', options)).toBe('03:30')
    expect(dateFormatter('en', { year: 'numeric', timeZone: 'UTC' })).toBe(
      dateFormatter('en', { timeZone: 'UTC', year: 'numeric' })
    )
    expect(formatNumber(-0.001, 'en', { maximumFractionDigits: 2 })).toBe('0')
    expect(formatNumber(1.5, 'de', {})).toBe('1,5')
  })

  it('has a key and parameter contract derived from English', () => {
    // These are checked by the type gate, never executed as runtime calls.
    const typedCalls = () => {
      t('kit.cancel')
      t('kit.showMore', { count: 3 })
      // @ts-expect-error unknown message key
      t('kit.typo')
      // @ts-expect-error missing required parameters
      t('kit.noIcon')
      // @ts-expect-error cardinal counts must be numeric
      t('kit.showMore', { count: '3' })
      // @ts-expect-error unexpected parameter
      t('kit.noIcon', { query: 'sample', extra: 1 })
    }
    expect(typedCalls).toBeTypeOf('function')
  })
  it('normalizes host languages and rejects unsupported or malformed values', () => {
    for (const [raw, expected] of [
      ['es-MX', 'es'],
      ['de-DE', 'de'],
      ['ru_RU', 'ru'],
      ['LV', 'lv'],
      ['fr', 'en'],
      ['de-!', 'en'],
      ['', 'en'],
    ])
      expect(resolveLocale(raw).language).toBe(expected)
  })
  it('requires complete catalogs with matching placeholders and plurals', () => {
    expect(validateCatalogs(catalogs)).toEqual([])
    expect(validateCatalogs({ ...catalogs, ru: { ...catalogs.ru, 'kit.cancel': '' } })).not.toEqual(
      []
    )
    expect(
      validateCatalogs({
        ...catalogs,
        ru: { ...catalogs.ru, 'kit.showMore': { other: 'Ещё {wrong}' } },
      })
    ).not.toEqual([])
    const incomplete = validateCatalogs({
      ...catalogs,
      ru: { ...catalogs.ru, 'kit.showMore': { other: 'Показать ещё {count}' } },
    })
    expect(incomplete).toContain('ru/kit.showMore: missing few')
    expect(incomplete).toContain('ru/kit.showMore: missing many')
    expect(validateCatalogs({ ...catalogs, de: { ...catalogs.de, extra: 'Extra' } })).toContain(
      'de/extra: missing or extra'
    )
  })
  it('falls back to whole English messages using English plural rules', () => {
    const t = createTranslator('ru', {
      en: { files: { one: '{count} file', other: '{count} files' } },
      ru: {},
    })
    expect(t('files', { count: 21 })).toBe('21 files')
    expect(t('missing')).toBe('⟦missing⟧')
    expect(t('toString')).toBe('⟦toString⟧')
    expect(t('__proto__')).toBe('⟦__proto__⟧')
  })

  it('reports a missing key once without substitution values', () => {
    const missing = vi.fn()
    const translate = createTranslator('ru', { en: { greeting: 'Hello {name}' }, ru: {} }, missing)
    expect(translate('greeting', { name: 'sample-private-text' })).toBe('Hello sample-private-text')
    translate('greeting', { name: 'different-text' })
    expect(missing.mock.calls).toEqual([['ru', 'greeting']])
  })
  it('selects Russian and Latvian cardinal forms including fractions', () => {
    const forms = {
      en: { n: { one: 'one', other: 'other' } },
      ru: { n: { one: 'один', few: 'несколько', many: 'много', other: 'дробь' } },
      lv: { n: { zero: 'nulle', one: 'viens', other: 'citi' } },
    }
    expect(
      [0, 1, 2, 5, 11, 21, 101, 1.5].map((count) => createTranslator('ru', forms)('n', { count }))
    ).toEqual(['много', 'один', 'несколько', 'много', 'много', 'один', 'один', 'дробь'])
    expect(
      [0, 1, 2, 11, 21, 1.1, 1.11].map((count) => createTranslator('lv', forms)('n', { count }))
    ).toEqual(['nulle', 'viens', 'citi', 'nulle', 'viens', 'viens', 'nulle'])
  })
  it('substitutes literally and pseudo-translates only prose', () => {
    expect(
      createTranslator('en', { en: { greeting: 'Hello {name}' } })('greeting', {
        name: '<b>$&</b>',
      })
    ).toBe('Hello <b>$&</b>')
    const pseudo = pseudoMessage('Hello {name}')
    expect(pseudo).toContain('{name}')
    expect(pseudo.startsWith('⟦')).toBe(true)
    expect(pseudo.length).toBeGreaterThan('Hello {name}'.length)
  })
})
