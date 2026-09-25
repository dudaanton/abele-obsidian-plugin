/**
 * Bookmarks in books: pages marked to come back to, on this device and on the others.
 *
 * They are kept by book, under the same key as the book's place (`bookKey`), and each by an id of
 * its own. Every device writes the one file (`bookmarkFiles.ts`), so nothing here replaces a
 * bookmark by an older copy of it: each keeps the version changed last (`at`), wherever it was
 * changed. A bookmark removed stays in the file as removed (`deleted`), with the time — otherwise
 * another device's copy, which still has it, would bring it back. Those are forgotten after
 * `FORGET_REMOVED_MS`.
 *
 * The file is read again just before each write, and whenever it changes on disk, and what is
 * newer there is taken and said (`onChange`), so an open book can show it.
 */
import { collapse, compare } from '@/vendor/foliate-js/epubcfi.js'

export interface Bookmark {
  id: string
  /** The page's own CFI when it was marked: the words on it, in a book; the page, in a PDF. */
  cfi: string
  /** How far into the book, 0 to 1: its order when the CFI cannot say. */
  fraction: number
  /** The chapter, or the PDF's page, it is in. */
  label: string
  /** The first words of the page, for the list. */
  text: string
  /** When it was made, ms since the epoch. */
  created: number
  /** When it was last changed — made or removed. */
  at: number
  /** Removed: kept so another device's copy does not bring it back. */
  deleted?: boolean
}

/** Where the bookmarks are kept: the file, and a backup of it on this device. */
export interface BookmarkStorage {
  read(copy: 'main' | 'backup'): Promise<string | null>
  write(data: string, copy: 'main' | 'backup'): Promise<void>
}

type Books = Record<string, Record<string, Bookmark>>

/** How long a removed bookmark is remembered as removed. */
export const FORGET_REMOVED_MS = 180 * 24 * 3600_000

const isBookmark = (b: unknown): b is Bookmark => {
  const x = b as Bookmark | null
  return !!x && typeof x.cfi === 'string' && typeof x.id === 'string' && typeof x.at === 'number'
}

/** A copy's bookmarks, or null when it is missing, empty or cut short. */
export function parseBookmarks(raw: string | null): Books | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const out: Books = {}
    for (const [key, marks] of Object.entries(parsed as Record<string, unknown>)) {
      if (!marks || typeof marks !== 'object') continue
      for (const [id, mark] of Object.entries(marks as Record<string, unknown>))
        if (isBookmark(mark) && mark.id === id) (out[key] ??= {})[id] = mark
    }
    return out
  } catch {
    return null
  }
}

/**
 * Takes into `into` each bookmark of `from` changed later than its own, or that it lacks. Says
 * which books changed.
 */
export function mergeBookmarks(into: Books, from: Books | null): string[] {
  const changed = new Set<string>()
  for (const [key, marks] of Object.entries(from ?? {}))
    for (const [id, mark] of Object.entries(marks)) {
      const mine = into[key]?.[id]
      if (mine && mine.at >= mark.at) continue
      ;(into[key] ??= {})[id] = { ...mark }
      changed.add(key)
    }
  return [...changed]
}

/** Whether `books` holds something `file` lacks or has older. */
const ahead = (books: Books, file: Books | null): boolean =>
  Object.entries(books).some(([key, marks]) =>
    Object.values(marks).some((m) => (file?.[key]?.[m.id]?.at ?? -1) < m.at)
  )

/** The engine reads anything as a CFI; only one that looks like one is compared. */
const isCfi = (cfi: string) => /^epubcfi\(\/.*\)$/s.test(cfi)

/** The book order of two bookmarks: by where they are, by how far in when that cannot be read. */
export function bookOrder(a: Bookmark, b: Bookmark): number {
  try {
    const c = isCfi(a.cfi) && isCfi(b.cfi) ? compare(collapse(a.cfi), collapse(b.cfi)) : 0
    if (c) return c
  } catch {
    // A CFI that does not parse: the fraction decides.
  }
  return a.fraction - b.fraction || a.created - b.created
}

/**
 * The bookmarks on the page whose CFI is `page`: those that start between the page's first and
 * last words. A PDF's page has no words in its CFI, so it is the page itself.
 */
export function onPage(marks: Bookmark[], page: string | null | undefined): Bookmark[] {
  if (!page || !isCfi(page)) return []
  let start: string, end: string
  try {
    start = collapse(page)
    end = collapse(page, true)
  } catch {
    return []
  }
  return marks.filter((m) => {
    if (!isCfi(m.cfi)) return false
    try {
      const at = collapse(m.cfi)
      if (compare(at, start) < 0) return false
      // The page's last position is the next page's first: a mark there is on the next page.
      return start === end ? compare(at, start) === 0 : compare(at, end) < 0
    } catch {
      return false
    }
  })
}

let counter = 0
const newId = () =>
  `${Date.now().toString(36)}${(counter++ % 1296).toString(36).padStart(2, '0')}${Math.random()
    .toString(36)
    .slice(2, 6)}`

export class BookBookmarks {
  private books: Books = {}
  private loaded: Promise<void> | null = null
  private dirty = false
  private timer: number | null = null
  private pending: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(keys: string[]) => void>()

  constructor(
    private storage: BookmarkStorage,
    private readonly delayMs = 500
  ) {}

  private read(copy: 'main' | 'backup', storage = this.storage): Promise<Books | null> {
    return storage.read(copy).then(parseBookmarks, (e: unknown): null => {
      console.warn(`[Abele] bookmarks (${copy}) could not be read`, e)
      return null
    })
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const [main, backup] = await Promise.all([this.read('main'), this.read('backup')])
      // Made in this session before the file was read: newer than anything in it.
      const made = this.books
      this.books = {}
      mergeBookmarks(this.books, main)
      mergeBookmarks(this.books, backup)
      mergeBookmarks(this.books, made)
      if (ahead(this.books, main)) {
        this.dirty = true
        this.schedule()
      }
    })()
    return this.loaded
  }

  private tell(keys: string[]): void {
    if (keys.length) for (const listener of this.listeners) listener(keys)
  }

  /** Told the books whose bookmarks changed. Returns what stops it. */
  onChange(listener: (keys: string[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Hears what another device put in the file, once it has arrived. */
  async refresh(): Promise<void> {
    await this.load()
    this.tell(mergeBookmarks(this.books, await this.read('main')))
  }

  /** A book's bookmarks, in the book's order; the removed ones left out. */
  async list(key: string): Promise<Bookmark[]> {
    await this.load()
    return Object.values(this.books[key] ?? {})
      .filter((m) => !m.deleted)
      .map((m) => ({ ...m }))
      .sort(bookOrder)
  }

  async add(
    key: string,
    mark: Pick<Bookmark, 'cfi' | 'fraction' | 'label' | 'text'>
  ): Promise<Bookmark> {
    await this.load()
    const now = Date.now()
    const made: Bookmark = { ...mark, id: newId(), created: now, at: now }
    ;(this.books[key] ??= {})[made.id] = made
    this.changed([key])
    return { ...made }
  }

  async remove(key: string, id: string): Promise<void> {
    await this.load()
    const mark = this.books[key]?.[id]
    if (!mark || mark.deleted) return
    this.books[key][id] = { ...mark, deleted: true, at: Math.max(Date.now(), mark.at + 1) }
    this.changed([key])
  }

  /**
   * A file was renamed: a book kept under its path takes its bookmarks along. Those under the old
   * path are marked removed, so another device's copy does not bring them back there.
   */
  async renamed(oldPath: string, newPath: string): Promise<void> {
    await this.load()
    const from = this.books[`path:${oldPath}`]
    if (!from) return
    const to = (this.books[`path:${newPath}`] ??= {})
    const now = Date.now()
    for (const [id, mark] of Object.entries(from)) {
      if (!mark.deleted) to[id] = { ...mark, at: Math.max(now, mark.at + 1) }
      from[id] = { ...mark, deleted: true, at: Math.max(now, mark.at + 1) }
    }
    this.changed([`path:${oldPath}`, `path:${newPath}`])
  }

  /**
   * The bookmarks moved to another file, with whatever it holds already. A file that holds
   * something other than bookmarks is left alone, and they stay where they were.
   */
  async moveTo(next: BookmarkStorage): Promise<boolean> {
    await this.load()
    await this.flush()
    const raw = await next.read('main').catch((): null => null)
    const there = parseBookmarks(raw)
    if (raw?.trim() && !there) return false
    this.tell(mergeBookmarks(this.books, there))
    this.storage = next
    this.dirty = true
    await this.write()
    return true
  }

  private changed(keys: string[]): void {
    this.dirty = true
    this.schedule()
    this.tell(keys)
  }

  private schedule(): void {
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = window.setTimeout((): void => void this.flush(), this.delayMs)
  }

  /** Writes now whatever is waiting — never before the file has been read. */
  flush(): Promise<void> {
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = null
    const loaded = this.loaded
    if (loaded === null) return this.pending
    return loaded.then(() => this.write())
  }

  /** Flushes whenever the app is hidden or its page goes away. Returns what stops it. */
  flushWhenHidden(win: Window): () => void {
    const onHide = () => {
      if (win.document.visibilityState === 'hidden') void this.flush()
    }
    const onPageHide = (): void => void this.flush()
    win.document.addEventListener('visibilitychange', onHide)
    win.addEventListener('pagehide', onPageHide)
    return () => {
      win.document.removeEventListener('visibilitychange', onHide)
      win.removeEventListener('pagehide', onPageHide)
    }
  }

  private write(): Promise<void> {
    if (!this.dirty) return this.pending
    this.dirty = false
    const storage = this.storage
    this.pending = this.pending
      .then(async () => {
        // What another device wrote since this one last read the file is kept.
        this.tell(mergeBookmarks(this.books, await this.read('main', storage)))
        const forget = Date.now() - FORGET_REMOVED_MS
        for (const [key, marks] of Object.entries(this.books)) {
          for (const [id, mark] of Object.entries(marks))
            if (mark.deleted && mark.at < forget) delete marks[id]
          if (!Object.keys(marks).length) delete this.books[key]
        }
        const data = JSON.stringify(this.books)
        await storage.write(data, 'backup')
        await storage.write(data, 'main')
      })
      .catch((e) => {
        this.dirty = true
        console.warn('[Abele] bookmarks could not be saved', e)
      })
    return this.pending
  }
}
