/**
 * Links to places in a book (`src/reader/bookLinks.ts`) and the note a book's highlights are kept
 * in (`src/reader/highlights.ts`).
 */
import { describe, it, expect } from 'vitest'
import { encodeCfi, parsePlaceSubpath, placeSubpath, quoteWithLink } from '@/reader/bookLinks'
import {
  highlightBlock,
  highlightLines,
  newHighlightsNote,
  parseHighlights,
  removeHighlight,
  upsertHighlight,
  type Highlight,
} from '@/reader/highlights'
import { compare } from '@/vendor/foliate-js/epubcfi.js'

describe('a link to a place in a book', () => {
  it('carries the CFI without its wrapper, brackets and all made safe for a link', () => {
    const cfi = 'epubcfi(/6/8[chap03]!/4/2[p1],/1:0,/1:22)'
    const sub = placeSubpath({ cfi })
    expect(sub).toBe('#cfi=/6/8%5Bchap03%5D!/4/2%5Bp1%5D,/1:0,/1:22')
    expect(sub.slice(1)).not.toMatch(/[[\]|()#\s]/)
    expect(parsePlaceSubpath(sub)).toEqual({ cfi })
  })

  it('reads a subpath as written by hand, or with Obsidian having decoded it', () => {
    expect(parsePlaceSubpath('#cfi=/6/4!/4/2,/1:0,/1:5')).toEqual({
      cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
    })
    expect(parsePlaceSubpath('cfi=/6/4[x]!/4')).toEqual({ cfi: 'epubcfi(/6/4[x]!/4)' })
  })

  it("is a page of a PDF, the way Obsidian's own viewer writes it too", () => {
    expect(placeSubpath({ page: 4 })).toBe('#page=4')
    expect(parsePlaceSubpath('#page=4')).toEqual({ page: 4 })
    expect(parsePlaceSubpath('#page=3&selection=4,0,4,10')).toEqual({ page: 3 })
  })

  it('is not a heading, or anything else', () => {
    expect(parsePlaceSubpath('#Chapter one')).toBeNull()
    expect(parsePlaceSubpath('#cfi=nonsense')).toBeNull()
    expect(parsePlaceSubpath('')).toBeNull()
    expect(parsePlaceSubpath(undefined)).toBeNull()
  })

  it('encodes a percent sign so it reads back the same', () => {
    expect(encodeCfi('epubcfi(/6/2[a%b])')).toBe('/6/2%5Ba%25b%5D')
    expect(parsePlaceSubpath(`#cfi=${encodeCfi('epubcfi(/6/2[a%b])')}`)).toEqual({
      cfi: 'epubcfi(/6/2[a%b])',
    })
  })

  it('goes under a quote of the words it points at', () => {
    expect(quoteWithLink('Fear is\n\n\nthe mind-killer.', '[[Dune.epub#cfi=/6/8!|Ch 3]]')).toBe(
      '> Fear is\n>\n> the mind-killer.\n> — [[Dune.epub#cfi=/6/8!|Ch 3]]'
    )
  })
})

const LINK = (cfi: string, label = 'Chapter 3') =>
  `[[Books/Dune.epub${placeSubpath({ cfi })}|${label}]]`
const hl = (cfi: string, over: Partial<Highlight> = {}): Highlight => ({
  cfi,
  color: 'yellow',
  text: 'Fear is the mind-killer.',
  comment: '',
  label: 'Chapter 3',
  ...over,
})
const A = 'epubcfi(/6/8!/4/2,/1:0,/1:10)'
const B = 'epubcfi(/6/8!/4/6,/1:0,/1:10)'
const C = 'epubcfi(/6/12!/4/2,/1:0,/1:10)'

describe('the highlights note', () => {
  const note = newHighlightsNote('[[Books/Dune.epub]]', 'Dune')

  it('starts with what it is and whose it is', () => {
    expect(note).toContain('type: book-highlights')
    expect(note).toContain('book: "[[Books/Dune.epub]]"')
  })

  it('keeps a highlight as a quote callout: colour, link, text and comment', () => {
    const block = highlightBlock(hl(A, { color: 'green', comment: 'Line one\nline two' }), LINK(A))
    expect(block).toBe(
      [
        `> [!quote|green] ${LINK(A)}`,
        '> Fear is the mind-killer.',
        '>',
        '> Line one',
        '> line two',
      ].join('\n')
    )
    expect(parseHighlights(block)).toEqual([
      hl(A, { color: 'green', comment: 'Line one\nline two' }),
    ])
  })

  it('puts highlights in the order of the book, whatever order they are made in', () => {
    let md = note
    for (const cfi of [C, A, B]) md = upsertHighlight(md, hl(cfi), LINK(cfi), compare)
    expect(parseHighlights(md).map((h) => h.cfi)).toEqual([A, B, C])
  })

  it('replaces a highlight at the same place: a new colour, a comment', () => {
    let md = upsertHighlight(note, hl(A), LINK(A), compare)
    md = upsertHighlight(md, hl(A, { color: 'pink', comment: 'Why' }), LINK(A), compare)
    expect(parseHighlights(md)).toEqual([hl(A, { color: 'pink', comment: 'Why' })])
  })

  it("leaves the person's own writing in the note where it is", () => {
    let md = upsertHighlight(note, hl(A), LINK(A), compare)
    md += '\nMy own thoughts on the book.\n'
    md = upsertHighlight(md, hl(B), LINK(B), compare)
    md = removeHighlight(md, A)
    expect(md).toContain('My own thoughts on the book.')
    expect(md).toContain('# Dune')
    expect(parseHighlights(md).map((h) => h.cfi)).toEqual([B])
  })

  it('reads a callout written by hand, a markdown link, no colour, and ignores other callouts', () => {
    const md = [
      '> [!note] Just a note',
      '> not a highlight',
      '',
      `> [!quote] [Part two](Books/Dune.epub${placeSubpath({ cfi: B })})`,
      '> Words',
      '',
      '> [!quote|blue] [[Some note#Heading]]',
      '> a quote of a note',
    ].join('\n')
    expect(parseHighlights(md)).toEqual([
      hl(B, { color: 'yellow', text: 'Words', label: 'Part two' }),
    ])
  })

  it('finds the lines of a highlight by the place it links to, not by its words', () => {
    let md = note
    for (const cfi of [A, B])
      md = upsertHighlight(md, hl(cfi, { text: 'Same words' }), LINK(cfi), compare)
    md = upsertHighlight(md, hl(B, { text: 'Same words', comment: 'Mine' }), LINK(B), compare)
    const lines = md.split('\n')
    const at = highlightLines(md, B)
    expect(at).not.toBeNull()
    expect(lines[at!.from - 1]).toBe(`> [!quote|yellow] ${LINK(B)}`)
    expect(lines.slice(at!.from - 1, at!.to)).toEqual([
      `> [!quote|yellow] ${LINK(B)}`,
      '> Same words',
      '>',
      '> Mine',
    ])
    expect(highlightLines(md, C)).toBeNull()
  })

  it("finds a highlight in a shared note only among the book's own callouts", () => {
    const md = [
      '# Reading',
      '',
      `> [!quote] [[Books/Other.epub${placeSubpath({ cfi: A })}|Other]]`,
      '> theirs',
      '',
      `> [!quote] [[Books/Dune.epub${placeSubpath({ cfi: A })}|Dune]]`,
      '> ours',
    ].join('\n')
    expect(highlightLines(md, A, (t) => t === 'Books/Dune.epub')).toEqual({ from: 6, to: 7 })
    expect(highlightLines(md, A, (t) => t === 'Books/Missing.epub')).toBeNull()
  })

  it('forgets a highlight that is not there without touching the note', () => {
    const md = upsertHighlight(note, hl(A), LINK(A), compare)
    expect(removeHighlight(md, C)).toBe(md)
  })
})

describe('discussions in the highlights note', () => {
  const note = newHighlightsNote('[[Books/Dune.epub]]', 'Dune')
  const CHAT = '[[AI/Comments/k7d2ph.abchat|Discussion]]'

  it('keeps a discussion on words as a chat callout linking to its chat', () => {
    const h = hl(A, { discussion: 'k7d2ph', plain: true })
    const block = highlightBlock(h, LINK(A), CHAT)
    expect(block).toBe([`> [!chat] ${LINK(A)} · ${CHAT}`, '> Fear is the mind-killer.'].join('\n'))
    expect(parseHighlights(block)).toEqual([hl(A, { discussion: 'k7d2ph', plain: true })])
  })

  it('keeps a highlight that was asked about with its colour, and the chat beside its place', () => {
    const h = hl(A, { color: 'green', comment: 'Mine', discussion: 'k7d2ph' })
    const block = highlightBlock(h, LINK(A), CHAT)
    expect(block.split('\n')[0]).toBe(`> [!quote|green] ${LINK(A)} · ${CHAT}`)
    expect(parseHighlights(block)).toEqual([h])
  })

  it('reads the chat from a markdown link too, and drops it when the discussion goes', () => {
    const md = `> [!chat] [Part two](Books/Dune.epub${placeSubpath({ cfi: B })}) · [talk](AI/Comments/3mq0xa.abchat)\n> Words`
    expect(parseHighlights(md)).toEqual([
      hl(B, { text: 'Words', label: 'Part two', discussion: '3mq0xa', plain: true }),
    ])
    let doc = upsertHighlight(
      note,
      hl(A, { discussion: 'k7d2ph', color: 'blue' }),
      LINK(A),
      compare,
      CHAT
    )
    expect(parseHighlights(doc)[0].discussion).toBe('k7d2ph')
    doc = upsertHighlight(doc, hl(A, { color: 'blue' }), LINK(A), compare)
    expect(parseHighlights(doc)).toEqual([hl(A, { color: 'blue' })])
    expect(doc).not.toContain('abchat')
  })
})
