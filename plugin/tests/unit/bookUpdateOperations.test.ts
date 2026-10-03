import { describe, expect, it, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { BookReading } from '@/reader/BookReading'
import { emptyBookModel } from '@/reader/model'
import { vocabFor } from '@/reader/vocab/bookVocab'
import { readerSettingsFrom } from '@/reader/settings'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

vi.mock('@/reader/marks', () => ({ BookMarks: class {} }))
vi.mock('@/reader/readAloud', () => ({ ReadAloud: class {} }))

function fixture() {
  const app = useVault([
    { path: 'Books/sample.epub', content: '' },
    { path: 'Notes/sample.md', content: 'Sample note' },
    { path: 'Notes/renamed-highlights.md', frontmatter: { type: 'book-highlights', file: '[[Books/sample.epub]]' } },
    { path: 'Words/sample.md', frontmatter: { 'word-forms': ['sample'], 'word-scope': 'language', 'word-language': 'en' } },
  ])
  const book = app.vault.getAbstractFileByPath('Books/sample.epub') as TFile
  AbeleConfig.getInstance().reader = readerSettingsFrom()
  return { app, book }
}

describe('open book work counts', () => {
  it('does no whole-vault lookup for unrelated metadata changes', () => {
    const { app, book } = fixture()
    const scan = vi.spyOn(app.vault, 'getMarkdownFiles')
    const reading = new BookReading(app as never, book, {} as never, emptyBookModel(), document.body, null,
      () => ({ key: 'sample', title: 'Sample', author: '' }))
    const reload = vi.spyOn(reading, 'loadHighlights').mockResolvedValue(undefined)
    for (let i = 0; i < 100; i++) expect(reading.noteChanged('Notes/sample.md')).toBe(false)
    expect(scan).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    // A renamed companion still matters, even before this tab has read its highlights.
    expect(reading.noteChanged('Notes/renamed-highlights.md')).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
    expect(scan).not.toHaveBeenCalled()
  })

  it('shares the vocabulary scan and subscriptions between simultaneous tabs', () => {
    const { app, book } = fixture()
    const scan = vi.spyOn(app.vault, 'getMarkdownFiles')
    const firstMarks = { setRules: vi.fn(), stop: vi.fn() }
    const secondMarks = { setRules: vi.fn(), stop: vi.fn() }
    const firstReading = { marks: { vocab: firstMarks }, highlights: () => [] } as unknown as BookReading
    const secondReading = { marks: { vocab: secondMarks }, highlights: () => [] } as unknown as BookReading
    const first = vocabFor(app as never, book, firstReading, ['en'])
    const second = vocabFor(app as never, book, secondReading, ['en'])
    try {
      expect(scan).toHaveBeenCalledOnce()
      expect(firstMarks.setRules.mock.calls[0][0]).toHaveLength(1)
      expect(secondMarks.setRules.mock.calls[0][0]).toHaveLength(1)
      first.stop()
      firstMarks.setRules.mockClear()
      secondMarks.setRules.mockClear()
      app.emit('metadataCache', 'changed', app.vault.getAbstractFileByPath('Words/sample.md'))
      // Unchanged vocabulary does not wake the remaining tab.
      expect(secondMarks.setRules).not.toHaveBeenCalled()
      expect(firstMarks.setRules).not.toHaveBeenCalled()
      app.setFrontmatter('Words/sample.md', { 'word-forms': ['changed'], 'word-scope': 'language', 'word-language': 'en' })
      app.emit('metadataCache', 'changed', app.vault.getAbstractFileByPath('Words/sample.md'))
      expect(secondMarks.setRules).toHaveBeenCalledOnce()
      expect(secondMarks.setRules.mock.calls[0][0][0].forms).toEqual(['changed'])
      expect(firstMarks.setRules).not.toHaveBeenCalled()
    } finally {
      first.stop()
      second.stop()
    }
  })
})
