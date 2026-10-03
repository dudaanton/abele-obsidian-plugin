import { describe, expect, it, vi } from 'vitest'
import { ReaderSettingsCache } from '@/reader/settingsCache'
import { readerSettingsFrom } from '@/reader/settings'

describe('read-only reader settings snapshots', () => {
  it('normalizes once across repeated reads of unchanged mutable settings', () => {
    const normalize = vi.fn(readerSettingsFrom)
    const cache = new ReaderSettingsCache(normalize)
    const stored = { fontSize: 110, bookNotes: { sample: { notesPath: 'sample.md' } } }
    const first = cache.read(stored)
    for (let i = 0; i < 100; i++) expect(cache.read(stored)).toBe(first)
    expect(normalize).toHaveBeenCalledOnce()
  })

  it('observes scalar and nested changes immediately, without a save/version event', () => {
    const cache = new ReaderSettingsCache()
    const stored = {
      fontSize: 110,
      bookNotes: { sample: { notesPath: 'sample.md' } },
      selectionScripts: [{ script: 'sample', name: 'Old', icon: '' }],
    }
    const first = cache.read(stored)
    stored.fontSize = 120
    expect(cache.read(stored).fontSize).toBe(120)
    stored.bookNotes.sample.notesPath = 'new.md'
    stored.selectionScripts[0].name = 'New'
    const updated = cache.read(stored)
    expect(updated.bookNotes.sample.notesPath).toBe('new.md')
    expect(updated.selectionScripts[0].name).toBe('New')
    expect(first.bookNotes.sample.notesPath).toBe('sample.md')
    expect(first.selectionScripts[0].name).toBe('Old')
    expect(updated).toEqual(readerSettingsFrom(stored))
    delete stored.bookNotes.sample
    expect(cache.read(stored).bookNotes).toEqual({})
  })

  it('preserves normalization for incomplete/replaced/malformed sources', () => {
    const cache = new ReaderSettingsCache()
    for (const stored of [
      undefined,
      null,
      {},
      { fontSize: NaN },
      { pdfZoom: 'bad', selectionScripts: [{ script: ' sample ', name: 'Sample' }] },
    ]) {
      expect(cache.read(stored as never)).toEqual(readerSettingsFrom(stored as never))
    }
    const cyclic = { font: 'bad' } as Record<string, unknown>
    cyclic.unused = cyclic
    expect(cache.read(cyclic as never)).toEqual(readerSettingsFrom(cyclic as never))
    expect(cache.read(cyclic as never)).toEqual(readerSettingsFrom(cyclic as never))
  })
})
