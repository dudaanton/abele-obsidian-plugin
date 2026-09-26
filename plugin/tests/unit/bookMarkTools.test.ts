/**
 * The book tools that mark a book (`src/ai/tools/BookMarkTools.ts`) and the search's parts and
 * pages (`src/ai/tools/BookTools.ts`), against a small vault and a book whose chapters are pages
 * written inline. The real EPUB and PDF, and the open reader drawing what an agent marked, are the
 * e2e tier's (`tests/e2e/bookAgentWrite.e2e.test.ts`).
 */
import { pageOf } from '../helpers/pageDocument'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { useVault } from '../helpers/testEnv'
import type { LoadedBook } from '@/reader/bookText'
import { partsFrom } from '@/ai/tools/BookTools'
import { snippetOf } from '@/ai/tools/bookToolKit'
import {
  createBookHighlightEditTool,
  createBookHighlightRemoveTool,
  createBookHighlightTool,
  createBookHighlightsTool,
} from '@/ai/tools/BookMarkTools'
import { migrateAgents } from '@/ai/agents/migration'
import { createAgent } from '@/ai/agents/types'
import { BOOK_TOOL_MODES, DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'

const books = new Map<string, LoadedBook>()
vi.mock('@/reader/bookText', async (original) => ({
  ...(await original<typeof import('@/reader/bookText')>()),
  loadBookText: async (_app: unknown, file: TFile) => books.get(file.path),
}))

/** Chapter one: a heading, a section heading further on, and words said twice. */
const CHAPTER_ONE = `<h1 id="c1">Chapter 1</h1>
<p>A long opening sentence that tells the two places apart. Plain text of the chapter.</p>
<h2 id="c1-s2">Chapter 1, part two</h2>
<p>Fear is the <em>mind</em>-killer.</p>
<p>Another opening, nothing like the first. Plain text of the chapter.</p>`

const page = (body: string): Document => pageOf(body, '<title>c1</title>')

let app: ReturnType<typeof useVault>

beforeEach(() => {
  app = useVault([
    { path: 'Books/Dune.epub', content: '' },
    { path: 'Books/Other.md', content: '' },
  ])
  // The link helpers the reader writes links with; the fake vault leaves them out.
  const a = app as unknown as {
    fileManager: Record<string, unknown>
    metadataCache: Record<string, unknown>
  }
  a.fileManager.generateMarkdownLink = (f: TFile, _from: string, sub = '', alias?: string) =>
    `[[${f.path}${sub}${alias ? `|${alias}` : ''}]]`
  a.metadataCache.fileToLinktext = (f: TFile) => f.path
  const scope = ScopeResolver.getInstance()
  scope.clear()
  scope.setFullVaultAccess(false)
  scope.addFolder('Books')
  const file = app.vault.getAbstractFileByPath('Books/Dune.epub') as TFile
  books.set(file.path, {
    file,
    pdf: false,
    title: 'Dune',
    author: 'Frank Herbert',
    book: {
      metadata: { identifier: 'urn:dune', title: 'Dune' },
      sections: [
        { id: 0, load: () => '', size: 300, cfi: '/6/2', createDocument: () => page(CHAPTER_ONE) },
        // No page to read: happy-dom's ranges live in one document, which a second page would
        // replace under the first one's finds.
        { id: 1, load: () => '', size: 100, cfi: '/6/4' },
      ],
    },
    sections: [
      { index: 0, label: 'Chapter 1', size: 300 },
      { index: 1, label: 'Chapter 2', size: 100 },
    ],
    toc: [
      { label: 'Chapter 1', index: 0, depth: 0, cfi: null, href: 'c1.xhtml' },
      { label: 'Chapter 1, part two', index: 0, depth: 1, cfi: null, href: 'c1.xhtml#c1-s2' },
      { label: 'Chapter 2', index: 1, depth: 0, cfi: null, href: 'c2.xhtml' },
    ],
    destroy: () => {},
  } as unknown as LoadedBook)
})

type Tool = { execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }

const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join('')
const call = async (tool: Tool, params: Record<string, unknown>) =>
  text((await tool.execute('t', params)) as { content: { text: string }[] })
const failure = async (tool: Tool, params: Record<string, unknown>) => {
  try {
    await tool.execute('t', params)
    return 'no error'
  } catch (e) {
    return (e as Error).message
  }
}
const note = () => {
  const file = app.vault.getAbstractFileByPath('Books/Dune highlights.md') as TFile | null
  return file ? app.vault.cachedRead(file) : Promise.resolve('')
}

describe('an agent highlighting words', () => {
  it('writes them where the reader would, with the chapter they are in, a colour and a note', async () => {
    const answer = await call(createBookHighlightTool(), {
      book: 'Books/Dune.epub',
      text: 'the mind-killer',
      color: 'green',
      note: 'The litany.',
    })
    expect(answer).toMatch(/^Highlighted in green: \[\[Books\/Dune\.epub#cfi=/)
    expect(answer).toContain('Kept in Books/Dune highlights.md.')
    const md = await note()
    expect(md).toContain('type: book-highlights')
    expect(md).toMatch(
      /> \[!quote\|green\] \[\[Books\/Dune\.epub#cfi=[^|]+\|Chapter 1, part two\]\]/
    )
    expect(md).toContain('> the mind-killer\n>\n> The litany.')
  })

  it('refuses words found twice, listing where, and takes the one nearest a place given', async () => {
    const refused = await failure(createBookHighlightTool(), {
      book: 'Books/Dune.epub',
      text: 'plain text of the chapter',
    })
    expect(refused).toMatch(/^These words are in 2 places in the book/)
    const links = refused.match(/\[\[[^\]]+\]\]/g) ?? []
    expect(links).toHaveLength(2)
    expect(links[1]).toContain('Chapter 1, part two')
    // Each place shows the words around the find, not the opening of its paragraph.
    expect(refused).toContain('tells the two places apart. **Plain text of the chapter**.')
    expect(refused).toContain('nothing like the first. **Plain text of the chapter**.')
    expect(refused).not.toContain('the same words around them')
    // The second place, as a search would give it, chooses the second.
    const answer = await call(createBookHighlightTool(), {
      book: links[1],
      text: 'Plain text of the chapter.',
    })
    expect(answer).toContain('Chapter 1, part two')
    expect(await note()).toMatch(/\|Chapter 1, part two\]\]\n> Plain text of the chapter\./)
  })

  it('says so when the places read the same, so the agent chooses by link', async () => {
    const book = books.get('Books/Dune.epub') as unknown as {
      book: { sections: { createDocument?: () => Document }[] }
    }
    book.book.sections[0].createDocument = () =>
      page('<h1 id="c1">Chapter 1</h1><p>Same words here.</p><p>Same words here.</p>')
    const refused = await failure(createBookHighlightTool(), {
      book: 'Books/Dune.epub',
      text: 'same words',
    })
    expect(refused).toContain('**Same words** here.')
    expect(refused).toContain('the same words around them')
  })

  it('says so when the words are not in the book, or too few to find', async () => {
    const tool = createBookHighlightTool()
    expect(await failure(tool, { book: 'Books/Dune.epub', text: 'the mind killer!' })).toMatch(
      /not in the book/
    )
    expect(
      await failure(tool, { book: 'Books/Dune.epub', text: 'the mind-killer', part: 2 })
    ).toMatch(/not in part 2/)
    expect(await failure(tool, { book: 'Books/Dune.epub', text: ' a ' })).toMatch(/at least a few/)
    expect(
      await failure(tool, { book: 'Books/Dune.epub', text: 'the mind-killer', color: 'red' })
    ).toMatch(/The colours are/)
    expect(await note()).toBe('')
  })

  it('changes the highlight it made when the same words are highlighted again', async () => {
    const tool = createBookHighlightTool()
    await call(tool, { book: 'Books/Dune.epub', text: 'the mind-killer', note: 'First.' })
    const again = await call(tool, {
      book: 'Books/Dune.epub',
      text: 'The Mind-Killer',
      color: 'blue',
    })
    expect(again).toMatch(/^Changed the highlight in blue/)
    const md = await note()
    expect(md.match(/\[!quote/g)).toHaveLength(1)
    expect(md).toContain('[!quote|blue]')
    expect(md).toContain('> First.')
  })
})

describe('an agent going over the highlights', () => {
  it('lists them by link, changes their colour and note, and removes them', async () => {
    await call(createBookHighlightTool(), { book: 'Books/Dune.epub', text: 'the mind-killer' })
    const list = await call(createBookHighlightsTool(), { book: 'Books/Dune.epub' })
    expect(list).toMatch(/^1 highlight in Dune, kept in Books\/Dune highlights\.md:/)
    expect(list).toContain('   > the mind-killer')
    const link = /\[\[[^\]]+\]\]/.exec(list)?.[0] ?? ''
    expect(link).toContain('#cfi=')

    const edited = await call(createBookHighlightEditTool(), {
      highlight: link,
      color: 'pink',
      note: 'Noted.',
    })
    expect(edited).toMatch(/^Changed: pink/)
    expect(await note()).toContain('[!quote|pink]')
    expect(await note()).toContain('> Noted.')
    await call(createBookHighlightEditTool(), { highlight: link, note: '' })
    expect(await note()).not.toContain('Noted.')

    const removed = await call(createBookHighlightRemoveTool(), { highlight: link })
    expect(removed).toMatch(/^Removed the pink highlight/)
    expect(await note()).not.toContain('[!quote')
    expect(await failure(createBookHighlightRemoveTool(), { highlight: link })).toMatch(
      /no highlight at that place/
    )
  })

  it('leaves a highlight carrying a discussion to the person', async () => {
    await app.vault.create(
      'Books/Dune highlights.md',
      '---\ntype: book-highlights\nbook: "[[Books/Dune.epub]]"\n---\n\n> [!quote|yellow] [[Books/Dune.epub#cfi=/6/2!/4/8,/1:0,/1:4|Chapter 1]] · [[AI/Comments/k7d2ph.abchat|Discussion]]\n> Fear\n'
    )
    expect(
      await failure(createBookHighlightRemoveTool(), {
        highlight: '[[Books/Dune.epub#cfi=/6/2!/4/8,/1:0,/1:4]]',
      })
    ).toMatch(/carries a discussion/)
  })
})

describe('a search of some parts, a page at a time', () => {
  it('takes parts as a person writes them, and refuses ones the book has not', () => {
    expect([...(partsFrom('3', 5) ?? [])]).toEqual([2])
    expect([...(partsFrom('1, 3-4', 5) ?? [])]).toEqual([0, 2, 3])
    expect(partsFrom('', 5)).toBeUndefined()
    expect(() => partsFrom('6', 5)).toThrow(/parts 1 to 5/)
    expect(() => partsFrom('two', 5)).toThrow(/not a part number/)
  })

  it('cuts the words around a find to about two hundred characters, on one line', () => {
    const long = 'word '.repeat(60)
    const s = snippetOf(long, 'found\nit', long)
    expect(s).toContain('**found it**')
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
    expect(s.length).toBeLessThan(215)
    expect(snippetOf('short ', 'x', ' tail')).toBe('short **x** tail')
  })
})

describe('the book tools’ modes', () => {
  it('read on their own and ask before marking, for new agents and ones that had no opinion', () => {
    expect(createAgent().toolModes.book_read).toBe('auto')
    expect(createAgent().toolModes.book_highlight).toBe('ask')
    expect(BOOK_TOOL_MODES.book_bookmark).toBe('ask')
    const ai = structuredClone(DEFAULT_AI_SETTINGS) as AiSettings
    const old = createAgent({ toolModes: { book_read: 'off' } })
    ai.agents = [old]
    migrateAgents(ai)
    const after = ai.agents.find((a) => a.id === old.id)!
    expect(after.toolModes.book_read).toBe('off')
    expect(after.toolModes.book_highlights).toBe('auto')
    expect(after.toolModes.book_highlight_remove).toBe('ask')
  })
})
