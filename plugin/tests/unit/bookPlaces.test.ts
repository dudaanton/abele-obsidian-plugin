/**
 * Where each book was left (`src/reader/positions.ts`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { BookPlaces, MAX_PLACES, bookKey, type PlaceStorage } from '@/reader/positions'

const memory = (initial: string | null = null) => {
  const store = { data: initial, writes: 0 }
  const storage: PlaceStorage = {
    read: async () => store.data,
    write: async (d) => {
      store.data = d
      store.writes++
    },
  }
  return { store, storage }
}

afterEach(() => vi.useRealTimers())

describe('the key of a book', () => {
  it('is its identifier when it has one, whatever its path', () => {
    expect(bookKey('urn:isbn:123', 'A/b.epub')).toBe('id:urn:isbn:123')
    expect(bookKey('urn:isbn:123', 'C/renamed.epub')).toBe('id:urn:isbn:123')
  })

  it('is its path when it has none', () => {
    expect(bookKey('', 'A/b.epub')).toBe('path:A/b.epub')
    expect(bookKey(undefined, 'A/b.epub')).toBe('path:A/b.epub')
    expect(bookKey({ en: 'x' }, 'A/b.epub')).toBe('path:A/b.epub')
  })
})

describe('the places of books', () => {
  it('keeps a place and writes it once, a moment after the last change', async () => {
    vi.useFakeTimers()
    const { store, storage } = memory()
    const places = new BookPlaces(storage, 1000)
    await places.set('id:a', { cfi: 'epubcfi(/6/2!/4)', fraction: 0.1, path: 'a.epub' })
    await places.set('id:a', { cfi: 'epubcfi(/6/4!/4)', fraction: 0.2, path: 'a.epub' })
    expect(store.writes).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.writes).toBe(1)
    const saved = JSON.parse(store.data!)
    expect(saved['id:a'].cfi).toBe('epubcfi(/6/4!/4)')
    expect((await places.get('id:a'))!.fraction).toBe(0.2)
  })

  it('reads what an earlier session wrote, and ignores what it cannot use', async () => {
    const { storage } = memory(
      JSON.stringify({
        'id:a': { cfi: 'epubcfi(/6/2!)', fraction: 0.5, path: 'a.epub', at: 1 },
        bad: 3,
      })
    )
    const places = new BookPlaces(storage)
    expect((await places.get('id:a'))!.cfi).toBe('epubcfi(/6/2!)')
    expect(await places.get('bad')).toBeNull()
  })

  it('survives a file it cannot read', async () => {
    const places = new BookPlaces({ read: async () => '{not json', write: async () => {} })
    expect(await places.get('id:a')).toBeNull()
  })

  it('follows a book kept by its path when the file is renamed', async () => {
    const { store, storage } = memory()
    const places = new BookPlaces(storage)
    await places.set('path:old/b.epub', {
      cfi: 'epubcfi(/6/8!)',
      fraction: 0.3,
      path: 'old/b.epub',
    })
    await places.set('id:x', { cfi: 'epubcfi(/6/2!)', fraction: 0.1, path: 'old/x.epub' })
    await places.renamed('old/b.epub', 'new/b.epub')
    await places.renamed('old/x.epub', 'new/x.epub')
    await places.flush()
    expect(await places.get('path:old/b.epub')).toBeNull()
    expect((await places.get('path:new/b.epub'))!.cfi).toBe('epubcfi(/6/8!)')
    expect((await places.get('id:x'))!.path).toBe('new/x.epub')
    expect(Object.keys(JSON.parse(store.data!))).toEqual(
      expect.arrayContaining(['path:new/b.epub', 'id:x'])
    )
  })

  it(`remembers the ${MAX_PLACES} books read last`, async () => {
    const { store, storage } = memory()
    const places = new BookPlaces(storage)
    for (let i = 0; i < MAX_PLACES + 5; i++)
      await places.set(`id:${i}`, { cfi: 'c', fraction: 0, path: `${i}.epub` })
    // The first five were read longest ago.
    const now = Date.now()
    for (let i = 0; i < 5; i++) (await places.get(`id:${i}`))!.at = now - 100_000
    await places.flush()
    const kept = Object.keys(JSON.parse(store.data!))
    expect(kept).toHaveLength(MAX_PLACES)
    expect(kept).not.toContain('id:0')
  })
})
