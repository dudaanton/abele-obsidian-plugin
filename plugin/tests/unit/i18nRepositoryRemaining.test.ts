import { createHash } from 'node:crypto'
import ledger from '@/i18n/repository-ledger.json'
import { catalogs as testCatalogs } from '@/i18n/catalogs'
import { ForgejoError, ForgejoUnknownWrite } from '@/forge/forgejoClient'
import { presentUiError } from '@/i18n/streamBErrors'
import { fullDiff } from '@/github/comparison/text'
import { streamBLabel } from '@/i18n/streamBLabels'
import { afterEach, expect, it } from 'vitest'
import { initializeLocale } from '@/i18n'
import { linesLabel } from '@/github/markdownPreview'
afterEach(() => initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs]))

it('localizes native hosting errors without changing the service or retained diagnostic', () => {
  const refusal = new ForgejoError(403, 'Gitea')
  const unknown = new ForgejoUnknownWrite()
  for (const language of ['ru', 'lv', 'es', 'de'] as const) {
    initializeLocale(language, testCatalogs[language])
    expect(refusal.message).toBe('Gitea refused the request (403).')
    expect(presentUiError(refusal)).toContain('Gitea')
    expect(presentUiError(refusal)).toContain('403')
    expect(presentUiError(refusal)).not.toBe(refusal.message)
    expect(presentUiError(unknown)).not.toBe(unknown.message)
    expect(JSON.stringify(unknown)).not.toContain('streamB.')
  }
})
it('localizes single and multiple selected source lines', () => {
  initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
  expect(linesLabel({ from: 1, to: 1 })).toBe('Line 1')
  expect(linesLabel({ from: 1, to: 3 })).toBe('Lines 1–3')
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  expect(linesLabel({ from: 1, to: 1 })).toBe('Строка 1')
  expect(linesLabel({ from: 1, to: 3 })).toBe('Строки 1–3')
  expect(linesLabel({ from: 1, to: 1 }, false)).toBe('Line 1')
  expect(linesLabel({ from: 1, to: 3 }, false)).toBe('Lines 1–3')
})

it('localizes generated diff notes without translating source or serialized text', () => {
  const diff = fullDiff('before', 'after')
  const notes = diff.lines.filter((line) => line.type === 'note')
  expect(notes).toHaveLength(2)
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  expect(streamBLabel(JSON.parse(JSON.stringify(notes[0])).text)).toContain('исходного файла')
  expect(streamBLabel(JSON.parse(JSON.stringify(notes[1])).text)).toContain('целевого файла')
  expect(notes[0].text).toBe('\\ No newline at end of base file')
  expect(JSON.stringify(diff)).not.toContain('исходного')
  expect(diff.lines.filter((line) => line.type !== 'note').map((line) => line.text)).toEqual([
    'before',
    'after',
  ])
})

it('has reviewed import navigation labels in every language', () => {
  for (const key of ['repository.openImport', 'repository.importMissing'] as const) {
    expect(createHash('sha256').update(testCatalogs.en[key]).digest('hex')).toBe(
      ledger[key].englishHash
    )
    for (const language of ['ru', 'lv', 'es', 'de'] as const) {
      expect(testCatalogs[language][key]).toBeTruthy()
      expect(testCatalogs[language][key]).not.toBe(testCatalogs.en[key])
    }
  }
})
