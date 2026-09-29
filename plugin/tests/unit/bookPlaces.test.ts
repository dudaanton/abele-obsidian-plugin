/**
 * Where each book was left (`src/reader/positions.ts`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BookPlaces as Store,
  MAX_PLACES,
  bookKey,
  type BookPlace,
  type PlaceStorage,
} from '@/reader/positions'

/** Both copies in memory; `writes` counts the main one's. */
const memory = (initial: string | null = null, backup: string | null = initial) => {
  const store = { data: initial, backup, writes: 0 }
  const storage: PlaceStorage = {
    read: async (copy) => (copy === 'backup' ? store.backup : store.data),
    write: async (d, copy) => {
      if (copy === 'backup') store.backup = d
      else {
        store.data = d
        store.writes++
      }
    },
  }
  return { store, storage }
}

/**
 * Every store a test makes, flushed once it ends the way the plugin flushes on unload: a write
 * still waiting on a timer would otherwise fire after the test file is gone, where there is no
 * window left to fire in.
 */
const made = new Set<Store>()
class BookPlaces extends Store {
  constructor(...args: ConstructorParameters<typeof Store>) {
    super(...args)
    made.add(this)
  }
}

afterEach(async () => {
  for (const store of made) await store.flush().catch((): void => {})
  made.clear()
  vi.useRealTimers()
})

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

describe('reader library snapshots', () => {
  it('keeps the winning key and copies, without exposing mutable storage', async () => {
    const { storage } = shared({
      'id:a': at('later', 4),
      'path:a.epub': at('earlier', 2),
    })
    const places = new BookPlaces(storage)
    const snapshot = await places.snapshot()
    expect(snapshot.get('a.epub')).toEqual({ key: 'id:a', place: at('later', 4) })
    snapshot.get('a.epub')!.place.cfi = 'changed'
    expect((await places.get('id:a'))?.cfi).toBe('later')
  })

  it('records opens without changing the last page turn, retaining metadata on a same-page relocation', async () => {
    const { storage } = memory()
    const places = new BookPlaces(storage)
    const changes = vi.fn()
    const newer = vi.fn()
    places.onChange(changes)
    places.onNewer(newer)
    await places.set('id:a', { cfi: 'page', path: 'a.epub', fraction: 0.2 })
    const at = (await places.get('id:a'))!.at
    await places.opened('id:a', 'a.epub', { title: 'Sample', author: 'Writer' })
    await places.set('id:a', {
      cfi: 'page',
      path: 'a.epub',
      fraction: 0.2,
      measure: { kind: 'locations', count: 100 },
    })
    expect(await places.get('id:a')).toMatchObject({
      at,
      openedAt: expect.any(Number),
      title: 'Sample',
      author: 'Writer',
      measure: { kind: 'locations', count: 100 },
    })
    expect(changes).toHaveBeenCalledTimes(3)
    expect(newer).not.toHaveBeenCalled()
  })

  it('restores reader metadata from a newer backup and writes it into the main copy', async () => {
    const base = { cfi: 'same', fraction: 0.5, path: 'a.epub', at: 10 }
    const { store, storage } = memory(
      JSON.stringify({ 'id:a': base }),
      JSON.stringify({ 'id:a': { ...base, openedAt: 40, title: 'Sample' } })
    )
    const places = new BookPlaces(storage)
    expect((await places.get('id:a'))?.title).toBe('Sample')
    await places.flush()
    expect(JSON.parse(store.data!)['id:a'].openedAt).toBe(40)
  })

  it('can invalidate readers of derived data without changing a position or following another device', async () => {
    const { store, storage } = memory()
    const places = new BookPlaces(storage)
    const changed = vi.fn()
    const newer = vi.fn()
    places.onChange(changed)
    places.onNewer(newer)
    places.invalidate()
    expect(changed).toHaveBeenCalledOnce()
    expect(newer).not.toHaveBeenCalled()
    expect(store.writes).toBe(0)
  })

  it('does not treat a remote open at the same place as a new place to follow', async () => {
    const place = { cfi: 'same', fraction: 0.5, path: 'a.epub', at: 10, openedAt: 20 }
    const { store, storage } = shared({ 'id:a': place })
    const places = new BookPlaces(storage)
    await places.get('id:a')
    const newer = vi.fn()
    const changed = vi.fn()
    places.onNewer(newer)
    places.onChange(changed)
    store.main = JSON.stringify({ 'id:a': { ...place, openedAt: 40 } })
    await places.refresh()
    expect(newer).not.toHaveBeenCalled()
    expect(changed).toHaveBeenCalledOnce()
    expect((await places.get('id:a'))?.openedAt).toBe(40)
  })

  it('persists reader measurements and open time in both copies without changing the place time', async () => {
    const { store, storage } = memory()
    const places = new BookPlaces(storage)
    await places.set('id:sample', { cfi: 'page', fraction: 0.25, path: 'Sample/book.epub' })
    const before = (await places.get('id:sample'))!.at
    await places.opened('id:sample', 'Sample/book.epub', { title: 'Sample title' })
    await places.measured('id:sample', 'Sample/book.epub', { kind: 'locations', count: 80 })
    await places.flush()
    const reopened = new BookPlaces(storage)
    expect(await reopened.get('id:sample')).toMatchObject({
      cfi: 'page',
      at: before,
      title: 'Sample title',
      openedAt: expect.any(Number),
      measure: { kind: 'locations', count: 80 },
    })
    expect(JSON.parse(store.backup!)['id:sample'].at).toBe(before)
  })

  it('keeps cached metadata and updates a moved book path on a new open', async () => {
    const { storage } = memory()
    const places = new BookPlaces(storage)
    await places.opened('id:sample', 'Sample/old.epub', { title: 'Sample title' })
    await places.opened('id:sample', 'Sample/new.epub', {})
    expect((await places.snapshot()).get('Sample/new.epub')?.place.title).toBe('Sample title')
  })

  it('records a page count even when the first open has not saved a CFI', async () => {
    const { storage } = memory()
    const places = new BookPlaces(storage)
    await places.opened('path:a.pdf', 'a.pdf', {})
    await places.measured('path:a.pdf', 'a.pdf', { kind: 'pages', count: 8 })
    expect((await places.snapshot()).get('a.pdf')?.place).toMatchObject({
      cfi: '',
      at: 0,
      measure: { kind: 'pages', count: 8 },
    })
  })

  it('notifies local and remote changes, isolates failures and stops on unsubscribe', async () => {
    const { store, storage } = memory()
    const places = new BookPlaces(storage)
    const called = vi.fn()
    places.onChange(() => {
      throw new Error('listener')
    })
    const stop = places.onChange(called)
    await places.set('path:a.epub', { cfi: 'a', fraction: 0, path: 'a.epub' })
    await places.set('path:a.epub', { cfi: 'a', fraction: 0, path: 'a.epub' })
    expect(called).toHaveBeenCalledTimes(1)
    await places.flush()
    store.data = JSON.stringify({ 'path:a.epub': at('b', Date.now() + 1000) })
    await places.refresh()
    expect(called).toHaveBeenCalledTimes(2)
    stop()
    await places.renamed('a.epub', 'b.epub')
    expect(called).toHaveBeenCalledTimes(2)
  })
})

describe('the places across a restart', () => {
  const place = (cfi: string, at: number) =>
    JSON.stringify({ 'id:a': { cfi, fraction: 0.5, path: 'a.epub', at } })

  it('are read from the backup when the main copy was left empty by a write cut short', async () => {
    const { storage } = memory('', place('epubcfi(/6/6!/4)', 5))
    expect((await new BookPlaces(storage).get('id:a'))?.cfi).toBe('epubcfi(/6/6!/4)')
    const broken = memory('{"id:a": {"cf', place('epubcfi(/6/8!/4)', 5))
    expect((await new BookPlaces(broken.storage).get('id:a'))?.cfi).toBe('epubcfi(/6/8!/4)')
  })

  it('take the newer copy when both are whole, and the main one when the backup is cut short', async () => {
    const { storage } = memory(place('epubcfi(/6/2!/4)', 1), place('epubcfi(/6/4!/4)', 2))
    expect((await new BookPlaces(storage).get('id:a'))?.cfi).toBe('epubcfi(/6/4!/4)')
    const other = memory(place('epubcfi(/6/2!/4)', 1), '')
    expect((await new BookPlaces(other.storage).get('id:a'))?.cfi).toBe('epubcfi(/6/2!/4)')
  })

  it('take the newer place of each book, not the newer copy as a whole', async () => {
    const two = (a: [string, number], b: [string, number]) =>
      JSON.stringify({
        'id:a': { cfi: a[0], fraction: 0.1, path: 'a.epub', at: a[1] },
        'id:b': { cfi: b[0], fraction: 0.1, path: 'b.epub', at: b[1] },
      })
    const { storage } = memory(
      two(['a-main', 5], ['b-main', 1]),
      two(['a-backup', 1], ['b-backup', 9])
    )
    const places = new BookPlaces(storage)
    expect((await places.get('id:a'))?.cfi).toBe('a-main')
    expect((await places.get('id:b'))?.cfi).toBe('b-backup')
  })

  it('writes the backup first, and nothing at all when no place changed', async () => {
    const order: string[] = []
    const storage: PlaceStorage = {
      read: async () => place('epubcfi(/6/2!/4)', 1),
      write: async (_d, copy) => void order.push(copy),
    }
    const places = new BookPlaces(storage, 1000)
    await places.get('id:a')
    await places.flush()
    expect(order).toEqual([])
    await places.set('id:a', { cfi: 'epubcfi(/6/4!/4)', fraction: 0.2, path: 'a.epub' })
    await places.flush()
    await places.flush()
    expect(order).toEqual(['backup', 'main'])
  })

  it('are not wiped by a flush that comes before they were read', async () => {
    // What a tab restored at startup does: it closes whatever it showed before opening the book,
    // which flushes, and only then asks for the book's place.
    const saved = JSON.stringify({
      'id:a': { cfi: 'epubcfi(/6/6!/4)', fraction: 0.9, path: 'a.epub', at: 1 },
    })
    const { store, storage } = memory(saved)
    const places = new BookPlaces(storage, 1000)
    const flushed = places.flush()
    const place = await places.get('id:a')
    await flushed
    expect(place?.cfi).toBe('epubcfi(/6/6!/4)')
    expect(store.data).toBe(saved)
    expect(store.writes).toBe(0)
  })

  it('are written at once when the app is hidden, which on a phone may be the last it hears', async () => {
    vi.useFakeTimers()
    const { store, storage } = memory()
    const places = new BookPlaces(storage, 1000)
    const stop = places.flushWhenHidden(window)
    await places.set('id:a', { cfi: 'epubcfi(/6/2!/4)', fraction: 0.1, path: 'a.epub' })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.writes).toBe(1)
    await places.set('id:a', { cfi: 'epubcfi(/6/4!/4)', fraction: 0.2, path: 'a.epub' })
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.writes).toBe(2)
    stop()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })
})

/** A shared file (`main`), this device's backup, and the plugin folder's file from before. */
const shared = (
  main: Record<string, unknown> | null,
  legacy: Record<string, unknown> | null = null
) => {
  const store = {
    main: main ? JSON.stringify(main) : null,
    backup: null as string | null,
    legacy: legacy ? JSON.stringify(legacy) : null,
    writes: 0,
  }
  const storage: PlaceStorage = {
    read: async (copy) => (copy === 'backup' ? store.backup : store.main),
    write: async (d, copy) => {
      if (copy === 'backup') store.backup = d
      else {
        store.main = d
        store.writes++
      }
    },
    legacy: async () => [store.legacy],
    dropLegacy: async () => void (store.legacy = null),
  }
  return {
    store,
    storage,
    saved: () => JSON.parse(store.main ?? '{}') as Record<string, BookPlace>,
  }
}
const at = (cfi: string, when: number, path = 'a.epub') => ({ cfi, fraction: 0.5, path, at: when })

describe('the places in a file in the vault, which every device writes', () => {
  it('fold in the plugin folder’s file from before, a newer place kept, and write it to the vault once', async () => {
    vi.useFakeTimers()
    const { store, storage, saved } = shared(
      { 'id:a': at('vault-a', 5) },
      { 'id:a': at('old-a', 2), 'id:b': at('old-b', 3, 'b.epub') }
    )
    const places = new BookPlaces(storage, 1000)
    expect((await places.get('id:a'))?.cfi).toBe('vault-a')
    expect((await places.get('id:b'))?.cfi).toBe('old-b')
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.writes).toBe(1)
    expect(Object.keys(saved()).sort()).toEqual(['id:a', 'id:b'])
    // Written into the vault: the old file goes, its places kept in the backup as well.
    expect(store.legacy).toBeNull()
    expect(JSON.parse(store.backup!)['id:b'].cfi).toBe('old-b')
  })

  it('read the file again before writing, keeping what another device put there since', async () => {
    const { store, storage, saved } = shared({ 'id:a': at('a-1', 1) })
    const places = new BookPlaces(storage, 1000)
    await places.get('id:a')
    // Another device, meanwhile: a book this one has not seen, and a later place in one it has.
    store.main = JSON.stringify({
      'id:a': at('a-other', Date.now() + 60_000),
      'id:c': at('c-other', 7, 'c.epub'),
    })
    await places.set('id:b', { cfi: 'b-here', fraction: 0.2, path: 'b.epub' })
    await places.flush()
    expect(saved()['id:a'].cfi).toBe('a-other')
    expect(saved()['id:b'].cfi).toBe('b-here')
    expect(saved()['id:c'].cfi).toBe('c-other')
    expect((await places.get('id:a'))?.cfi).toBe('a-other')
  })

  it('a place read here later than the file’s is the one written', async () => {
    const { storage, saved } = shared({ 'id:a': at('a-old', 1) })
    const places = new BookPlaces(storage, 1000)
    await places.set('id:a', { cfi: 'a-here', fraction: 0.2, path: 'a.epub' })
    await places.flush()
    expect(saved()['id:a'].cfi).toBe('a-here')
  })

  it('take a newer place from the file when it changes on disk, and say which books moved', async () => {
    const { store, storage } = shared({ 'id:a': at('a-1', 1), 'id:b': at('b-1', 1, 'b.epub') })
    const places = new BookPlaces(storage, 1000)
    await places.get('id:a')
    const moved: string[][] = []
    const stop = places.onNewer((keys) => moved.push(keys))
    store.main = JSON.stringify({ 'id:a': at('a-2', 9), 'id:b': at('b-0', 0, 'b.epub') })
    await places.refresh()
    expect((await places.get('id:a'))?.cfi).toBe('a-2')
    expect((await places.get('id:b'))?.cfi).toBe('b-1')
    expect(moved).toEqual([['id:a']])
    // The file as this device wrote it, heard back: nothing new.
    await places.refresh()
    expect(moved).toHaveLength(1)
    stop()
  })

  it('move to another file: all of them written there, with what it held, and none lost', async () => {
    const from = shared({ 'id:a': at('a-1', 5) })
    const to = shared({ 'id:a': at('a-there', 1), 'id:c': at('c-there', 2, 'c.epub') })
    const places = new BookPlaces(from.storage, 1000)
    await places.set('id:b', { cfi: 'b-here', fraction: 0.2, path: 'b.epub' })
    expect(await places.moveTo(to.storage)).toBe(true)
    expect(Object.keys(to.saved()).sort()).toEqual(['id:a', 'id:b', 'id:c'])
    expect(to.saved()['id:a'].cfi).toBe('a-1')
    // Later places go to the new file only.
    const before = from.store.writes
    await places.set('id:b', { cfi: 'b-later', fraction: 0.3, path: 'b.epub' })
    await places.flush()
    expect(from.store.writes).toBe(before)
    expect(to.saved()['id:b'].cfi).toBe('b-later')
  })

  it('will not move onto a file that holds something else', async () => {
    const from = shared({ 'id:a': at('a-1', 5) })
    const other: PlaceStorage = {
      read: async () => 'a note of the person’s own, not places',
      write: vi.fn(async () => {}),
    }
    const places = new BookPlaces(from.storage, 1000)
    await places.get('id:a')
    expect(await places.moveTo(other)).toBe(false)
    expect(other.write).not.toHaveBeenCalled()
    await places.set('id:a', { cfi: 'a-2', fraction: 0.2, path: 'a.epub' })
    await places.flush()
    expect(from.saved()['id:a'].cfi).toBe('a-2')
  })
})
