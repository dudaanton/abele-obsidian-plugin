/**
 * Bookmarks in books (`src/reader/bookmarks.ts`) and their file in the vault
 * (`src/reader/bookmarkFiles.ts`): kept per book and per bookmark, merged with another device's
 * copy by when each was changed, a removed one kept as removed so it does not come back, and the
 * bookmarks on the page on screen told apart.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TFile } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_READER_SETTINGS } from '@/reader/settings'
import {
  BookBookmarks,
  FORGET_REMOVED_MS,
  onPage,
  parseBookmarks,
  type Bookmark,
  type BookmarkStorage,
} from '@/reader/bookmarks'
import { bookmarksPathOf, bookmarkFiles, initBookBookmarks } from '@/reader/bookmarkFiles'
import { MOVE_AFTER_MS, type PlacesAdapter } from '@/reader/places'
import { PageBookmarks } from '@/reader/pageBookmarks'
import { emptyBookModel } from '@/reader/model'
import { reactive } from 'vue'

const memory = (initial: string | null = null, backup: string | null = initial) => {
  const store = { data: initial, backup, writes: 0 }
  const storage: BookmarkStorage = {
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

const mark = (id: string, cfi: string, at: number, over: Partial<Bookmark> = {}): Bookmark => ({
  id,
  cfi,
  fraction: 0.5,
  label: 'Chapter',
  text: 'Words',
  created: at,
  at,
  ...over,
})

const PAGE_TWO = 'epubcfi(/6/4!/4,/2/1:5,/10/1:30)'

afterEach(() => vi.useRealTimers())

describe('a book’s bookmarks', () => {
  it('keeps one made and writes it a moment later, in both copies', async () => {
    vi.useFakeTimers()
    const { store, storage } = memory()
    const marks = new BookBookmarks(storage, 500)
    const made = await marks.add('id:a', {
      cfi: PAGE_TWO,
      fraction: 0.2,
      label: 'Two',
      text: 'It was',
    })
    expect(store.writes).toBe(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(store.writes).toBe(1)
    const saved = JSON.parse(store.data!)
    expect(saved['id:a'][made.id]).toMatchObject({ cfi: PAGE_TWO, label: 'Two', text: 'It was' })
    expect(store.backup).toBe(store.data)
    expect(await marks.list('id:a')).toHaveLength(1)
    expect(await marks.list('id:b')).toEqual([])
  })

  it('lists them in the book’s order, not the order they were made in', async () => {
    const { storage } = memory()
    const marks = new BookBookmarks(storage)
    await marks.add('k', { cfi: 'epubcfi(/6/8!/4/2/1:0)', fraction: 0.8, label: '', text: 'late' })
    await marks.add('k', { cfi: 'epubcfi(/6/2!/4/2/1:0)', fraction: 0.1, label: '', text: 'early' })
    await marks.add('k', { cfi: 'not a cfi', fraction: 0.5, label: '', text: 'middle' })
    expect((await marks.list('k')).map((m) => m.text)).toEqual(['early', 'middle', 'late'])
  })

  it('keeps one removed as removed, so an older copy from another device does not bring it back', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const { store, storage } = memory(JSON.stringify({ k: { x: mark('x', PAGE_TWO, 5_000) } }))
    const marks = new BookBookmarks(storage, 100)
    await marks.remove('k', 'x')
    expect(await marks.list('k')).toEqual([])
    await vi.advanceTimersByTimeAsync(100)
    expect(JSON.parse(store.data!).k.x).toMatchObject({ deleted: true, at: 10_000 })
    // Another device, which still had it, writes its copy back.
    store.data = JSON.stringify({ k: { x: mark('x', PAGE_TWO, 5_000) } })
    await marks.refresh()
    expect(await marks.list('k')).toEqual([])
  })

  it('takes what another device added or removed later, and says which books changed', async () => {
    const { store, storage } = memory(JSON.stringify({ k: { x: mark('x', PAGE_TWO, 1) } }))
    const marks = new BookBookmarks(storage)
    expect(await marks.list('k')).toHaveLength(1)
    const heard: string[][] = []
    marks.onChange((keys) => heard.push(keys))
    store.data = JSON.stringify({
      k: { x: mark('x', PAGE_TWO, 9, { deleted: true }) },
      j: { y: mark('y', PAGE_TWO, 9) },
    })
    await marks.refresh()
    expect(heard).toEqual([['k', 'j']])
    expect(await marks.list('k')).toEqual([])
    expect((await marks.list('j')).map((m) => m.id)).toEqual(['y'])
  })

  it('keeps what another device wrote since the file was read, when it writes its own', async () => {
    vi.useFakeTimers()
    const { store, storage } = memory(JSON.stringify({}))
    const marks = new BookBookmarks(storage, 100)
    const mine = await marks.add('k', { cfi: PAGE_TWO, fraction: 0, label: '', text: '' })
    store.data = JSON.stringify({ k: { theirs: mark('theirs', PAGE_TWO, 1) } })
    await vi.advanceTimersByTimeAsync(100)
    expect(Object.keys(JSON.parse(store.data!).k).sort()).toEqual([mine.id, 'theirs'].sort())
  })

  it('reads the backup when the file was cut short, and ignores what is not a bookmark', async () => {
    const good = JSON.stringify({ k: { x: mark('x', PAGE_TWO, 1), bad: { cfi: 1 } } })
    const { storage } = memory('{"k": {"x": {"cf', good)
    const marks = new BookBookmarks(storage)
    expect((await marks.list('k')).map((m) => m.id)).toEqual(['x'])
    expect(parseBookmarks(good)?.k.bad).toBeUndefined()
  })

  it('forgets bookmarks removed long ago', async () => {
    vi.useFakeTimers()
    const now = FORGET_REMOVED_MS * 2
    vi.setSystemTime(now)
    const old = mark('old', PAGE_TWO, now - FORGET_REMOVED_MS - 1, { deleted: true })
    const recent = mark('recent', PAGE_TWO, now - 1000, { deleted: true })
    const { store, storage } = memory(JSON.stringify({ k: { old, recent }, gone: { old } }))
    const marks = new BookBookmarks(storage, 100)
    await marks.add('k', { cfi: PAGE_TWO, fraction: 0, label: '', text: '' })
    await vi.advanceTimersByTimeAsync(100)
    const saved = JSON.parse(store.data!)
    expect(saved.k.old).toBeUndefined()
    expect(saved.k.recent).toBeDefined()
    expect(saved.gone).toBeUndefined()
  })

  it('follows a book kept by its path when it is renamed, and leaves the old path’s ones removed', async () => {
    const { storage } = memory(
      JSON.stringify({ 'path:a.pdf': { x: mark('x', 'epubcfi(/6/4)', 1) } })
    )
    const marks = new BookBookmarks(storage)
    await marks.renamed('a.pdf', 'Books/a.pdf')
    expect((await marks.list('path:Books/a.pdf')).map((m) => m.id)).toEqual(['x'])
    expect(await marks.list('path:a.pdf')).toEqual([])
  })
})

describe('the bookmarks on the page on screen', () => {
  const marks = [
    mark('before', 'epubcfi(/6/4!/4/2/1:0)', 1),
    mark('on', 'epubcfi(/6/4!/4/4,/1:0,/1:10)', 1),
    mark('first-word', 'epubcfi(/6/4!/4/2,/1:5,/1:9)', 1),
    mark('at-end', 'epubcfi(/6/4!/4/10/1:30)', 1),
    mark('other-chapter', 'epubcfi(/6/6!/4/4/1:0)', 1),
  ]

  it('are the ones from the page’s first word to just before its end', () => {
    expect(onPage(marks, PAGE_TWO).map((m) => m.id)).toEqual(['on', 'first-word'])
  })

  it('are a PDF’s page itself', () => {
    const pdf = [mark('p2', 'epubcfi(/6/4)', 1), mark('p3', 'epubcfi(/6/6)', 1)]
    expect(onPage(pdf, 'epubcfi(/6/4)').map((m) => m.id)).toEqual(['p2'])
  })

  it('are none with no page, or one that does not parse', () => {
    expect(onPage(marks, null)).toEqual([])
    expect(onPage([mark('x', 'garbage((', 1)], PAGE_TWO)).toEqual([])
  })
})

describe('the file in the vault', () => {
  const DIR = '.obsidian/plugins/abele'
  const handlers: Record<string, (file: unknown) => void> = {}
  const cleanups: (() => void)[] = []

  function disk(files: Record<string, unknown> = {}) {
    const data = new Map(Object.entries(files).map(([k, v]) => [k, JSON.stringify(v)]))
    const folders = new Set<string>()
    const adapter: PlacesAdapter = {
      exists: async (p) => data.has(p) || folders.has(p),
      read: async (p) => data.get(p) ?? '',
      write: async (p, d) => void data.set(p, d),
      mkdir: async (p) => void folders.add(p),
      remove: async (p) => void data.delete(p),
    }
    const json = (p: string) => (data.has(p) ? JSON.parse(data.get(p)!) : null)
    return { data, folders, adapter, json }
  }
  const pluginOn = (d: ReturnType<typeof disk>) =>
    ({
      manifest: { dir: DIR },
      app: {
        vault: {
          configDir: '.obsidian',
          adapter: d.adapter,
          on: (name: string, cb: (file: unknown) => void) => {
            handlers[name] = cb
            return { name }
          },
        },
      },
      registerEvent: () => {},
      register: (cb: () => void) => cleanups.push(cb),
    }) as never

  beforeEach(() => {
    vi.useFakeTimers()
    AbeleConfig.getInstance().reader = { ...DEFAULT_READER_SETTINGS }
  })
  afterEach(() => {
    for (const c of cleanups.splice(0)) c()
  })

  it('sits beside the places file, whatever that is called', () => {
    const at = (placesPath: string) => bookmarksPathOf({ ...DEFAULT_READER_SETTINGS, placesPath })
    expect(at('abele-book-places.json')).toBe('abele-book-bookmarks.json')
    expect(at('Books/Reading/where.json')).toBe('Books/Reading/abele-book-bookmarks.json')
    // Half typed: the default's folder.
    expect(at('Books/wh')).toBe('abele-book-bookmarks.json')
  })

  it('keeps the backup in the plugin’s folder and makes the file’s folder', async () => {
    const d = disk()
    const files = bookmarkFiles(d.adapter, DIR, 'Books/abele-book-bookmarks.json')
    await files.write('{"a":1}', 'backup')
    await files.write('{"a":2}', 'main')
    expect(d.data.get(`${DIR}/book-bookmarks.backup.json`)).toBe('{"a":1}')
    expect(d.data.get('Books/abele-book-bookmarks.json')).toBe('{"a":2}')
    expect(d.folders.has('Books')).toBe(true)
  })

  it('hears the file change on disk, and moves with the places file’s folder', async () => {
    const d = disk({ 'abele-book-bookmarks.json': { k: { x: mark('x', PAGE_TWO, 1) } } })
    const marks = initBookBookmarks(pluginOn(d))
    expect(await marks.list('k')).toHaveLength(1)
    const heard: string[][] = []
    marks.onChange((keys) => heard.push(keys))
    d.data.set('abele-book-bookmarks.json', JSON.stringify({ k: { y: mark('y', PAGE_TWO, 2) } }))
    handlers.modify(Object.assign(new TFile(), { path: 'abele-book-bookmarks.json' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(heard).toEqual([['k']])

    const config = AbeleConfig.getInstance()
    config.reader = { ...DEFAULT_READER_SETTINGS, placesPath: 'Books/places.json' }
    config.version.value++
    await vi.advanceTimersByTimeAsync(MOVE_AFTER_MS + 50)
    expect(Object.keys(d.json('Books/abele-book-bookmarks.json').k).sort()).toEqual(['x', 'y'])
    expect(d.data.has('abele-book-bookmarks.json')).toBe(false)
  })
})

describe('the bookmarks of an open book', () => {
  const setup = (location: { cfi?: string; range?: Range | null; index?: number }) => {
    const { store, storage } = memory()
    const marks = new BookBookmarks(storage, 100)
    const model = reactive({ ...emptyBookModel(), chapter: 'Chapter Two', fraction: 0.3 })
    const engine = { lastLocation: location, goTo: vi.fn(async () => {}) }
    const pageText = vi.fn(async () => '  Page   three\nwords ')
    return { store, marks, model, engine, pageText }
  }

  it('marks the page on screen with its chapter and first words, and unmarks it on a second press', async () => {
    const range = { toString: () => 'It was a bright cold day in April, and the clocks' } as Range
    const { marks, model, engine } = setup({ cfi: PAGE_TWO, range })
    const page = new PageBookmarks(marks, 'k', model, () => engine)
    await page.toggle()
    await vi.waitFor(() => expect(model.bookmarksHere).toHaveLength(1))
    expect(model.bookmarks).toHaveLength(1)
    expect(model.bookmarks[0]).toMatchObject({
      cfi: PAGE_TWO,
      label: 'Chapter Two',
      fraction: 0.3,
      text: 'It was a bright cold day in April, and the clocks',
    })
    await page.toggle()
    await vi.waitFor(() => expect(model.bookmarksHere).toEqual([]))
    expect(model.bookmarks).toEqual([])
    page.stop()
  })

  it('takes a PDF page’s words from its text, and knows the page again when it comes back to it', async () => {
    const { marks, model, engine, pageText } = setup({
      cfi: 'epubcfi(/6/6)',
      range: null,
      index: 2,
    })
    const page = new PageBookmarks(marks, 'k', model, () => engine, pageText)
    await page.toggle()
    await vi.waitFor(() => expect(model.bookmarks).toHaveLength(1))
    expect(pageText).toHaveBeenCalledWith(2)
    expect(model.bookmarks[0].text).toBe('Page three words')
    engine.lastLocation = { cfi: 'epubcfi(/6/8)', range: null, index: 3 }
    page.relocated()
    expect(model.bookmarksHere).toEqual([])
    engine.lastLocation = { cfi: 'epubcfi(/6/6)', range: null, index: 2 }
    page.relocated()
    expect(model.bookmarksHere).toHaveLength(1)
    await page.go(model.bookmarks[0])
    expect(engine.goTo).toHaveBeenCalledWith('epubcfi(/6/6)')
    page.stop()
  })

  it('shows a bookmark another device made, and stops listening once the book closes', async () => {
    const { store, marks, model, engine } = setup({ cfi: PAGE_TWO, range: null })
    const page = new PageBookmarks(marks, 'k', model, () => engine)
    await vi.waitFor(() => expect(model.bookmarks).toEqual([]))
    store.data = JSON.stringify({ k: { x: mark('x', PAGE_TWO, 5) } })
    await marks.refresh()
    await vi.waitFor(() => expect(model.bookmarksHere).toHaveLength(1))
    page.stop()
    store.data = JSON.stringify({ k: { x: mark('x', PAGE_TWO, 9, { deleted: true }) } })
    await marks.refresh()
    await new Promise((r) => setTimeout(r, 0))
    expect(model.bookmarks).toHaveLength(1)
  })
})
