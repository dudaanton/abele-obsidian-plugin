/**
 * Where a book's highlights are written: the choice for every book and for one
 * (`src/reader/settings.ts`), a template's parts (`src/reader/noteTemplate.ts`), and a note many
 * books share (`src/reader/highlights.ts`).
 */
import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import { placeSubpath } from '@/reader/bookLinks'
import {
  DEFAULT_NOTES_PATH,
  notesTargetFor,
  readerSettingsFrom,
  renamedBookNotes,
  withBookNotes,
} from '@/reader/settings'
import {
  entryFrame,
  entryFrom,
  newNoteFrom,
  parseNoteTemplate,
  renderTemplate,
} from '@/reader/noteTemplate'
import {
  highlightBlock,
  parseHighlights,
  removeHighlight,
  upsertHighlight,
  withCompanionProps,
  type Highlight,
} from '@/reader/highlights'
import { compare } from '@/vendor/foliate-js/epubcfi.js'

const A = 'epubcfi(/6/8!/4/2,/1:0,/1:10)'
const B = 'epubcfi(/6/8!/4/6,/1:0,/1:10)'
const LINK = (cfi: string, book = 'Books/Dune.epub', label = 'Chapter 3') =>
  `[[${book}${placeSubpath({ cfi })}|${label}]]`
const hl = (cfi: string, over: Partial<Highlight> = {}): Highlight => ({
  cfi,
  color: 'yellow',
  text: 'Fear is the mind-killer.',
  comment: '',
  label: 'Chapter 3',
  ...over,
})
const dune = (target: string) => target === 'Books/Dune.epub'
const emma = (target: string) => target === 'Books/Emma.epub'

describe('where highlights go', () => {
  it('is a note of its own beside each book, unless said otherwise', () => {
    const s = readerSettingsFrom({})
    expect(s).toMatchObject({ notesTo: 'book', notesPath: DEFAULT_NOTES_PATH, notesTemplate: '' })
    expect(s.bookNotes).toEqual({})
    expect(notesTargetFor(s, 'id:dune')).toEqual({
      to: 'book',
      path: DEFAULT_NOTES_PATH,
      template: '',
      // Still read: a book may have written there before its choice changed.
      alsoIn: [DEFAULT_NOTES_PATH],
    })
  })

  it('is the choice for every book, and a book of its own choice keeps it', () => {
    const s = readerSettingsFrom({
      notesTo: 'note',
      notesPath: 'Reading/All notes',
      notesTemplate: 'Templates/Book',
      bookNotes: { 'id:emma': { notesTo: 'note', notesPath: 'Emma notes.md' } },
    })
    expect(notesTargetFor(s, 'id:dune')).toEqual({
      to: 'note',
      path: 'Reading/All notes.md',
      template: 'Templates/Book.md',
      alsoIn: [],
    })
    expect(notesTargetFor(s, 'id:emma')).toEqual({
      to: 'note',
      path: 'Emma notes.md',
      template: 'Templates/Book.md',
      alsoIn: ['Reading/All notes.md'],
    })
  })

  it('lets one book go to a note of its own while the others share one', () => {
    const s = readerSettingsFrom({
      notesTo: 'note',
      bookNotes: { 'id:dune': { notesTo: 'book', notesTemplate: 'T.md' } },
    })
    expect(notesTargetFor(s, 'id:dune')).toMatchObject({ to: 'book', template: 'T.md' })
  })

  it('refuses a path that is hidden or empty and falls back', () => {
    const s = readerSettingsFrom({ notesTo: 'note', notesPath: '.hidden/x.md' })
    expect(notesTargetFor(s, 'k').path).toBe(DEFAULT_NOTES_PATH)
    const t = readerSettingsFrom({
      notesTo: 'note',
      notesPath: 'Shared.md',
      bookNotes: { k: { notesTo: 'note', notesPath: '  ' } },
    })
    expect(notesTargetFor(t, 'k').path).toBe('Shared.md')
  })

  it('drops what is not a choice when read from disk', () => {
    const s = readerSettingsFrom({
      notesTo: 'elsewhere' as never,
      bookNotes: {
        a: { notesTo: 'sideways' as never, notesPath: 5 as never },
        b: 'nonsense' as never,
        c: { notesPath: 'C.md' },
      },
    })
    expect(s.notesTo).toBe('book')
    expect(s.bookNotes).toEqual({ c: { notesPath: 'C.md' } })
  })

  it('forgets a book whose choice is all "as in settings"', () => {
    const s = readerSettingsFrom({ bookNotes: { a: { notesTo: 'note' } } })
    expect(withBookNotes(s.bookNotes, 'a', {})).toEqual({})
    expect(withBookNotes(s.bookNotes, 'b', { notesPath: 'B.md' })).toEqual({
      a: { notesTo: 'note' },
      b: { notesPath: 'B.md' },
    })
  })

  it('follows a book kept by its path when the file is renamed', () => {
    const map = { 'path:Books/a.epub': { notesTo: 'note' as const }, 'id:x': {} }
    expect(renamedBookNotes(map, 'Books/a.epub', 'Read/a.epub')).toEqual({
      'path:Read/a.epub': { notesTo: 'note' },
      'id:x': {},
    })
    expect(renamedBookNotes(map, 'Books/b.epub', 'Read/b.epub')).toBeNull()
  })
})

const TEMPLATE = [
  '---',
  'tags: [reading]',
  'book: "{{ book }}"',
  '---',
  '# {{ title }} — {{ author }}',
  '',
  '{{#body}}',
  '## {{ chapter }} · {{ date }}',
  '{{ highlight }}',
  '{{/body}}',
  '',
  'The end of {{ title }}.',
].join('\n')

const vars = (over: Record<string, string> = {}) => ({
  title: 'Dune',
  author: 'Frank Herbert',
  book: '[[Books/Dune.epub]]',
  chapter: 'Chapter 3',
  color: 'yellow',
  link: LINK(A),
  highlight: highlightBlock(hl(A), LINK(A)),
  ...over,
})
const today = dayjs().format('YYYY-MM-DD')

describe('a notes template', () => {
  it('is split into what is written once and the body written for each highlight', () => {
    const t = parseNoteTemplate(TEMPLATE)
    expect(t.head).toContain('# {{ title }}')
    expect(t.body).toBe('## {{ chapter }} · {{ date }}\n{{ highlight }}\n')
    expect(t.tail).toContain('The end of')
    expect(parseNoteTemplate('# {{ title }}').body).toBeNull()
    // Spaces inside the marks are fine, as elsewhere in the plugin's templates.
    expect(parseNoteTemplate('a\n{{ #body }}\nX\n{{ /body }}\nb').body).toBe('X\n')
  })

  it('fills in what it knows, dates the way other templates do, and leaves the rest alone', () => {
    const out = renderTemplate(
      "{{ title }} {{ date }} {{ date.format('YYYY') }} {{ mood }}",
      vars()
    )
    expect(out).toBe(`Dune ${today} ${dayjs().format('YYYY')} {{ mood }}`)
  })

  it('never reads the words of a highlight as a template', () => {
    const block = highlightBlock(hl(A, { text: 'Say {{ title }} twice' }), LINK(A))
    const out = renderTemplate('{{ highlight }}', vars({ highlight: block }))
    expect(out).toContain('Say {{ title }} twice')
  })

  it('makes the note whole the first time, the highlight where the body is', async () => {
    const note = newNoteFrom(parseNoteTemplate(TEMPLATE), vars())
    expect(note).toContain('book: "[[Books/Dune.epub]]"')
    expect(note).toContain('# Dune — Frank Herbert')
    expect(note).toContain(`## Chapter 3 · ${today}\n> [!quote|yellow] ${LINK(A)}`)
    expect(note).toContain('The end of Dune.')
    expect(note).not.toContain('{{')
    expect(parseHighlights(note)).toEqual([hl(A)])
  })

  it('adds only the body after that', () => {
    const entry = entryFrom(parseNoteTemplate(TEMPLATE), vars())
    expect(entry).toBe(
      `## Chapter 3 · ${today}\n> [!quote|yellow] ${LINK(A)}\n> Fear is the mind-killer.`
    )
  })

  it('puts the highlight after a body that does not say where', () => {
    const entry = entryFrom(parseNoteTemplate('{{#body}}\n### {{ chapter }}\n{{/body}}'), vars())
    expect(entry.split('\n')[0]).toBe('### Chapter 3')
    expect(parseHighlights(entry)).toEqual([hl(A)])
  })

  it('keeps a blank line after the highlight, or the next line would join its quote', () => {
    const t = parseNoteTemplate('{{#body}}\n{{ highlight }}\nAdded {{ date }}\n{{/body}}')
    const entry = entryFrom(t, vars())
    expect(entry).toContain(`> Fear is the mind-killer.\n\nAdded ${today}`)
    expect(parseHighlights(entry)).toEqual([hl(A)])
  })

  it('without a body, is written once and each highlight goes at the end', () => {
    const t = parseNoteTemplate('# {{ title }}\n')
    expect(newNoteFrom(t, vars())).toBe(`# Dune\n\n${vars().highlight}\n`)
    expect(entryFrom(t, vars())).toBe(vars().highlight)
    expect(entryFrom(null, vars())).toBe(vars().highlight)
  })
})

describe('a note several books share', () => {
  const EMMA = LINK(B, 'Books/Emma.epub')
  const shared = [
    '# Reading',
    '',
    `> [!quote|green] ${LINK(A)}`,
    '> Dune words',
    '',
    `> [!quote|blue] ${LINK(A, 'Books/Emma.epub')}`,
    '> Emma words at the same place',
    '',
  ].join('\n')

  it("shows each book only its own highlights, even at the same place in another's", () => {
    expect(parseHighlights(shared, dune).map((h) => h.text)).toEqual(['Dune words'])
    expect(parseHighlights(shared, emma).map((h) => h.text)).toEqual([
      'Emma words at the same place',
    ])
    // Without a book to ask about, a note is read whole, as a book's own note always was.
    expect(parseHighlights(shared)).toHaveLength(2)
  })

  it("changes a book's highlight and leaves the other book's at the same place", () => {
    const md = upsertHighlight(shared, hl(A, { color: 'pink' }), LINK(A), compare, undefined, {
      ofBook: dune,
    })
    expect(parseHighlights(md, dune)[0].color).toBe('pink')
    expect(parseHighlights(md, emma)[0].color).toBe('blue')
    const gone = removeHighlight(md, A, { ofBook: emma })
    expect(parseHighlights(gone, emma)).toEqual([])
    expect(parseHighlights(gone, dune)).toHaveLength(1)
  })

  it('adds a new one at the end, as the body says, whatever its place in the book', () => {
    const entry = `### Emma\n${highlightBlock(hl(B), EMMA)}`
    const md = upsertHighlight(shared, hl(B), EMMA, compare, undefined, { ofBook: emma, entry })
    expect(md.trimEnd().endsWith(entry)).toBe(true)
    expect(md).toContain(`> Emma words at the same place\n\n### Emma\n`)
  })

  it('takes away what the body wrote around a highlight when it goes, if it is still as written', () => {
    const t = parseNoteTemplate(
      '{{#body}}\n## {{ chapter }} · {{ date }}\n{{ highlight }}\n{{/body}}'
    )
    const entry = entryFrom(t, vars({ highlight: highlightBlock(hl(B), EMMA) }))
    let md = upsertHighlight(shared, hl(B), EMMA, compare, undefined, { ofBook: emma, entry })
    md = removeHighlight(md, B, { ofBook: emma, frame: entryFrame(t) })
    expect(md.trimEnd()).toBe(shared.trimEnd())
    // Changed by hand: only the highlight goes, the person's heading stays.
    md = upsertHighlight(shared, hl(B), EMMA, compare, undefined, { ofBook: emma, entry })
    md = md.replace(/## Chapter 3 · .*/, '## My heading')
    md = removeHighlight(md, B, { ofBook: emma, frame: entryFrame(t) })
    expect(md).toContain('## My heading')
    expect(parseHighlights(md, emma).map((h) => h.cfi)).toEqual([A])
  })
})

describe("a book's own note made from a template", () => {
  it('still says whose it is, so it is found when either file moves', () => {
    const md = withCompanionProps('---\ntags: [x]\n---\n# Dune\n', '[[Books/Dune.epub]]')
    expect(md).toContain('type: book-highlights')
    expect(md).toContain('file: "[[Books/Dune.epub]]"')
    expect(md).toContain('tags: [x]')
    expect(md).toContain('# Dune')
    const bare = withCompanionProps('# Dune\n', '[[Books/Dune.epub]]')
    expect(bare.startsWith('---\ntype: book-highlights\nfile: "[[Books/Dune.epub]]"\n---\n')).toBe(
      true
    )
    // A template linking the book itself, the old way or the new, keeps its own link.
    const own = '---\ntype: reading\nbook: "[[Books/Dune.epub]]"\n---\n'
    expect(withCompanionProps(own, '[[Books/Dune.epub]]')).toBe(own)
    const ownFile = '---\ntype: reading\nfile: "[[Books/Dune.epub]]"\n---\n'
    expect(withCompanionProps(ownFile, '[[Books/Dune.epub]]')).toBe(ownFile)
  })
})
