/**
 * The forms of a word a highlight underlines everywhere in its book: in a highlights template's
 * `{{ forms }}` field, beside `{{ quote }}` and `{{ comment }}`, or — with no field, in notes made
 * before — as a `forms::` line in the callout (`src/reader/highlights.ts`, `noteTemplate.ts`,
 * `entryComment.ts`). Written and read back without disturbing anything else; notes with neither
 * read exactly as before.
 */
import { describe, it, expect } from 'vitest'
import { placeSubpath } from '@/reader/bookLinks'
import {
  entryFrame,
  entryFrom,
  hasFormsField,
  parseNoteTemplate,
  type NoteVars,
} from '@/reader/noteTemplate'
import {
  highlightBlock,
  parseHighlights,
  removeHighlight,
  upsertHighlight,
  type Highlight,
} from '@/reader/highlights'
import { formsLine } from '@/reader/vocab/words'
import { compare } from '@/vendor/foliate-js/epubcfi.js'

const A = 'epubcfi(/6/8!/4/2,/1:0,/1:4)'
const B = 'epubcfi(/6/8!/4/6,/1:0,/1:5)'
const LINK = (cfi: string) => `[[Books/Sample Book.epub${placeSubpath({ cfi })}|Part One]]`
const hl = (cfi: string, over: Partial<Highlight> = {}): Highlight => ({
  cfi,
  color: 'green',
  text: 'māja',
  comment: '',
  label: 'Part One',
  ...over,
})

/** The variables a highlight is written with, as `saveHighlight` makes them. */
const vars = (h: Highlight, template: ReturnType<typeof parseNoteTemplate>): NoteVars => {
  const fields = hasFormsField(template)
  const block = highlightBlock(
    { ...h, comment: '', ...(fields ? { forms: undefined } : {}) },
    LINK(h.cfi)
  )
  return {
    title: 'Sample Book',
    author: 'A. Writer',
    book: '[[Books/Sample Book.epub]]',
    chapter: h.label,
    color: h.color,
    link: LINK(h.cfi),
    highlight: block,
    quote: block,
    comment: h.comment,
    forms: formsLine(h.forms ?? []),
  }
}

function noteWith(template: string, ...hs: Highlight[]): string {
  const t = parseNoteTemplate(template)
  let md = '# Words\n'
  for (const h of hs)
    md = upsertHighlight(md, h, LINK(h.cfi), compare, undefined, {
      entry: entryFrom(t, vars(h, t)),
      frame: entryFrame(t),
    })
  return md
}

const FORMS = ['māja', 'mājas', 'mājā']

describe('forms in the callout, with no field for them', () => {
  it('writes them as the callout’s last line and reads them back apart from the comment', () => {
    const block = highlightBlock(hl(A, { comment: 'A house.', forms: FORMS }), LINK(A))
    expect(block).toBe(
      [
        `> [!quote|green] ${LINK(A)}`,
        '> māja',
        '>',
        '> A house.',
        '>',
        '> forms:: māja, mājas, mājā',
      ].join('\n')
    )
    expect(parseHighlights(`${block}\n`)).toEqual([hl(A, { comment: 'A house.', forms: FORMS })])
  })

  it('reads a callout with forms and no comment', () => {
    const block = highlightBlock(hl(A, { forms: FORMS }), LINK(A))
    expect(parseHighlights(block)).toEqual([hl(A, { forms: FORMS })])
  })

  it('reads a note written before exactly as before', () => {
    const md = `> [!quote|green] ${LINK(A)}\n> māja\n>\n> A house.\n`
    expect(parseHighlights(md)).toEqual([hl(A, { comment: 'A house.' })])
  })

  it('keeps the forms when the colour or the comment changes, and drops them when cleared', () => {
    let md = `# Words\n\n${highlightBlock(hl(A, { forms: FORMS }), LINK(A))}\n`
    md = upsertHighlight(
      md,
      hl(A, { color: 'blue', comment: 'Now.', forms: FORMS }),
      LINK(A),
      compare
    )
    expect(parseHighlights(md)).toEqual([hl(A, { color: 'blue', comment: 'Now.', forms: FORMS })])
    md = upsertHighlight(md, hl(A, { color: 'blue', comment: 'Now.' }), LINK(A), compare)
    expect(md).not.toContain('forms::')
    expect(parseHighlights(md)).toEqual([hl(A, { color: 'blue', comment: 'Now.' })])
  })
})

const FIELD = '{{#body}}\n## {{ chapter }}\n{{ quote }}\n\n**Forms:** {{ forms }}\n\n---\n{{/body}}'
const BOTH =
  '{{#body}}\n**Forms:** {{ forms }}\n{{ quote }}\n\n**Comment:** {{ comment }}\n\n---\n{{/body}}'
const BOTH_AFTER =
  '{{#body}}\n{{ quote }}\n\n**Comment:** {{ comment }}\n**Forms:** {{ forms }}\n{{/body}}'

describe('a template with a forms field', () => {
  it('is known to have one, and one without it is not', () => {
    expect(hasFormsField(parseNoteTemplate(FIELD))).toBe(true)
    expect(hasFormsField(parseNoteTemplate('{{#body}}\n{{ quote }}\n{{/body}}'))).toBe(false)
  })

  it('writes the forms into their field and the callout without them', () => {
    const t = parseNoteTemplate(FIELD)
    expect(entryFrom(t, vars(hl(A, { forms: FORMS }), t))).toBe(
      [
        '## Part One',
        `> [!quote|green] ${LINK(A)}`,
        '> māja',
        '',
        '**Forms:** māja, mājas, mājā',
        '',
        '---',
      ].join('\n')
    )
  })

  it('writes an empty field with no space left after it, and reads it as none', () => {
    const md = noteWith(FIELD, hl(A), hl(B, { text: 'mājas' }))
    expect(md).toContain('**Forms:**\n')
    const frame = entryFrame(parseNoteTemplate(FIELD))
    expect(parseHighlights(md, undefined, frame)).toEqual([hl(A), hl(B, { text: 'mājas' })])
  })

  it('fills in the field later, changing that line only, and clears it again', () => {
    const frame = entryFrame(parseNoteTemplate(FIELD))
    const md = noteWith(FIELD, hl(A), hl(B, { text: 'mājas' }))
    const edited = upsertHighlight(md, hl(A, { forms: FORMS }), LINK(A), compare, undefined, {
      frame,
    })
    const before = md.split('\n')
    const after = edited.split('\n')
    expect(after).toHaveLength(before.length)
    expect(after.filter((line, i) => line !== before[i])).toEqual(['**Forms:** māja, mājas, mājā'])
    expect(parseHighlights(edited, undefined, frame)[0].forms).toEqual(FORMS)
    expect(parseHighlights(edited, undefined, frame)[1].forms).toBeUndefined()
    const cleared = upsertHighlight(edited, hl(A), LINK(A), compare, undefined, { frame })
    expect(cleared).toBe(md)
  })

  it('keeps what the person wrote around the field', () => {
    const frame = entryFrame(parseNoteTemplate(FIELD))
    const md = noteWith(FIELD, hl(A, { forms: ['māja'] })).replace(
      '**Forms:** māja',
      '**Forms:**   māja ,  mājas  '
    )
    expect(parseHighlights(md, undefined, frame)[0].forms).toEqual(['māja', 'mājas'])
    const edited = upsertHighlight(md, hl(A, { forms: FORMS }), LINK(A), compare, undefined, {
      frame,
    })
    expect(edited).toContain('**Forms:**   māja, mājas, mājā\n')
  })

  it('reads and writes the forms and a comment of several lines, both before and after', () => {
    for (const template of [BOTH, BOTH_AFTER]) {
      const frame = entryFrame(parseNoteTemplate(template))
      let md = noteWith(template, hl(A), hl(B, { text: 'mājas', forms: ['mājas'] }))
      md = upsertHighlight(
        md,
        hl(A, { comment: 'One.\nTwo.', forms: FORMS }),
        LINK(A),
        compare,
        undefined,
        { frame }
      )
      expect(parseHighlights(md, undefined, frame)).toEqual([
        hl(A, { comment: 'One.\nTwo.', forms: FORMS }),
        hl(B, { text: 'mājas', forms: ['mājas'] }),
      ])
      md = upsertHighlight(md, hl(A, { forms: ['māja'] }), LINK(A), compare, undefined, { frame })
      expect(parseHighlights(md, undefined, frame)).toEqual([
        hl(A, { forms: ['māja'] }),
        hl(B, { text: 'mājas', forms: ['mājas'] }),
      ])
      // Removing the highlight takes its whole entry, the forms' line with it.
      const removed = removeHighlight(md, A, { frame })
      expect(removed).not.toContain('**Forms:** māja\n')
      expect(parseHighlights(removed, undefined, frame)).toEqual([
        hl(B, { text: 'mājas', forms: ['mājas'] }),
      ])
    }
  })

  it('an entry written before the template had the field keeps its forms in the callout', () => {
    // Written with a template without the field; read with one that has it now.
    const old = '{{#body}}\n## {{ chapter }}\n{{ quote }}\n\n---\n{{/body}}'
    const md = noteWith(old, hl(A, { forms: FORMS }))
    expect(md).toContain('> forms:: māja, mājas, mājā')
    const frame = entryFrame(parseNoteTemplate(FIELD))
    expect(parseHighlights(md, undefined, frame)).toEqual([hl(A, { forms: FORMS })])
    const edited = upsertHighlight(md, hl(A, { forms: ['māja'] }), LINK(A), compare, undefined, {
      frame,
    })
    expect(edited).toContain('> forms:: māja\n')
  })
})
