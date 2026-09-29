/**
 * `vocabulary` in a script's scope (`src/scripting/vocabularyApi.ts`): rules kept in a note's
 * properties, and forms kept with a highlight — the one a book script was run on, made on its
 * words if there is none yet, or one named by its link. Asked twice the same, nothing is written
 * the second time.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import type { LoadedBook } from '@/reader/bookText'
import { scriptVocabulary } from '@/scripting/vocabularyApi'
import type { BookScriptContext } from '@/scripting/bookContext'

const books = new Map<string, LoadedBook>()
vi.mock('@/reader/bookText', async (original) => ({
  ...(await original<typeof import('@/reader/bookText')>()),
  loadBookText: async (_app: unknown, file: TFile) => books.get(file.path),
}))

const CFI = 'epubcfi(/6/2!/4/2,/1:0,/1:4)'
const BOOK: BookScriptContext = {
  text: 'māja',
  link: '[[Books/Novel.epub#cfi=/6/2!/4/2,/1:0,/1:4|Part One]]',
  path: 'Books/Novel.epub',
  title: 'Novel',
  chapter: 'Part One',
  sentence: 'Tā ir māja.',
  cfi: CFI,
  language: 'lv',
}

let app: ReturnType<typeof useVault>
const note = async () => {
  const f = app.vault.getAbstractFileByPath('Books/Novel highlights.md') as TFile | null
  return f ? app.vault.read(f) : ''
}

beforeEach(() => {
  app = useVault([
    { path: 'Books/Novel.epub', content: '' },
    { path: 'Cards/māja.md', content: '**māja** — a house\n' },
  ])
  const a = app as unknown as {
    fileManager: Record<string, unknown>
    metadataCache: Record<string, unknown>
  }
  a.fileManager.generateMarkdownLink = (f: TFile, _from: string, sub = '', alias?: string) =>
    `[[${f.path}${sub}${alias ? `|${alias}` : ''}]]`
  a.metadataCache.fileToLinktext = (f: TFile) => f.path
  const file = app.vault.getAbstractFileByPath('Books/Novel.epub') as TFile
  books.set(file.path, {
    file,
    pdf: false,
    title: 'Novel',
    author: 'A. Writer',
    book: { metadata: { identifier: 'urn:novel', title: 'Novel' }, sections: [] },
    sections: [],
    toc: [],
    destroy: () => {},
  } as unknown as LoadedBook)
})

describe('a note’s rule', () => {
  it('is kept in its properties, read back at once, and switched off', async () => {
    const wrote: string[] = []
    const v = scriptVocabulary({ book: BOOK, wrote: (p) => wrote.push(p) })
    const rule = await v.mark({ note: 'Cards/māja.md', forms: ['māja', 'mājas'] })
    expect(rule).toMatchObject({ forms: ['māja', 'mājas'], language: 'lv', on: true })
    expect(await v.get('Cards/māja.md')).toMatchObject({ forms: ['māja', 'mājas'] })
    await v.mark({ note: 'Cards/māja.md', forms: 'MĀJA' })
    expect(wrote).toEqual(['Cards/māja.md'])
    await v.off('Cards/māja.md')
    expect((await v.get({ note: 'Cards/māja.md' }))?.on).toBe(false)
  })
})

describe('a highlight’s forms', () => {
  it('make the highlight on the words a book script was run on, with its forms, once', async () => {
    const wrote: string[] = []
    const v = scriptVocabulary({ book: BOOK, wrote: (p) => wrote.push(p) })
    const made = await v.mark({ highlight: BOOK, forms: ['māja', 'mājas'], color: 'green' })
    expect(made).toMatchObject({
      book: 'Books/Novel.epub',
      text: 'māja',
      forms: ['māja', 'mājas'],
      note: 'Books/Novel highlights.md',
    })
    expect(made?.highlight).toContain('#cfi=')
    const md = await note()
    expect(md).toContain('> [!quote|green]')
    expect(md).toContain('> forms:: māja, mājas')
    await v.mark({ highlight: BOOK, forms: 'mājas, MĀJA' })
    expect(await note()).toBe(md)
    expect(wrote).toEqual(['Books/Novel highlights.md'])
  })

  it('are added to, replaced, read and taken off by the highlight’s link', async () => {
    const v = scriptVocabulary({ wrote: () => {} })
    const first = await scriptVocabulary({ book: BOOK, wrote: () => {} }).mark({
      highlight: BOOK,
      forms: 'māja',
    })
    const link = first!.highlight
    expect((await v.mark({ highlight: link, forms: ['mājā'] }))?.forms).toEqual(['māja', 'mājā'])
    expect((await v.mark({ highlight: link, forms: 'nams', replace: true }))?.forms).toEqual([
      'nams',
    ])
    expect(await v.get({ highlight: link })).toMatchObject({ text: 'māja', forms: ['nams'] })
    await v.off({ highlight: link })
    expect(await note()).not.toContain('forms::')
    expect(await v.get({ highlight: link })).toMatchObject({ forms: [] })
  })

  it('refuses a link to a place with no highlight, and a highlight named with no book', async () => {
    const v = scriptVocabulary({ wrote: () => {} })
    await expect(v.mark({ highlight: BOOK.link, forms: 'māja' })).rejects.toThrow(
      /no highlight at that place/
    )
    await expect(v.get({ highlight: 'Cards/māja.md' })).rejects.toThrow(/a place in a book/)
    await expect(v.on({ highlight: BOOK.link })).rejects.toThrow(/while it has forms/)
  })
})
