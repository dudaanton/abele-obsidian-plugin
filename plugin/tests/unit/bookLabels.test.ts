/**
 * The chapter an agent's highlight is labelled with (`labelAt` in `src/reader/bookRanges.ts`),
 * for places the contents does not name: a part with no entry of its own (notes, a bibliography),
 * words before a part's first entry, and a book with no contents at all.
 */
import { describe, it, expect } from 'vitest'
import { pageOf } from '../helpers/pageDocument'
import { labelAt } from '@/reader/bookRanges'
import type { LoadedBook } from '@/reader/bookText'

const PAGE = `<p id="lead">Words before the section.</p>
<h2 id="s2">Section two</h2>
<p id="after">Words after it.</p>`

function bookWith(toc: LoadedBook['toc']): LoadedBook {
  return {
    pdf: false,
    title: 'Джедайские техники',
    book: { sections: [{}, {}, {}, {}] },
    sections: [0, 1, 2, 3].map((index) => ({
      index,
      label: toc.find((t) => t.index === index)?.label ?? '',
      size: 100,
    })),
    toc,
  } as unknown as LoadedBook
}

const entry = (label: string, index: number, href: string) => ({
  label,
  index,
  depth: 0,
  cfi: null,
  href,
})

function rangeIn(doc: Document, id: string): Range {
  const r = doc.createRange()
  r.selectNodeContents(doc.getElementById(id)!)
  return r
}

describe('the chapter an agent labels a place with', () => {
  it('is the last chapter before it when its part has no entry of its own', async () => {
    const loaded = bookWith([
      entry('1. Start', 0, 'a.xhtml'),
      entry('7.18. Нетерпимость', 1, 'b.xhtml'),
      entry('7.19. Last', 1, 'b.xhtml#s2'),
    ])
    const doc = pageOf(PAGE)
    // Part 3 (index 2) and part 4 are in no entry: notes, a bibliography.
    expect(await labelAt(loaded, 2, doc, rangeIn(doc, 'lead'))).toBe('7.19. Last')
    expect(await labelAt(loaded, 3, doc, rangeIn(doc, 'lead'))).toBe('7.19. Last')
  })

  it('is the chapter before the part for words ahead of the part’s first entry', async () => {
    const loaded = bookWith([entry('1. Start', 0, 'a.xhtml'), entry('2. Next', 1, 'b.xhtml#s2')])
    const doc = pageOf(PAGE)
    expect(await labelAt(loaded, 1, doc, rangeIn(doc, 'lead'))).toBe('1. Start')
    expect(await labelAt(loaded, 1, doc, rangeIn(doc, 'after'))).toBe('2. Next')
  })

  it('is the book’s title where nothing in the contents comes before it', async () => {
    const doc = pageOf(PAGE)
    expect(await labelAt(bookWith([]), 2, doc, rangeIn(doc, 'lead'))).toBe('Джедайские техники')
    const late = bookWith([entry('2. Next', 1, 'b.xhtml#s2')])
    expect(await labelAt(late, 0, doc, rangeIn(doc, 'lead'))).toBe('Джедайские техники')
    expect(await labelAt(late, 1, doc, rangeIn(doc, 'lead'))).toBe('Джедайские техники')
  })
})
