/**
 * Where each book was left, so it opens there again — on this device and on the others.
 *
 * A place is kept under the book's own identifier (`dc:identifier`), which travels with the file
 * whatever it is renamed or moved to; a book with none is kept under its path, and the path is
 * followed when the file is renamed. The places live in a file in the vault (`places.ts`), written
 * a moment after the last page turn, so they reach another device the way notes do.
 *
 * Every device writes that one file, so nothing here ever replaces a place by an older one: each
 * book keeps the place read last (`at`), wherever it was read. The file is read again just before
 * each write, and whenever it changes on disk — synced from another device — and what is newer
 * there is taken, and said (`onNewer`), so an open book can follow it.
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
  /** Copies from before the places were kept here, folded in once. */
  legacy?(): Promise<(string | null)[]>
  /** Removes those copies, once their places have been written here. */
  dropLegacy?(): Promise<void>
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

/**
 * Takes into `into` each place of `from` that is newer than its own, or that it lacks. Says which
 * books it took.
 */
function mergeInto(into: Places, from: Places | null): string[] {
  const took: string[] = []
  for (const [key, place] of Object.entries(from ?? {})) {
    const mine = into[key]
    if (mine && (mine.at ?? 0) >= (place.at ?? 0)) continue
    into[key] = place
    took.push(key)
  }
  return took
}

/** Whether `places` holds something `file` lacks or has older. */
const ahead = (places: Places, file: Places | null): boolean =>
  Object.entries(places).some(([k, p]) => !file?.[k] || (file[k].at ?? 0) < (p.at ?? 0))

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
  /** Copies from before are still to be dropped, once their places are written. */
  private legacyLeft = false
  private readonly listeners = new Set<(keys: string[]) => void>()

  constructor(
    private storage: PlaceStorage,
    private readonly delayMs = 1500
  ) {}

  private read(copy: PlaceCopy, storage = this.storage): Promise<Places | null> {
    return storage.read(copy).then(parsePlaces, (e: unknown): null => {
      console.warn(`[Abele] book places (${copy}) could not be read`, e)
      return null
    })
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const [main, backup] = await Promise.all([this.read('main'), this.read('backup')])
      const legacy = (await this.storage.legacy?.().catch((): (string | null)[] => [])) ?? []
      // Set in this session before the file was read: newer than anything in it.
      const set = this.places
      this.places = {}
      mergeInto(this.places, main)
      mergeInto(this.places, backup)
      for (const raw of legacy) mergeInto(this.places, parsePlaces(raw))
      mergeInto(this.places, set)
      this.legacyLeft = legacy.some((raw) => raw !== null)
      // The file lacks something the backup or the old copies hold: written into it.
      if (ahead(this.places, main) || this.legacyLeft) {
        this.dirty = true
        this.schedule()
      }
    })()
    return this.loaded
  }

  /**
   * Hears what another device put in the file, once it has arrived: each place newer than this
   * device's is taken, and the books it was for are said to whoever listens.
   */
  async refresh(): Promise<void> {
    await this.load()
    const took = mergeInto(this.places, await this.read('main'))
    if (took.length) for (const listener of this.listeners) listener(took)
  }

  /** Told the books whose place came newer from another device. Returns what stops it. */
  onNewer(listener: (keys: string[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * The places moved to another file, with whatever it holds already: all of them written there
   * at once, and later ones too. A file that holds something other than places is left alone,
   * and the places stay where they were.
   */
  async moveTo(next: PlaceStorage): Promise<boolean> {
    await this.load()
    await this.flush()
    const raw = await next.read('main').catch((): null => null)
    const there = parsePlaces(raw)
    if (raw?.trim() && !there) return false
    mergeInto(this.places, there)
    this.storage = next
    this.dirty = true
    await this.write()
    return true
  }

  async get(key: string): Promise<BookPlace | null> {
    await this.load()
    return this.places[key] ?? null
  }

  /** Every book's place by the path the book had when it was last read: what the agent lists. */
  async byPath(): Promise<Map<string, BookPlace>> {
    await this.load()
    const out = new Map<string, BookPlace>()
    for (const place of Object.values(this.places)) {
      const known = out.get(place.path)
      if (!known || known.at < place.at) out.set(place.path, { ...place })
    }
    return out
  }

  /**
   * The book is at `place` now. The same page again — the view laid out anew, the tab gone where
   * another device left it — keeps its time: stamped now, it would reach the other device as
   * newer than where that one has read on to.
   */
  async set(key: string, place: Omit<BookPlace, 'at'>): Promise<void> {
    await this.load()
    const known = this.places[key]
    if (known && known.cfi === place.cfi && known.path === place.path) return
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
    const storage = this.storage
    this.pending = this.pending
      .then(async () => {
        // What another device wrote since this one last read the file is kept.
        const took = mergeInto(this.places, await this.read('main', storage))
        if (took.length) for (const listener of this.listeners) listener(took)
        const entries = Object.entries(this.places).sort((a, b) => b[1].at - a[1].at)
        this.places = Object.fromEntries(entries.slice(0, MAX_PLACES))
        const data = JSON.stringify(this.places)
        await storage.write(data, 'backup')
        await storage.write(data, 'main')
        if (this.legacyLeft) {
          this.legacyLeft = false
          await storage.dropLegacy?.()
        }
      })
      .catch((e) => {
        this.dirty = true
        console.warn('[Abele] book places could not be saved', e)
      })
    return this.pending
  }
}
