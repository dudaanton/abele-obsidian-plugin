import { describe, expect, it, vi } from 'vitest'
import { ReaderLibrary, type ReaderFile } from '@/reader/library'
import { BookPlaces } from '@/reader/positions'

const file = (path: string): ReaderFile => ({ path, format: path.split('.').pop()! })
const store = (raw: Record<string, unknown> = {}) =>
  new BookPlaces({
    read: async () => JSON.stringify(raw),
    write: async () => {},
  })

describe('reader library', () => {
  it('lists all reader files without opening binaries; a missing place is not zero progress', async () => {
    const files = [
      file('Sample/first.epub'),
      file('Sample/second.pdf'),
      file('Sample/third.cbz'),
      file('Sample/no.txt'),
    ]
    const inventory = vi.fn(() => files)
    const library = new ReaderLibrary({
      files: inventory,
      places: store({
        'id:first': {
          path: files[0].path,
          cfi: 'cfi',
          fraction: 0,
          at: 10,
          openedAt: 20,
          title: 'Sample title',
          author: 'Sample author',
          measure: { kind: 'locations', count: 100 },
        },
        'path:Sample/third.cbz': {
          path: files[2].path,
          cfi: 'cfi',
          fraction: 1,
          at: 5,
          measure: { kind: 'pages', count: 20 },
        },
      }),
    })
    const books = await library.list()
    expect(inventory).toHaveBeenCalledTimes(1)
    expect(books).toHaveLength(3)
    expect(books[0]).toMatchObject({
      path: files[0].path,
      format: 'epub',
      progress: 0,
      pageCount: 100,
      currentPage: 1,
      pageUnit: 'locations',
      finished: false,
      lastOpenedAt: 20,
      lastPositionAt: 10,
      title: 'Sample title',
      author: 'Sample author',
    })
    expect(books[1]).toMatchObject({
      position: null,
      progress: null,
      pageCount: null,
      title: null,
      author: null,
      lastOpenedAt: null,
    })
    expect(books[2]).toMatchObject({ currentPage: 20, finished: true, pageUnit: 'pages' })
    expect(await library.get('missing.epub')).toBeNull()
  })

  it('does one position snapshot for hundreds of books, not one per card', async () => {
    const positions = store()
    const snapshot = vi.spyOn(positions, 'snapshot')
    const files = Array.from({ length: 610 }, (_, n) => file(`Sample/book-${n}.epub`))
    const library = new ReaderLibrary({ files: () => files, places: positions })
    expect(await library.list()).toHaveLength(610)
    expect(snapshot).toHaveBeenCalledTimes(1)
  })

  it('validates legacy data and detaches snapshots', async () => {
    const places = store({
      'path:a.pdf': {
        path: 'a.pdf',
        cfi: 'p',
        fraction: 8,
        at: -10,
        measure: { kind: 'pages', count: -2 },
        openedAt: NaN,
      },
    })
    const library = new ReaderLibrary({ files: () => [file('a.pdf')], places })
    const book = (await library.get('a.pdf'))!
    expect(book).toMatchObject({
      progress: 1,
      finished: true,
      pageCount: null,
      lastPositionAt: null,
      lastOpenedAt: null,
    })
    book.position!.cfi = 'changed'
    expect((await library.get('a.pdf'))?.position?.cfi).toBe('p')
  })
})
