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

export interface PlaceStorage {
  read(): Promise<string | null>
  write(data: string): Promise<void>
}

/** How many books are remembered; the ones read longest ago go first. */
export const MAX_PLACES = 500

/** The key a book's place is kept under. */
export function bookKey(identifier: unknown, path: string): string {
  const id = typeof identifier === 'string' ? identifier.trim() : ''
  return id ? `id:${id}` : `path:${path}`
}

export class BookPlaces {
  private places: Record<string, BookPlace> = {}
  private loaded: Promise<void> | null = null
  private timer: number | null = null
  private pending: Promise<void> = Promise.resolve()

  constructor(
    private readonly storage: PlaceStorage,
    private readonly delayMs = 1500
  ) {}

  private load(): Promise<void> {
    this.loaded ??= this.storage
      .read()
      .then((raw) => {
        const parsed = raw ? (JSON.parse(raw) as unknown) : null
        if (parsed && typeof parsed === 'object') {
          for (const [key, value] of Object.entries(parsed as Record<string, BookPlace>)) {
            if (value && typeof value.cfi === 'string') this.places[key] = value
          }
        }
      })
      .catch((e) => console.warn('[Abele] book places could not be read', e))
    return this.loaded
  }

  async get(key: string): Promise<BookPlace | null> {
    await this.load()
    return this.places[key] ?? null
  }

  async set(key: string, place: Omit<BookPlace, 'at'>): Promise<void> {
    await this.load()
    this.places[key] = { ...place, at: Date.now() }
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
    if (changed) this.schedule()
  }

  private schedule(): void {
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = window.setTimeout((): void => void this.flush(), this.delayMs)
  }

  /** Writes now whatever is waiting; what a closing tab calls. */
  flush(): Promise<void> {
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = null
    const entries = Object.entries(this.places).sort((a, b) => b[1].at - a[1].at)
    this.places = Object.fromEntries(entries.slice(0, MAX_PLACES))
    const data = JSON.stringify(this.places)
    this.pending = this.pending
      .then(() => this.storage.write(data))
      .catch((e) => console.warn('[Abele] book places could not be saved', e))
    return this.pending
  }
}
