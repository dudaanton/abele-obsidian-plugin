/**
 * Which notes a note picker offers, and what it makes of an answer.
 *
 * The filter speaks the script `find()` API's words, so a script that knows how to find its
 * wallets can offer them in a form the same way. It is matched on what Obsidian already holds —
 * names, paths, properties — because the list narrows on every keystroke.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { App, TFile } from 'obsidian'
import {
  createPickedNote,
  filterCriteria,
  formatPick,
  notesMatching,
  noteSuggestions,
  pickItems,
  resolveNote,
} from '@/helpers/noteFilter'
import { useVault } from '../helpers/testEnv'

let app: App

beforeEach(() => {
  app = useVault([
    { path: 'Finance/Accounts/Cash.md', frontmatter: { type: 'account', title: 'Wallet' } },
    { path: 'Finance/Accounts/Card.md', frontmatter: { type: 'account' } },
    { path: 'Finance/Transactions/Coffee.md', frontmatter: { type: 'transaction' } },
    { path: 'People/Anna.md', frontmatter: { groups: ['[[Friends]]'] } },
    { path: 'People/Boris.md' },
    { path: 'Card game.md' },
  ]) as unknown as App
})

const paths = (files: TFile[]) => files.map((f) => f.path).sort()
const pickPaths = (picks: ReturnType<typeof noteSuggestions>) =>
  picks.map((p) => ('file' in p ? p.file.path : `+${p.create}`))

describe('the filter', () => {
  it('lets through the notes with the property it names', () => {
    expect(paths(notesMatching(app, { property: 'type', value: 'account' }))).toEqual([
      'Finance/Accounts/Card.md',
      'Finance/Accounts/Cash.md',
    ])
  })

  it('takes a property without a value as "has it at all"', () => {
    expect(paths(notesMatching(app, { property: 'groups' }))).toEqual(['People/Anna.md'])
  })

  it('keeps to a folder and what is under it, not to names that merely begin the same', () => {
    expect(paths(notesMatching(app, { folder: 'People/' }))).toEqual([
      'People/Anna.md',
      'People/Boris.md',
    ])
    expect(paths(notesMatching(app, { folder: 'Fin' }))).toEqual([])
  })

  it('combines the shorthand with criteria, all of them at once', () => {
    const found = notesMatching(app, {
      folder: 'Finance',
      criteria: [{ type: 'property', operator: 'notContains', property: 'type', value: 'trans' }],
    })
    expect(paths(found)).toEqual(['Finance/Accounts/Card.md', 'Finance/Accounts/Cash.md'])
  })

  it('offers every note when it is given no filter', () => {
    expect(notesMatching(app, undefined)).toHaveLength(6)
  })

  it('refuses content, which it cannot match while a person types', () => {
    expect(() => filterCriteria({ content: 'TODO' } as never)).toThrow(/not by content/)
    expect(() =>
      filterCriteria({ criteria: [{ type: 'content', operator: 'contains', value: 'x' } as never] })
    ).toThrow(/not by content/)
  })
})

describe('the list as a person types', () => {
  it('matches the title as well as the path, fuzzily', () => {
    const filter = { property: 'type', value: 'account' }
    // "Wallet" is Cash.md's title: the person types what they see.
    expect(pickPaths(noteSuggestions(app, { filter, query: 'wlt' }))).toEqual([
      'Finance/Accounts/Cash.md',
    ])
    expect(pickPaths(noteSuggestions(app, { filter, query: 'card' }))).toEqual([
      'Finance/Accounts/Card.md',
    ])
  })

  it('never offers a note outside the filter, however well it matches', () => {
    const picks = noteSuggestions(app, { filter: { folder: 'People' }, query: 'card' })
    expect(picks).toEqual([])
  })

  it('leaves out what is already chosen', () => {
    const picks = noteSuggestions(app, {
      filter: { folder: 'People' },
      query: '',
      exclude: new Set(['People/Anna.md']),
    })
    expect(pickPaths(picks)).toEqual(['People/Boris.md'])
  })

  it('offers a new note only when asked to, and only for a name no note has', () => {
    const filter = { folder: 'People' }
    expect(pickPaths(noteSuggestions(app, { filter, query: 'Vera' }))).toEqual([])
    expect(pickPaths(noteSuggestions(app, { filter, query: 'Vera', create: true }))).toEqual([
      '+Vera',
    ])
    expect(pickPaths(noteSuggestions(app, { filter, query: 'boris', create: true }))).toEqual([
      'People/Boris.md',
    ])
  })
})

describe('an answer', () => {
  it('names a note by path, path without extension, wikilink or bare name', () => {
    for (const raw of [
      'People/Anna.md',
      'People/Anna',
      '[[Anna]]',
      '[[People/Anna|Ann]]',
      'Anna',
    ]) {
      expect(resolveNote(app, raw)?.path, raw).toBe('People/Anna.md')
    }
    expect(resolveNote(app, 'Nobody')).toBeNull()
  })

  it('is a list when it is a JSON array, and one note otherwise', () => {
    expect(pickItems('["a.md","b.md"]')).toEqual(['a.md', 'b.md'])
    expect(pickItems('[[Anna]]')).toEqual(['[[Anna]]'])
    expect(pickItems(['x'])).toEqual(['x'])
    expect(pickItems('')).toEqual([])
  })

  it('goes back as a path, or as a link when asked', () => {
    const anna = resolveNote(app, 'Anna') as TFile
    expect(formatPick(app, anna, undefined)).toBe('People/Anna.md')
    expect(formatPick(app, anna, 'link')).toMatch(/^\[\[(People\/)?Anna\]\]$/)
  })
})

describe('a note made from the picker', () => {
  it('lands in the filter, so the picker would offer it', async () => {
    const file = await createPickedNote(app, 'Savings', {
      folder: 'Finance/Accounts',
      property: 'type',
      value: 'account',
    })
    expect(file.path).toBe('Finance/Accounts/Savings.md')
    const text = await app.vault.read(file)
    expect(text).toContain('account')
  })

  it('never overwrites a note of the same name', async () => {
    const file = await createPickedNote(app, 'Anna', { folder: 'People' })
    expect(file.path).toBe('People/Anna 1.md')
  })
})
