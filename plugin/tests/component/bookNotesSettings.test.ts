/**
 * Where highlights go, as set in Settings → Books and in a book's Aa dialog
 * (`BookNotesSettings.vue`).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import BookNotesSettings from '@/components/reader/BookNotesSettings.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_READER_SETTINGS } from '@/reader/settings'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().reader = { ...DEFAULT_READER_SETTINGS, bookNotes: {} }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

const names = (form: ReturnType<typeof mount>) =>
  form.findAll('.setting-item-name').map((n) => n.text())
const row = (form: ReturnType<typeof mount>, name: string) =>
  form.findAll('.setting-item').find((r) => r.find('.setting-item-name').text() === name)!

describe('where highlights go, for every book', () => {
  it('is a note of their own until one note for all is chosen, which then can be named', async () => {
    const form = mount(BookNotesSettings)
    expect(names(form)).toEqual(['Where they go', 'Template'])
    await row(form, 'Where they go').find('select').setValue('note')
    expect(AbeleConfig.getInstance().reader.notesTo).toBe('note')
    expect(AbeleConfig.getInstance().saveSettings).toHaveBeenCalled()
    expect(names(form)).toEqual(['Where they go', 'Note for all books', 'Template'])
  })

  it('saves a note and a template a moment after typing stops', async () => {
    vi.useFakeTimers()
    try {
      AbeleConfig.getInstance().reader = { ...DEFAULT_READER_SETTINGS, notesTo: 'note' }
      const form = mount(BookNotesSettings)
      await row(form, 'Note for all books').find('input').setValue('Reading/Notes.md')
      expect(AbeleConfig.getInstance().reader.notesPath).toBe(DEFAULT_READER_SETTINGS.notesPath)
      await vi.advanceTimersByTimeAsync(600)
      expect(AbeleConfig.getInstance().reader.notesPath).toBe('Reading/Notes.md')
      await row(form, 'Template').find('input').setValue('Templates/Book.md')
      // Closed while typing: what was typed is kept.
      form.unmount()
      expect(AbeleConfig.getInstance().reader.notesTemplate).toBe('Templates/Book.md')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("a book's own choice", () => {
  it('follows the settings until it is changed, and forgets itself when set back', async () => {
    AbeleConfig.getInstance().reader = {
      ...DEFAULT_READER_SETTINGS,
      notesTo: 'note',
      notesPath: 'All.md',
      bookNotes: {},
    }
    const form = mount(BookNotesSettings, { props: { bookKey: 'id:dune' } })
    const select = row(form, 'Where they go').find('select')
    expect((select.element as HTMLSelectElement).value).toBe('')
    expect(select.text()).toContain('As in settings (one note for every book)')
    // The note field shows what the settings would use.
    expect((row(form, 'Note').find('input').element as HTMLInputElement).placeholder).toBe('All.md')
    await select.setValue('book')
    expect(AbeleConfig.getInstance().reader.bookNotes).toEqual({ 'id:dune': { notesTo: 'book' } })
    // Other books are left as the settings say.
    expect(AbeleConfig.getInstance().reader.notesTo).toBe('note')
    expect(names(form)).not.toContain('Note')
    await select.setValue('')
    expect(AbeleConfig.getInstance().reader.bookNotes).toEqual({})
  })

  it('names a note for this book alone', async () => {
    vi.useFakeTimers()
    try {
      const form = mount(BookNotesSettings, { props: { bookKey: 'id:dune' } })
      await row(form, 'Where they go').find('select').setValue('note')
      await row(form, 'Note').find('input').setValue('Dune notes.md')
      await vi.advanceTimersByTimeAsync(600)
      expect(AbeleConfig.getInstance().reader.bookNotes).toEqual({
        'id:dune': { notesTo: 'note', notesPath: 'Dune notes.md' },
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
