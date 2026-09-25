/**
 * A book's highlights written where the settings say, in a small vault of its own
 * (`src/reader/companion.ts`).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { load as yamlLoad } from 'js-yaml'
import { TFile, TFolder, type App } from 'obsidian'
import { deleteHighlight, notesOf, readHighlights, saveHighlight } from '@/reader/companion'
import { DEFAULT_NOTES_PATH, type BookNotesTarget } from '@/reader/settings'
import type { Highlight } from '@/reader/highlights'

/** Just the vault the highlights touch: files by path, their text, their properties, links. */
function tinyVault(initial: Record<string, string>) {
  const files = new Map<string, { file: TFile; text: string }>()
  const make = (path: string, text: string) => {
    const file = new TFile()
    file.path = path
    file.name = path.split('/').pop() ?? path
    file.extension = file.name.includes('.') ? (file.name.split('.').pop() ?? '') : ''
    file.basename = file.name.replace(/\.[^.]+$/, '')
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const parent = new TFolder()
    parent.path = dir || '/'
    file.parent = parent
    files.set(path, { file, text })
    return file
  }
  for (const [path, text] of Object.entries(initial)) make(path, text)
  const folders = new Set<string>()
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) =>
        files.get(p)?.file ?? (folders.has(p) ? new TFolder() : null),
      getMarkdownFiles: () =>
        [...files.values()].map((f) => f.file).filter((f) => f.extension === 'md'),
      cachedRead: async (f: TFile) => files.get(f.path)?.text ?? '',
      read: async (f: TFile) => files.get(f.path)?.text ?? '',
      create: async (p: string, text: string) => {
        if (files.has(p)) throw new Error('exists')
        const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
        if (dir && !folders.has(dir)) throw new Error(`no folder ${dir}`)
        return make(p, text)
      },
      createFolder: async (p: string) => void folders.add(p),
      process: async (f: TFile, fn: (s: string) => string) => {
        const entry = files.get(f.path)!
        entry.text = fn(entry.text)
        return entry.text
      },
    },
    metadataCache: {
      getFileCache: (f: TFile) => {
        const text = files.get(f.path)?.text ?? ''
        const m = /^---\n([\s\S]*?)\n---/.exec(text)
        return m ? { frontmatter: yamlLoad(m[1]) as Record<string, unknown> } : {}
      },
      getFirstLinkpathDest: (linkpath: string) =>
        files.get(linkpath)?.file ??
        [...files.values()].find((f) => f.file.basename === linkpath || f.file.name === linkpath)
          ?.file ??
        null,
      fileToLinktext: (f: TFile) => f.path,
    },
    fileManager: {
      generateMarkdownLink: (f: TFile, _from: string, subpath = '', alias?: string) =>
        `[[${f.path}${subpath}${alias ? `|${alias}` : ''}]]`,
    },
  }
  return {
    app: app as unknown as App,
    text: (p: string) => files.get(p)?.text,
    file: (p: string) => files.get(p)!.file,
    folders,
  }
}

const A = 'epubcfi(/6/8!/4/2,/1:0,/1:10)'
const B = 'epubcfi(/6/8!/4/6,/1:0,/1:10)'
const hl = (cfi: string, over: Partial<Highlight> = {}): Highlight => ({
  cfi,
  color: 'yellow',
  text: 'Fear is the mind-killer.',
  comment: '',
  label: 'Chapter 3',
  ...over,
})
const own: BookNotesTarget = { to: 'book', path: DEFAULT_NOTES_PATH, template: '', alsoIn: [] }
const shared = (over: Partial<BookNotesTarget> = {}): BookNotesTarget => ({
  to: 'note',
  path: 'Reading/Notes.md',
  template: '',
  alsoIn: [],
  ...over,
})
const place = (target: BookNotesTarget, title = 'Dune') => ({
  title,
  author: 'Frank Herbert',
  target,
})

let v: ReturnType<typeof tinyVault>
beforeEach(() => {
  v = tinyVault({
    'Books/Dune.epub': '',
    'Books/Emma.epub': '',
    'Templates/Book.md':
      '---\ntags: [reading]\n---\n# {{ title }}\n\n{{#body}}\n## {{ chapter }}\n{{ highlight }}\n{{/body}}\n',
  })
})

describe("a book's highlights, where the settings send them", () => {
  it('go to a note of their own beside the book, as they always did', async () => {
    const dune = v.file('Books/Dune.epub')
    await saveHighlight(v.app, dune, place(own), hl(A))
    expect(v.text('Books/Dune highlights.md')).toContain('type: book-highlights')
    expect(await readHighlights(v.app, dune, place(own))).toEqual([hl(A)])
  })

  it('go to one note for every book, made in its folder, each book seeing only its own', async () => {
    const dune = v.file('Books/Dune.epub')
    const emma = v.file('Books/Emma.epub')
    await saveHighlight(v.app, dune, place(shared()), hl(A))
    await saveHighlight(v.app, emma, place(shared(), 'Emma'), hl(A, { text: 'Emma words' }))
    const md = v.text('Reading/Notes.md')!
    // Each says whose it is, since the note holds several books.
    expect(md).toContain('|Dune · Chapter 3]]')
    expect(md).toContain('|Emma · Chapter 3]]')
    expect(md.indexOf('Fear is')).toBeLessThan(md.indexOf('Emma words'))
    expect((await readHighlights(v.app, dune, place(shared()))).map((h) => h.text)).toEqual([
      'Fear is the mind-killer.',
    ])
    expect((await readHighlights(v.app, emma, place(shared(), 'Emma'))).map((h) => h.text)).toEqual(
      ['Emma words']
    )
    expect(v.text('Books/Dune highlights.md')).toBeUndefined()
  })

  it('are made from the template the first time, and only its body is added after', async () => {
    const dune = v.file('Books/Dune.epub')
    const where = place(shared({ template: 'Templates/Book.md' }))
    await saveHighlight(v.app, dune, where, hl(A))
    await saveHighlight(v.app, dune, where, hl(B, { label: 'Chapter 4', text: 'Second' }))
    const md = v.text('Reading/Notes.md')!
    expect(md.match(/# Dune/g)).toHaveLength(1)
    expect(md.match(/tags: \[reading\]/g)).toHaveLength(1)
    expect(md).toContain('## Chapter 3\n> [!quote|yellow]')
    expect(md).toContain('## Chapter 4\n> [!quote|yellow]')
    // The template names the book itself, so the links keep the chapter alone.
    expect(md).toContain('|Chapter 4]]')
    expect(md.indexOf('Fear is')).toBeLessThan(md.indexOf('Second'))
    await deleteHighlight(v.app, dune, where, B)
    expect(v.text('Reading/Notes.md')).not.toContain('## Chapter 4')
  })

  it("keep a book's own note made from a template findable", async () => {
    const dune = v.file('Books/Dune.epub')
    await saveHighlight(v.app, dune, place({ ...own, template: 'Templates/Book.md' }), hl(A))
    const md = v.text('Books/Dune highlights.md')!
    expect(md).toContain('tags: [reading]')
    expect(md).toContain('type: book-highlights')
    expect(md).toContain('book: "[[Books/Dune.epub]]"')
  })

  it('stay where they were when the choice changes, still shown and changed there', async () => {
    const dune = v.file('Books/Dune.epub')
    await saveHighlight(v.app, dune, place(own), hl(A))
    const now = place(shared())
    await saveHighlight(v.app, dune, now, hl(B, { text: 'New one' }))
    expect((await readHighlights(v.app, dune, now)).map((h) => h.cfi).sort()).toEqual([A, B].sort())
    expect(notesOf(v.app, dune, now).map((f) => f.path)).toEqual([
      'Reading/Notes.md',
      'Books/Dune highlights.md',
    ])
    // Recoloured where it is, not copied into the new note.
    await saveHighlight(v.app, dune, now, hl(A, { color: 'pink' }))
    expect(v.text('Books/Dune highlights.md')).toContain('[!quote|pink]')
    expect(v.text('Reading/Notes.md')).not.toContain('Fear is')
    await deleteHighlight(v.app, dune, now, A)
    expect(await readHighlights(v.app, dune, now)).toHaveLength(1)
  })

  it('are still shown from the note for every book after the book chose a note of its own', async () => {
    const dune = v.file('Books/Dune.epub')
    await saveHighlight(v.app, dune, place(shared()), hl(A))
    const now = place({ ...own, alsoIn: ['Reading/Notes.md'] })
    await saveHighlight(v.app, dune, now, hl(B, { text: 'Second' }))
    expect(v.text('Books/Dune highlights.md')).toContain('Second')
    expect((await readHighlights(v.app, dune, now)).map((h) => h.cfi).sort()).toEqual([A, B].sort())
    await deleteHighlight(v.app, dune, now, A)
    expect(v.text('Reading/Notes.md')).not.toContain('Fear is')
  })

  it('are written without a template that is not there', async () => {
    const dune = v.file('Books/Dune.epub')
    await saveHighlight(v.app, dune, place(shared({ template: 'Nope.md' })), hl(A))
    expect(v.text('Reading/Notes.md')).toContain('> Fear is the mind-killer.')
  })
})
