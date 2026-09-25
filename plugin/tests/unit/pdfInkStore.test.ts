/**
 * A PDF's ink written to and read from a vault (`src/reader/ink/inkStore.ts`): a file per page
 * beside the book, the page's callout in the book's note, its own writes not taken for another
 * device's, and the folder following the book when it is renamed.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TFile, TFolder, type App } from 'obsidian'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'
import { InkStore, moveInk } from '@/reader/ink/inkStore'
import { inkSvg, type InkPage } from '@/reader/ink/inkFile'
import type { NotesPlace } from '@/reader/companion'

const BOOK = 'Papers/Paper.pdf'
const INK = 'Papers/Paper ink/Paper page 4.svg'
const NOTE = 'Papers/Paper highlights.md'

const where = (): NotesPlace => ({
  title: 'Paper',
  author: '',
  target: { to: 'book', path: 'Book highlights.md', template: '', alsoIn: [] },
})

const page = (n = 1): InkPage => ({
  width: 612,
  height: 792,
  strokes: Array.from({ length: n }, (_, i) => ({
    tool: 'pen' as const,
    color: 'black' as const,
    size: 2,
    points: [10 + i, 20, 0.5, 30, 40, 0.7],
  })),
})

let app: FakeApp
let store: InkStore
let book: TFile

beforeEach(() => {
  app = buildFakeVault([{ path: BOOK }, { path: 'Papers/Other.md', content: 'x' }])
  const a = app as unknown as {
    fileManager: Record<string, unknown>
    metadataCache: Record<string, unknown>
  }
  a.fileManager.generateMarkdownLink = (f: TFile, _from: string, sub = '', alias = '') =>
    `[[${f.path}${sub}${alias ? `|${alias}` : ''}]]`
  a.metadataCache.fileToLinktext = (f: TFile) => f.path
  book = app.vault.getAbstractFileByPath(BOOK) as TFile
  store = new InkStore(app as unknown as App, book, where)
})

const text = (path: string) => {
  const f = app.vault.getAbstractFileByPath(path)
  return f instanceof TFile ? app.vault.read(f) : Promise.resolve(null)
}

describe("a PDF's ink in the vault", () => {
  it("writes a page's file beside the book and its callout into a new note for the book", async () => {
    await store.write(3, page())
    expect(await text(INK)).toBe(inkSvg(page()))
    const note = (await text(NOTE)) ?? ''
    expect(note).toMatch(/^---\ntype: book-highlights\nbook: "\[\[Papers\/Paper.pdf\]\]"\n---/)
    expect(note).toContain(`> [!ink] [[Papers/Paper.pdf#page=4|Page 4]]\n> ![[${INK}]]`)
  })

  it('writes nothing again when nothing changed, and one callout however often it writes', async () => {
    await store.write(3, page())
    const modified = app.stats.modify
    await store.write(3, page())
    expect(app.stats.modify).toBe(modified)
    await store.write(3, page(2))
    const note = (await text(NOTE)) ?? ''
    expect(note.match(/\[!ink\]/g)).toHaveLength(1)
  })

  it('reads back every page it holds', async () => {
    await store.write(3, page(2))
    await store.write(0, page(1))
    const all = await store.readAll()
    expect([...all.keys()].sort()).toEqual([0, 3])
    expect(all.get(3)).toEqual(page(2))
  })

  it("does not take its own write for another device's, and reads another device's", async () => {
    await store.write(3, page())
    expect(await store.changed(INK)).toBeUndefined()
    await app.vault.modify(app.vault.getAbstractFileByPath(INK) as TFile, inkSvg(page(3)))
    expect(await store.changed(INK)).toEqual(page(3))
    expect(await store.changed('Papers/Other.md')).toBeUndefined()
  })

  it('removes the file and the callout of a page left with no ink, and keeps the note', async () => {
    await store.write(3, page())
    await store.write(3, { ...page(), strokes: [] })
    expect(await text(INK)).toBeNull()
    const note = (await text(NOTE)) ?? ''
    expect(note).not.toContain('[!ink]')
    expect(note).toContain('type: book-highlights')
    expect(await store.changed(INK)).toBeUndefined()
  })
})

describe('a PDF renamed', () => {
  it('takes its ink folder along and gives each page the new name', async () => {
    const calls: [string, string][] = []
    const folder = new TFolder()
    folder.path = 'Papers/Paper ink'
    const file = new TFile()
    file.path = INK
    file.name = 'Paper page 4.svg'
    folder.children = [file]
    const moved = new TFolder()
    moved.path = 'Books/Essay ink'
    moved.children = [file]
    const files: Record<string, unknown> = { 'Papers/Paper ink': folder }
    const fake = {
      vault: { getAbstractFileByPath: (p: string) => files[p] ?? null },
      fileManager: {
        renameFile: async (f: { path: string }, to: string) => {
          calls.push([f.path, to])
          if (f === folder) files[to] = moved
          f.path = to
        },
      },
    }
    await moveInk(fake as unknown as App, 'Papers/Paper.pdf', 'Books/Essay.pdf')
    expect(calls).toEqual([
      ['Papers/Paper ink', 'Books/Essay ink'],
      [INK, 'Books/Essay ink/Essay page 4.svg'],
    ])
  })
})
