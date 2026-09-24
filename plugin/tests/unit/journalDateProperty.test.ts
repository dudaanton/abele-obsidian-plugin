/**
 * A journal can name a property its notes carry their date in. The check read that setting's
 * name off the note (`frontmatter.dateProperty`) instead of off the journal, found nothing there,
 * and always took the date from the file name — the setting was never used.
 *
 * The date now comes from the property the journal names, and from the file name when the note
 * does not carry it.
 */
import { describe, it, expect } from 'vitest'
import { Journal } from '@/entities/Journal'
import { useVault, dailyJournal } from '../helpers/testEnv'

const day = (journal: Journal, path: string) =>
  journal.checkIfNotePathIsJournal(path)?.format('YYYY-MM-DD') ?? null

describe('the day of a journal note', () => {
  it('comes from the property the journal names', () => {
    useVault([
      { path: 'Journals/Trip day one.md', frontmatter: { type: 'journal', day: '2026-08-22' } },
    ])
    const journal = new Journal(dailyJournal({ dateProperty: 'day' }))
    expect(day(journal, 'Journals/Trip day one.md')).toBe('2026-08-22')
  })

  it('comes from the property over a different date in the file name', () => {
    useVault([
      { path: 'Journals/2026-08-20.md', frontmatter: { type: 'journal', day: '2026-08-22' } },
    ])
    const journal = new Journal(dailyJournal({ dateProperty: 'day' }))
    expect(day(journal, 'Journals/2026-08-20.md')).toBe('2026-08-22')
  })

  it('comes from the file name when the note does not carry the property', () => {
    useVault([{ path: 'Journals/2026-08-20.md', frontmatter: { type: 'journal' } }])
    const journal = new Journal(dailyJournal({ dateProperty: 'day' }))
    expect(day(journal, 'Journals/2026-08-20.md')).toBe('2026-08-20')
  })

  it('comes from the file name when the journal names no property', () => {
    useVault([
      { path: 'Journals/2026-08-20.md', frontmatter: { type: 'journal', day: '2026-08-22' } },
    ])
    const journal = new Journal(dailyJournal())
    expect(day(journal, 'Journals/2026-08-20.md')).toBe('2026-08-20')
  })

  it('is none when neither the property nor the file name says it', () => {
    useVault([{ path: 'Journals/Trip day one.md', frontmatter: { type: 'journal' } }])
    const journal = new Journal(dailyJournal({ dateProperty: 'day' }))
    expect(day(journal, 'Journals/Trip day one.md')).toBeNull()
  })
})
