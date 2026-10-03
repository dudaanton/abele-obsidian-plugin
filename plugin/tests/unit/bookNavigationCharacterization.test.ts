import { describe, expect, it, vi } from 'vitest'
import { BookReading } from '@/reader/BookReading'
import { emptyBookModel } from '@/reader/model'

vi.mock('@/reader/marks', () => ({ BookMarks: class {} }))
vi.mock('@/reader/readAloud', () => ({ ReadAloud: class {} }))

function start(pdf = false) {
  const engine = {
    book: { sections: [{}, {}, {}] },
    renderer: { getContents: () => [], addEventListener: vi.fn() },
    goTo: vi.fn(async () => {}),
    select: vi.fn(async () => {}),
  }
  const model = emptyBookModel()
  const reading = new BookReading(
    {} as never, { path: 'sample.epub' } as never, engine as never,
    model, document.body, pdf ? { pageEvents: new EventTarget() } as never : null,
    () => ({ key: 'sample', title: 'Sample', author: '' })
  )
  return { engine, reading, model }
}

describe('reader navigation contracts', () => {
  it('clamps a page link to the final zero-based section', async () => {
    const { engine, reading } = start()
    await reading.goToPlace({ page: 20 })
    expect(engine.goTo).toHaveBeenCalledWith(2)
    expect(engine.select).not.toHaveBeenCalled()
  })

  it('selects an EPUB link but navigates a PDF link before its text arrives', async () => {
    const cfi = 'epubcfi(/6/2!/4/2)'
    const epub = start()
    await epub.reading.goToPlace({ cfi })
    expect(epub.engine.select).toHaveBeenCalledWith(cfi)
    expect(epub.engine.goTo).not.toHaveBeenCalled()
    const pdf = start(true)
    await pdf.reading.goToPlace({ cfi })
    expect(pdf.engine.goTo).toHaveBeenCalledWith(cfi)
    expect(pdf.engine.select).not.toHaveBeenCalled()
  })

  it('preserves distinct search-hit navigation and the selected hit', async () => {
    const { engine, reading, model } = start(true)
    const hit = { cfi: 'sample-hit', index: 1, occurrence: 2, query: 'sample' }
    model.search.groups = [{ label: 'Sample', hits: [hit] }] as never
    await reading.goToHit(hit)
    expect(engine.goTo).toHaveBeenCalledWith(1)
    expect(model.search.current).toBe(0)
    expect(engine.select).not.toHaveBeenCalled()
  })
})
