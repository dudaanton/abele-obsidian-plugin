/**
 * The notes that link to places in one book — `[[Dune.epub#cfi=…]]` in a note's text or its
 * properties — so the reader can mark those words and open the note from them.
 *
 * Read once from Obsidian's own index of links (`resolvedLinks`: which notes link to the book at
 * all), then only the notes that do are looked at for the places they name. Kept up to date note
 * by note as Obsidian re-reads one, so a card made a moment ago is marked while the book is open.
 * What a place is on the page is not worked out here: the marks resolve a place only for the
 * chapter on screen.
 */
import { TFile, type App, type CachedMetadata } from 'obsidian'
import { parsePlaceSubpath } from './bookLinks'

/** A note linking to a place, and the line the link is on (0 for its properties). */
export interface LinkedNote {
  path: string
  line: number
}

/** One place a note links to. */
export interface PlaceRef {
  cfi: string
  line: number
}

/**
 * The places in the book at `bookPath` a note links to, from its cached links. `dest` says which
 * file a link's path goes to from the note, as Obsidian resolves it.
 */
export function placesLinkedFrom(
  cache: Pick<CachedMetadata, 'links' | 'frontmatterLinks'> | null | undefined,
  sourcePath: string,
  bookPath: string,
  dest: (linkpath: string, sourcePath: string) => string | null
): PlaceRef[] {
  const out: PlaceRef[] = []
  const seen = new Set<string>()
  const take = (link: string, line: number) => {
    const hash = link.indexOf('#')
    if (hash <= 0) return
    const place = parsePlaceSubpath(link.slice(hash))
    // A link to a page names no words: there is nothing on the page to mark.
    if (!place || !('cfi' in place)) return
    let linkpath = link.slice(0, hash)
    try {
      linkpath = decodeURIComponent(linkpath)
    } catch {
      // A stray `%` written by hand: taken as it is.
    }
    if (dest(linkpath, sourcePath) !== bookPath) return
    const key = `${place.cfi}\n${line}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ cfi: place.cfi, line })
  }
  for (const l of cache?.frontmatterLinks ?? []) take(l.link, 0)
  for (const l of cache?.links ?? []) take(l.link, l.position?.start?.line ?? 0)
  return out
}

export class LinkedNotes {
  private byNote = new Map<string, PlaceRef[]>()
  private off: (() => void)[] = []
  private stopped = false

  constructor(
    private readonly app: App,
    private readonly book: TFile,
    /** Notes that have marks of their own: the book's highlights notes, its discussions. */
    private readonly skip: (path: string) => boolean,
    /** Told when the places linked to change. */
    private readonly onChange: () => void
  ) {}

  /** Reads every note that links to the book, and follows the vault from then on. */
  start(): void {
    if (this.stopped) return
    this.build()
    const { metadataCache, vault } = this.app
    const changed = metadataCache.on('changed', (file) => {
      if (this.read(file.path)) this.onChange()
    })
    const deleted = metadataCache.on('deleted', (file) => {
      if (this.byNote.delete(file.path)) this.onChange()
    })
    const renamed = vault.on('rename', (file, oldPath) => {
      const had = this.byNote.delete(oldPath)
      if (file instanceof TFile && file.extension === 'md') this.read(file.path)
      if (had || this.byNote.has(file.path)) this.onChange()
    })
    this.off.push(
      () => metadataCache.offref(changed),
      () => metadataCache.offref(deleted),
      () => vault.offref(renamed)
    )
  }

  stop(): void {
    this.stopped = true
    for (const off of this.off) off()
    this.off = []
    this.byNote.clear()
  }

  /** Every note linking to the book, read again. */
  build(): void {
    this.byNote.clear()
    const resolved = this.app.metadataCache.resolvedLinks ?? {}
    for (const source of Object.keys(resolved)) {
      if (resolved[source]?.[this.book.path]) this.read(source)
    }
  }

  /** Reads one note again; whether what it links to in the book changed. */
  read(path: string): boolean {
    const before = JSON.stringify(this.byNote.get(path) ?? [])
    const file = this.app.vault.getAbstractFileByPath(path)
    let places =
      file instanceof TFile
        ? placesLinkedFrom(
            this.app.metadataCache.getFileCache(file),
            path,
            this.book.path,
            (linkpath, from) =>
              this.app.metadataCache.getFirstLinkpathDest(linkpath, from)?.path ?? null
          )
        : []
    // Asked only of a note that links into the book: what has marks of its own can take a
    // look through the vault to say, and every edit anywhere comes through here.
    if (places.length && this.skip(path)) places = []
    if (places.length) this.byNote.set(path, places)
    else this.byNote.delete(path)
    return JSON.stringify(places) !== before
  }

  /** Every place some note links to. */
  places(): string[] {
    const all = new Set<string>()
    for (const list of this.byNote.values()) for (const p of list) all.add(p.cfi)
    return [...all]
  }

  /** The notes linking to one place, each once, at its first link there. */
  at(cfi: string): LinkedNote[] {
    const out: LinkedNote[] = []
    for (const [path, list] of this.byNote) {
      const hit = list.find((p) => p.cfi === cfi)
      if (hit) out.push({ path, line: hit.line })
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }
}
