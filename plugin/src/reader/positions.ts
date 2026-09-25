/**
 * Where each book was left, so it opens there again.
 *
 * A place is kept under the book's own identifier (`dc:identifier`), which travels with the file
 * whatever it is renamed or moved to; a book with none is kept under its path, and the path is
 * followed when the file is renamed. The places live in a file of their own beside the plugin's
 * settings, written a moment after the last page turn, so reading does not rewrite the settings
 * and the places reach another device the way the settings do.
 */

export interface BookPlace {
  /** The EPUB CFI of the page's start. */
  cfi: string
  /** How far into the book, 0 to 1: shown before the book opens, and a fallback for the CFI. */
  fraction: number
  /** The path the book had when it was last read. */
  path: string
  /** When it was last read, ms since the epoch. */
  at: number
}

/**
 * Where the places are kept: two copies of one file. A write replaces a file by emptying it
 * first, and an app stopped in that moment — reloaded, or stopped on a phone — leaves it empty;
 * with two, written one after the other, one of them is always whole.
 */
export interface PlaceStorage {
  read(copy: PlaceCopy): Promise<string | null>
  write(data: string, copy: PlaceCopy): Promise<void>
}

export type PlaceCopy = 'main' | 'backup'

type Places = Record<string, BookPlace>

/** A copy's places, or null when it is missing, empty or cut short. */
function parsePlaces(raw: string | null): Places | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const out: Places = {}
    for (const [key, value] of Object.entries(parsed as Places))
      if (value && typeof value.cfi === 'string') out[key] = value
    return out
  } catch {
    return null
  }
}

const newest = (places: Places): number =>
  Object.values(places).reduce((a, p) => Math.max(a, p.at ?? 0), 0)

/** How many books are remembered; the ones read longest ago go first. */
export const MAX_PLACES = 500

/** The key a book's place is kept under. */
export function bookKey(identifier: unknown, path: string): string {
  const id = typeof identifier === 'string' ? identifier.trim() : ''
  return id ? `id:${id}` : `path:${path}`
}

export class BookPlaces {
  private places: Places = {}
  private loaded: Promise<void> | null = null
  /** A place changed since the last write. */
  private dirty = false
  private timer: number | null = null
  private pending: Promise<void> = Promise.resolve()

  constructor(
    private readonly storage: PlaceStorage,
    private readonly delayMs = 1500
  ) {}

  private load(): Promise<void> {
    const read = (copy: PlaceCopy): Promise<Places | null> =>
      this.storage.read(copy).then(parsePlaces, (e: unknown): null => {
        console.warn(`[Abele] book places (${copy}) could not be read`, e)
        return null
      })
    this.loaded ??= Promise.all([read('main'), read('backup')]).then(([main, backup]) => {
      // The whole one; the newer of the two when both are.
      const best =
        main && backup ? (newest(backup) > newest(main) ? backup : main) : (main ?? backup)
      if (best) this.places = { ...best, ...this.places }
    })
    return this.loaded
  }

  async get(key: string): Promise<BookPlace | null> {
    await this.load()
    return this.places[key] ?? null
  }

  async set(key: string, place: Omit<BookPlace, 'at'>): Promise<void> {
    await this.load()
    this.places[key] = { ...place, at: Date.now() }
    this.dirty = true
    this.schedule()
  }

  /** A file was renamed: a book kept under its path moves with it. */
  async renamed(oldPath: string, newPath: string): Promise<void> {
    await this.load()
    let changed = false
    for (const [key, place] of Object.entries(this.places)) {
      if (place.path !== oldPath) continue
      place.path = newPath
      if (key === `path:${oldPath}`) {
        delete this.places[key]
        this.places[`path:${newPath}`] = place
      }
      changed = true
    }
    if (changed) {
      this.dirty = true
      this.schedule()
    }
  }

  private schedule(): void {
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = window.setTimeout((): void => void this.flush(), this.delayMs)
  }

  /**
   * Writes now whatever is waiting; what a closing tab calls. Before the places have been read
   * there is nothing to write — and writing then would put an empty list over the file, which is
   * how a tab restored at startup, closing what it showed before opening its book, lost every
   * place.
   */
  flush(): Promise<void> {
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = null
    if (!this.loaded) return this.pending
    return this.loaded.then(() => this.write())
  }

  /**
   * Flushes whenever the app is hidden or its page goes away: a phone often stops an app in the
   * background without it ever hearing that it quits. Returns what stops it.
   */
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

  /**
   * Writes the places if one changed since the last write — never otherwise, so quitting,
   * reloading or hiding the app, which all flush, touch the file only when there is news.
   */
  private write(): Promise<void> {
    if (!this.dirty) return this.pending
    this.dirty = false
    const entries = Object.entries(this.places).sort((a, b) => b[1].at - a[1].at)
    this.places = Object.fromEntries(entries.slice(0, MAX_PLACES))
    const data = JSON.stringify(this.places)
    this.pending = this.pending
      .then(() => this.storage.write(data, 'backup'))
      .then(() => this.storage.write(data, 'main'))
      .catch((e) => {
        this.dirty = true
        console.warn('[Abele] book places could not be saved', e)
      })
    return this.pending
  }
}
