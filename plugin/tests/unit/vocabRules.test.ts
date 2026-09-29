/**
 * Vocabulary rules gathered from the two places they live (`src/reader/vocab/rules.ts`): a note's
 * properties — which books, or every book of a language, and switched off without losing the forms
 * — and a book's highlights that name forms. And a rule written into a note's properties the way
 * the script API does it, twice without a duplicate.
 */
import { describe, it, expect } from 'vitest'
import {
  formTable,
  highlightRules,
  languagesOf,
  linkText,
  markInto,
  noteRuleOf,
  ruleApplies,
  ruleOfNote,
  sameLanguage,
  switchInto,
} from '@/reader/vocab/rules'
import type { Highlight } from '@/reader/highlights'

const BOOK = { path: 'Books/Sample Novel.epub', languages: ['lv'] }
const resolve = (link: string) =>
  link === 'Sample Novel.epub' || link === 'Sample Novel' ? BOOK.path : null

describe('a rule in a note’s properties', () => {
  it('is read from them, and a note with no forms holds none', () => {
    expect(
      noteRuleOf({
        'word-forms': ['māja', 'mājas'],
        'word-language': 'lv',
        'word-books': ['[[Books/Sample Novel.epub]]'],
      })
    ).toEqual({
      forms: ['māja', 'mājas'],
      language: 'lv',
      books: ['Books/Sample Novel.epub'],
      scope: 'book',
      on: true,
    })
    expect(noteRuleOf({ tags: ['word'] })).toBeNull()
    expect(noteRuleOf({ 'word-forms': [] })).toBeNull()
    expect(noteRuleOf(null)).toBeNull()
  })

  it('applies to the books it links to, however the link is written', () => {
    for (const link of [
      '[[Books/Sample Novel.epub]]',
      '[[Sample Novel.epub|the novel]]',
      'Books/Sample Novel.epub',
      '[novel](Books/Sample%20Novel.epub)',
    ]) {
      const rule = noteRuleOf({ 'word-forms': 'māja', 'word-books': [link] })!
      expect(ruleApplies(rule, BOOK, resolve), link).toBe(true)
    }
    const other = noteRuleOf({ 'word-forms': 'māja', 'word-books': '[[Other.epub]]' })!
    expect(ruleApplies(other, BOOK, resolve)).toBe(false)
  })

  it('applies to no book when it names none, unless it is for the whole language', () => {
    const none = noteRuleOf({ 'word-forms': 'māja', 'word-language': 'lv' })!
    expect(ruleApplies(none, BOOK, resolve)).toBe(false)
    const all = noteRuleOf({
      'word-forms': 'māja',
      'word-language': 'LV',
      'word-scope': 'language',
    })!
    expect(ruleApplies(all, BOOK, resolve)).toBe(true)
    expect(ruleApplies(all, { ...BOOK, languages: ['lv-LV'] }, resolve)).toBe(true)
    expect(ruleApplies(all, { ...BOOK, languages: ['en'] }, resolve)).toBe(false)
    expect(ruleApplies(all, { ...BOOK, languages: [] }, resolve)).toBe(false)
  })

  it('is switched off by word-underline: false, the forms kept', () => {
    for (const off of [false, 'false', 'no', 'off']) {
      const rule = noteRuleOf({
        'word-forms': 'māja',
        'word-books': 'Books/Sample Novel.epub',
        'word-underline': off,
      })!
      expect(rule.forms).toEqual(['māja'])
      expect(ruleApplies(rule, BOOK, resolve)).toBe(false)
    }
  })

  it('is named by the note, and leads to it', () => {
    const rule = ruleOfNote('Words/māja.md', noteRuleOf({ 'word-forms': ['Māja', 'mājas'] })!)
    expect(rule).toEqual({
      id: 'note:Words/māja.md',
      forms: ['Māja', 'mājas'],
      keys: ['māja', 'mājas'],
      label: 'māja',
      target: { kind: 'note', path: 'Words/māja.md' },
    })
  })
})

describe('rules in highlights', () => {
  const hl = (cfi: string, forms?: string[]): Highlight => ({
    cfi,
    color: 'yellow',
    text: 'māja',
    comment: '',
    label: 'One',
    ...(forms ? { forms } : {}),
  })

  it('are the highlights that name forms, each leading to itself', () => {
    const rules = highlightRules([hl('a', ['māja']), hl('b'), hl('c', [])])
    expect(rules).toEqual([
      {
        id: 'highlight:a',
        forms: ['māja'],
        keys: ['māja'],
        label: 'māja',
        target: { kind: 'highlight', cfi: 'a' },
      },
    ])
  })

  it('share a word with notes in one table, each rule once per word', () => {
    const note = ruleOfNote('Words/māja.md', noteRuleOf({ 'word-forms': ['māja', 'Māja'] })!)
    const [mark] = highlightRules([hl('a', ['māja', 'mājā'])])
    const table = formTable([note, mark])
    expect(table.get('māja')).toEqual([note, mark])
    expect(table.get('mājā')).toEqual([mark])
  })
})

describe('writing a rule into a note’s properties', () => {
  it('adds forms and books once, however often it is asked', () => {
    const fm: Record<string, unknown> = { tags: ['word'] }
    const opts = {
      forms: ['māja', 'mājas'],
      language: 'lv',
      books: ['[[Books/Sample Novel.epub]]'],
    }
    markInto(fm, opts)
    const once = JSON.stringify(fm)
    markInto(fm, opts)
    markInto(fm, { ...opts, forms: ['MĀJA'] })
    expect(JSON.stringify(fm)).toBe(once)
    expect(fm).toEqual({
      tags: ['word'],
      'word-forms': ['māja', 'mājas'],
      'word-language': 'lv',
      'word-books': ['[[Books/Sample Novel.epub]]'],
    })
    markInto(fm, { forms: ['mājā'], books: ['[[Books/Other.epub]]'] })
    expect(fm['word-forms']).toEqual(['māja', 'mājas', 'mājā'])
    expect(fm['word-books']).toEqual(['[[Books/Sample Novel.epub]]', '[[Books/Other.epub]]'])
  })

  it('replaces the forms when asked, and sets the language scope', () => {
    const fm: Record<string, unknown> = { 'word-forms': ['māja', 'mājas'] }
    markInto(fm, { forms: ['nams'], replace: true, scope: 'language', language: 'lv' })
    expect(fm).toEqual({ 'word-forms': ['nams'], 'word-scope': 'language', 'word-language': 'lv' })
  })

  it('switches a rule off and on, leaving its forms', () => {
    const fm: Record<string, unknown> = { 'word-forms': ['māja'] }
    switchInto(fm, false)
    expect(fm).toEqual({ 'word-forms': ['māja'], 'word-underline': false })
    switchInto(fm, true)
    expect(fm).toEqual({ 'word-forms': ['māja'] })
  })
})

describe('links and languages', () => {
  it('read a link in a property as the file it names', () => {
    expect(linkText('[[Books/X.epub#cfi=/6/2|X]]')).toBe('Books/X.epub')
    expect(linkText('Books/X.epub')).toBe('Books/X.epub')
  })

  it('take a book’s languages however its metadata gives them', () => {
    expect(languagesOf('lv')).toEqual(['lv'])
    expect(languagesOf(['lv', '', 3])).toEqual(['lv'])
    expect(languagesOf(undefined)).toEqual([])
    expect(sameLanguage('lv-LV', 'LV')).toBe(true)
    expect(sameLanguage('', '')).toBe(false)
  })
})
