import { describe, expect, it, vi } from 'vitest'
import { emptyBookModel } from '@/reader/model'
import { BookReading } from '@/reader/BookReading'
import type { Highlight } from '@/reader/highlights'

vi.mock('@/reader/vocab/vocabMarks', () => ({ VocabMarks: class {} }))
vi.mock('@/reader/readAloud', () => ({ ReadAloud: class {} }))
vi.mock('@/reader/settings', () => ({ readerSettingsFrom: () => ({}), notesTargetFor: () => ({ to: 'book', alsoIn: [] }) }))
vi.mock('@/services/AbeleConfig', () => ({ AbeleConfig: { getInstance: () => ({ reader: {} }) } }))
const highlight: Highlight = { cfi: 'epubcfi(/4/2)', text: 'Invented words', label: 'Sample', color: 'yellow', comment: '' }
const candidate = { cfi: highlight.cfi, suggested: 'epubcfi(/4/4)', text: highlight.text, label: highlight.label, anchored: true, context: { pre: '', match: highlight.text, post: '' } }
const load = vi.fn(async () => [highlight])
const prepare = vi.fn(async () => [{ ...candidate, note: { path: 'sample.md' } }])
const repair = vi.fn(async () => ({ applied: [highlight.cfi], skipped: [], failed: [] }))
let confirm: (result: boolean) => void = () => {}
const ask = vi.fn(() => ({ answer: new Promise<boolean>((resolve) => { confirm = resolve }), cancel: () => confirm(false) }))
vi.mock('@/reader/companion', () => ({ notesOf: () => [], readHighlights: (...args: unknown[]) => load(...args), prepareHighlightRepairs: (...args: unknown[]) => prepare(...args), repairHighlightLinks: (...args: unknown[]) => repair(...args) }))
vi.mock('@/reader/highlightRepairDialog', () => ({ askToRepairLinks: (...args: unknown[]) => ask(...args) }))
// Wait for the controller's lazy module imports, rather than assuming a runner-specific
// number of microtasks. Confirmation promises stay pending until the test answers them.
const flush = async () => { await vi.dynamicImportSettled() }

const start = () => {
  const model = emptyBookModel()
  const engine = Object.assign(new EventTarget(), { isFixedLayout: false, renderer: { getContents: () => [] }, resolveNavigation: () => null, addAnnotation: async () => {}, deleteAnnotation: async () => {} })
  const reading = new BookReading({} as never, { path: 'sample.epub' } as never, engine as never, model, document.body, null, () => ({ key: 'sample', title: 'Sample', author: '' }))
  vi.spyOn(reading.marks, 'repairs').mockReturnValue([candidate])
  return { reading, model }
}

describe('repair confirmation lifecycle', () => {
  it('does not write on discovery, opening, cancellation or repeated clicks', async () => {
    vi.clearAllMocks()
    const { reading } = start()
    const first = reading.repairHighlightLinks()
    const second = reading.repairHighlightLinks()
    await flush()
    expect(repair).not.toHaveBeenCalled()
    expect(ask).toHaveBeenCalledTimes(1)
    confirm(false)
    await Promise.all([first, second])
    expect(repair).not.toHaveBeenCalled()
    reading.dispose()
  })

  it('keeps the active highlight under the repaired key when a vault event reloads before the writer resolves', async () => {
    vi.clearAllMocks()
    const { reading, model } = start()
    model.active = highlight
    repair.mockImplementationOnce(async () => {
      model.active = null // A vault metadata event reloaded the old key before process returned.
      return { applied: [highlight.cfi], skipped: [], failed: [] }
    })
    load.mockResolvedValueOnce([{ ...highlight, cfi: candidate.suggested }])
    const action = reading.repairHighlightLinks(highlight)
    await flush()
    confirm(true)
    await action
    expect(model.active?.cfi).toBe(candidate.suggested)
    reading.dispose()
  })

  it('remaps the active key when another highlights load supersedes the repair load', async () => {
    vi.clearAllMocks()
    const { reading, model } = start()
    model.active = highlight
    const deferred = () => {
      let resolve: (items: Highlight[]) => void = () => {}
      const promise = new Promise<Highlight[]>((done) => { resolve = done })
      return { promise, resolve }
    }
    const first = deferred()
    const newer = deferred()
    load.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => newer.promise)
    const action = reading.repairHighlightLinks(highlight)
    await flush()
    confirm(true)
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
    const eventLoad = reading.loadHighlights()
    first.resolve([highlight])
    await action
    newer.resolve([{ ...highlight, cfi: candidate.suggested }])
    await eventLoad
    expect(model.active?.cfi).toBe(candidate.suggested)
    reading.dispose()
  })
})
