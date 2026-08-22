/**
 * Behavioural contract for recognising a note as a journal entry and dating it.
 *
 * Everything downstream — which tasks, logs and transactions a journal note gathers — keys
 * off the date this returns, so the matching rules are pinned here before anything that
 * consumes them is touched.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Journal } from '@/entities/Journal'
import { useVault, dailyJournal, configureAbele } from '../helpers/testEnv'
import type { FakeFileSpec } from '../helpers/fakeVault'

const VAULT: FakeFileSpec[] = [
  { path: 'Journals/2026/2026-08-22.md', frontmatter: { type: 'journal' }, content: 'Entry\n' },
  { path: 'Journals/2026/2026-08-23.md', frontmatter: { type: 'journal' }, content: 'Entry\n' },
  { path: 'Journals/2026/no-date-here.md', frontmatter: { type: 'journal' }, content: 'Entry\n' },
  { path: 'Notes/Regular.md', frontmatter: { type: 'note' }, content: 'Regular\n' },
  { path: 'Notes/Untyped.md', content: 'Untyped\n' },
  { path: 'Logs/2026-08-22 standup.md', frontmatter: { type: 'log' }, content: 'Standup\n' },
]

describe('Journal — matching a note by type', () => {
  beforeEach(() => {
    useVault(VAULT)
    configureAbele()
  })

  it('matches a note whose frontmatter type equals the journal type', () => {
    const journal = new Journal(dailyJournal())
    expect(
      journal.checkIfNotePathIsJournal('Journals/2026/2026-08-22.md')?.format('YYYY-MM-DD')
    ).toBe('2026-08-22')
  })

  it('does not match a note of a different type', () => {
    const journal = new Journal(dailyJournal())
    expect(journal.checkIfNotePathIsJournal('Notes/Regular.md')).toBeUndefined()
  })

  it('does not match a note with no type at all', () => {
    const journal = new Journal(dailyJournal())
    expect(journal.checkIfNotePathIsJournal('Notes/Untyped.md')).toBeUndefined()
  })

  it('does not match a path that is not a file', () => {
    const journal = new Journal(dailyJournal())
    expect(journal.checkIfNotePathIsJournal('Journals/2026')).toBeUndefined()
  })
})

describe('Journal — matching a note by path pattern', () => {
  beforeEach(() => {
    useVault(VAULT)
    configureAbele()
  })

  it('treats a slash-delimited type as a regular expression over the path', () => {
    const journal = new Journal(dailyJournal({ type: '/^Logs\\//' }))
    expect(
      journal.checkIfNotePathIsJournal('Logs/2026-08-22 standup.md')?.format('YYYY-MM-DD')
    ).toBe('2026-08-22')
  })

  it('does not match a path outside the pattern', () => {
    const journal = new Journal(dailyJournal({ type: '/^Logs\\//' }))
    expect(journal.checkIfNotePathIsJournal('Journals/2026/2026-08-22.md')).toBeUndefined()
  })
})

describe('Journal — deriving the date', () => {
  beforeEach(() => {
    useVault(VAULT)
    configureAbele()
  })

  it('reads the date from the file name', () => {
    const journal = new Journal(dailyJournal())
    expect(
      journal.checkIfNotePathIsJournal('Journals/2026/2026-08-23.md')?.format('YYYY-MM-DD')
    ).toBe('2026-08-23')
  })

  it('rejects a matching note whose file name carries no date', () => {
    const journal = new Journal(dailyJournal())
    expect(journal.checkIfNotePathIsJournal('Journals/2026/no-date-here.md')).toBeUndefined()
  })

  it('still reads the file name when a dateProperty is configured', () => {
    // The implementation checks frontmatter for a literal `dateProperty` key rather than the
    // configured property name, so the filename branch is what actually runs. Pinned as-is:
    // downstream date matching depends on this behaviour.
    useVault([
      {
        path: 'Journals/2026/2026-08-22.md',
        frontmatter: { type: 'journal', date: '2020-01-01' },
        content: 'Entry\n',
      },
    ])
    const journal = new Journal(dailyJournal({ dateProperty: 'date' }))
    expect(
      journal.checkIfNotePathIsJournal('Journals/2026/2026-08-22.md')?.format('YYYY-MM-DD')
    ).toBe('2026-08-22')
  })
})

describe('Journal — configuration round trip', () => {
  it('preserves its definition through toDTO', () => {
    const dto = dailyJournal({ id: 'abc', name: 'Daily notes', recurrence: 'weekly' })
    expect(new Journal(dto).toDTO()).toMatchObject({
      id: 'abc',
      name: 'Daily notes',
      type: 'journal',
      isDefault: true,
      recurrence: 'weekly',
    })
  })

  it('accepts first and last as a day of period', () => {
    expect(new Journal(dailyJournal({ dayOfPeriod: 'first' })).dayOfPeriod).toBe('first')
    expect(new Journal(dailyJournal({ dayOfPeriod: 'last' })).dayOfPeriod).toBe('last')
  })

  it('accepts a numeric day of period within range', () => {
    expect(new Journal(dailyJournal({ dayOfPeriod: 15 })).dayOfPeriod).toBe(15)
  })

  it('rejects a numeric day of period outside range', () => {
    expect(new Journal(dailyJournal({ dayOfPeriod: 0 })).dayOfPeriod).toBeUndefined()
    expect(new Journal(dailyJournal({ dayOfPeriod: 400 })).dayOfPeriod).toBeUndefined()
  })
})
