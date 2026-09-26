/**
 * Notes that link to places in a book, found for the reader to mark (`src/reader/linkedNotes.ts`).
 */
import { describe, it, expect, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { LinkedNotes, placesLinkedFrom } from '@/reader/linkedNotes'
import { encodeCfi } from '@/reader/bookLinks'

const CFI = 'epubcfi(/6/8!/4/2,/1:0,/1:22)'
const OTHER = 'epubcfi(/6/10!/4/6,/1:4,/1:9)'
const BOOK = 'Books/Dune.epub'
const dest = (linkpath: string) =>
  linkpath === 'Dune.epub' || linkpath === BOOK
    ? BOOK
    : linkpath === 'Other.epub'
      ? 'Other.epub'
      : null
const link = (target: string, line: number) => ({
  link: target,
  original: `[[${target}]]`,
  position: { start: { line, col: 0, offset: 0 }, end: { line, col: 0, offset: 0 } },
})

describe('the places a note links to in a book', () => {
  it('reads cfi links from the text and the properties, with their lines', () => {
    const places = placesLinkedFrom(
      {
        links: [link(`Dune.epub#cfi=${encodeCfi(CFI)}`, 7), link('Dune.epub', 8)],
        frontmatterLinks: [
          { key: 'source', link: `Dune.epub#cfi=${encodeCfi(OTHER)}`, original: '' },
        ],
      },
      'Cards/word.md',
      BOOK,
      dest
    )
    expect(places).toEqual([
      { cfi: OTHER, line: 0 },
      { cfi: CFI, line: 7 },
    ])
  })

  it('leaves out other books, pages and headings', () => {
    const places = placesLinkedFrom(
      {
        links: [
          link(`Other.epub#cfi=${encodeCfi(CFI)}`, 1),
          link('Dune.epub#page=4', 2),
          link('Dune.epub#Chapter 3', 3),
        ],
      },
      'n.md',
      BOOK,
      dest
    )
    expect(places).toEqual([])
  })
})

function vaultWith(notes: Record<string, { links: ReturnType<typeof link>[] }>) {
  const handlers = new Map<string, (...a: unknown[]) => void>()
  const files = new Map<string, TFile>()
  const caches = new Map(Object.entries(notes))
  const fileOf = (path: string) => {
    let f = files.get(path)
    if (!f) {
      f = new TFile()
      f.path = path
      f.extension = path.split('.').pop() ?? ''
      files.set(path, f)
    }
    return f
  }
  const resolvedLinks = () => {
    const out: Record<string, Record<string, number>> = {}
    for (const [path, c] of caches)
      out[path] = Object.fromEntries(
        c.links.map((l) => [dest(l.link.split('#')[0]) ?? l.link, 1] as [string, number])
      )
    return out
  }
  const on = (name: string, fn: (...a: unknown[]) => void) => {
    handlers.set(name, fn)
    return { name }
  }
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (caches.has(p) ? fileOf(p) : null),
      on,
      offref: vi.fn(),
    },
    metadataCache: {
      get resolvedLinks() {
        return resolvedLinks()
      },
      getFileCache: (f: TFile) => caches.get(f.path) ?? null,
      getFirstLinkpathDest: (lp: string) => {
        const d = dest(lp)
        return d ? fileOf(d) : null
      },
      on,
      offref: vi.fn(),
    },
  } as unknown as App
  return { app, caches, handlers, fileOf }
}

describe('the notes linking to one book', () => {
  it('finds them from the link index, skips the ones with marks of their own, and follows edits', () => {
    const { app, caches, handlers, fileOf } = vaultWith({
      'Cards/sand.md': { links: [link(`Dune.epub#cfi=${encodeCfi(CFI)}`, 3)] },
      'Cards/spice.md': { links: [link(`Dune.epub#cfi=${encodeCfi(CFI)}`, 1)] },
      'Dune highlights.md': { links: [link(`Dune.epub#cfi=${encodeCfi(OTHER)}`, 5)] },
      'Unrelated.md': { links: [link('Other.epub', 1)] },
    })
    const changed = vi.fn()
    const index = new LinkedNotes(app, fileOf(BOOK), (p) => p === 'Dune highlights.md', changed)
    index.start()
    expect(index.places()).toEqual([CFI])
    expect(index.at(CFI)).toEqual([
      { path: 'Cards/sand.md', line: 3 },
      { path: 'Cards/spice.md', line: 1 },
    ])

    // A new card, as Obsidian reports it once it has read the note.
    caches.set('Cards/dune.md', { links: [link(`Dune.epub#cfi=${encodeCfi(OTHER)}`, 2)] })
    handlers.get('changed')!(fileOf('Cards/dune.md'))
    expect(changed).toHaveBeenCalledTimes(1)
    expect(index.at(OTHER)).toEqual([{ path: 'Cards/dune.md', line: 2 }])

    // An edit that changes nothing about the book is not news.
    handlers.get('changed')!(fileOf('Unrelated.md'))
    expect(changed).toHaveBeenCalledTimes(1)

    handlers.get('deleted')!(fileOf('Cards/spice.md'))
    expect(index.at(CFI)).toEqual([{ path: 'Cards/sand.md', line: 3 }])

    caches.set('Cards/grain.md', caches.get('Cards/sand.md')!)
    caches.delete('Cards/sand.md')
    handlers.get('rename')!(fileOf('Cards/grain.md'), 'Cards/sand.md')
    expect(index.at(CFI)).toEqual([{ path: 'Cards/grain.md', line: 3 }])
    expect(changed).toHaveBeenCalledTimes(3)

    index.stop()
    expect(index.places()).toEqual([])
  })
})
