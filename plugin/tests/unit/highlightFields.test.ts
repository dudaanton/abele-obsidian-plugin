/**
 * A highlights template with the quote and the comment as fields of their own: `{{ quote }}` for
 * the callout the reader reads back, `{{ comment }}` for the comment wherever the body puts it
 * (`src/reader/noteTemplate.ts`, `src/reader/entryComment.ts`), read back and rewritten in place
 * (`src/reader/highlights.ts`). Notes and templates made before keep working.
 */
import { describe, it, expect } from 'vitest'
import { placeSubpath } from '@/reader/bookLinks'
import {
  entryFrame,
  entryFrom,
  newNoteFrom,
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
import { compare } from '@/vendor/foliate-js/epubcfi.js'

const A = 'epubcfi(/6/8!/4/2,/1:0,/1:10)'
const B = 'epubcfi(/6/8!/4/6,/1:0,/1:10)'
const LINK = (cfi: string) => `[[Books/Sample Book.epub${placeSubpath({ cfi })}|Part One]]`
const hl = (cfi: string, over: Partial<Highlight> = {}): Highlight => ({
  cfi,
  color: 'green',
  text: 'The river ran north that year.',
  comment: '',
  label: 'Part One',
  ...over,
})

/** The variables a highlight is written with, the way `saveHighlight` makes them. */
const vars = (h: Highlight, withField: boolean): NoteVars => {
  const block = highlightBlock(withField ? { ...h, comment: '' } : h, LINK(h.cfi))
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
  }
}

/** A note with one entry per highlight, each added as the template's body, as the reader does. */
function noteWith(template: string, ...hs: Highlight[]): string {
  const t = parseNoteTemplate(template)
  let md = '# Reading\n'
  for (const h of hs)
    md = upsertHighlight(md, h, LINK(h.cfi), compare, undefined, {
      entry: entryFrom(t, vars(h, true)),
      frame: entryFrame(t),
    })
  return md
}

const AFTER =
  '{{#body}}\n## {{ chapter }}\n{{ quote }}\n\n**Comment:** {{ comment }}\n\n---\n{{/body}}'

describe('a template with the quote and the comment as fields of their own', () => {
  it('writes the comment where the body puts it, and the callout holds the words alone', () => {
    const t = parseNoteTemplate(AFTER)
    const entry = entryFrom(t, vars(hl(A, { comment: 'Worth a second look.' }), true))
    expect(entry).toBe(
      [
        '## Part One',
        `> [!quote|green] ${LINK(A)}`,
        '> The river ran north that year.',
        '',
        '**Comment:** Worth a second look.',
        '',
        '---',
      ].join('\n')
    )
  })

  it('reads both back, each from its own place', () => {
    const md = noteWith(AFTER, hl(A, { comment: 'Worth a second look.' }), hl(B))
    const frame = entryFrame(parseNoteTemplate(AFTER))
    expect(parseHighlights(md, undefined, frame)).toEqual([
      hl(A, { comment: 'Worth a second look.' }),
      hl(B),
    ])
  })

  it('writes a comment added later into its field, and nothing else', () => {
    const frame = entryFrame(parseNoteTemplate(AFTER))
    const md = noteWith(AFTER, hl(A), hl(B))
    expect(md).toContain('**Comment:**\n')
    const edited = upsertHighlight(
      md,
      hl(A, { comment: 'Added afterwards.' }),
      LINK(A),
      compare,
      undefined,
      { frame }
    )
    // Line for line the same note, only the comment's line changed.
    const before = md.split('\n')
    const after = edited.split('\n')
    expect(after).toHaveLength(before.length)
    const changed = after.filter((line, i) => line !== before[i])
    expect(changed).toEqual(['**Comment:** Added afterwards.'])
    expect(parseHighlights(edited, undefined, frame)[0].comment).toBe('Added afterwards.')
    expect(parseHighlights(edited, undefined, frame)[1].comment).toBe('')
  })

  it('keeps a comment of several lines, and changes and clears it again', () => {
    const frame = entryFrame(parseNoteTemplate(AFTER))
    const md = noteWith(AFTER, hl(A), hl(B))
    const long = upsertHighlight(
      md,
      hl(A, { comment: 'One.\nTwo.' }),
      LINK(A),
      compare,
      undefined,
      {
        frame,
      }
    )
    expect(long).toContain('**Comment:** One.\nTwo.\n\n---')
    expect(parseHighlights(long, undefined, frame)[0].comment).toBe('One.\nTwo.')
    const shorter = upsertHighlight(
      long,
      hl(A, { comment: 'Three.' }),
      LINK(A),
      compare,
      undefined,
      {
        frame,
      }
    )
    expect(parseHighlights(shorter, undefined, frame)[0].comment).toBe('Three.')
    const cleared = upsertHighlight(shorter, hl(A), LINK(A), compare, undefined, { frame })
    expect(cleared).toBe(md)
  })

  it('keeps blank lines of a comment inside a quoted field', () => {
    const template = '{{#body}}\n{{ quote }}\n\n> [!note] Thoughts\n> {{ comment }}\n{{/body}}'
    const frame = entryFrame(parseNoteTemplate(template))
    const md = noteWith(template, hl(A, { comment: 'First.\n\nSecond.' }), hl(B))
    expect(md).toContain('> [!note] Thoughts\n> First.\n>\n> Second.\n')
    expect(parseHighlights(md, undefined, frame).map((h) => h.comment)).toEqual([
      'First.\n\nSecond.',
      '',
    ])
  })

  it('finds a comment the body puts before the quote', () => {
    const template = '{{#body}}\n### {{ chapter }}\n_{{ comment }}_\n{{ quote }}\n{{/body}}'
    const frame = entryFrame(parseNoteTemplate(template))
    const md = noteWith(template, hl(A), hl(B, { comment: 'Before it.' }))
    expect(md).toContain(`_Before it._\n> [!quote|green] ${LINK(B)}`)
    expect(parseHighlights(md, undefined, frame).map((h) => h.comment)).toEqual(['', 'Before it.'])
    const edited = upsertHighlight(
      md,
      hl(A, { comment: 'Now this.' }),
      LINK(A),
      compare,
      undefined,
      {
        frame,
      }
    )
    expect(edited).toContain(`_Now this._\n> [!quote|green] ${LINK(A)}`)
    expect(parseHighlights(edited, undefined, frame).map((h) => h.comment)).toEqual([
      'Now this.',
      'Before it.',
    ])
  })

  it('finds a comment on the last line of the body, even one written empty', () => {
    const template = '{{#body}}\n{{ quote }}\n\n{{ comment }}\n{{/body}}'
    const frame = entryFrame(parseNoteTemplate(template))
    const md = noteWith(template, hl(A), hl(B))
    expect(parseHighlights(md, undefined, frame).map((h) => h.comment)).toEqual(['', ''])
    const edited = upsertHighlight(md, hl(A, { comment: 'Late.' }), LINK(A), compare, undefined, {
      frame,
    })
    expect(edited).toContain(
      `> The river ran north that year.\n\nLate.\n\n> [!quote|green] ${LINK(B)}`
    )
    expect(parseHighlights(edited, undefined, frame).map((h) => h.comment)).toEqual(['Late.', ''])
    const again = upsertHighlight(
      edited,
      hl(A, { comment: 'Later.' }),
      LINK(A),
      compare,
      undefined,
      {
        frame,
      }
    )
    expect(parseHighlights(again, undefined, frame).map((h) => h.comment)).toEqual(['Later.', ''])
    expect(upsertHighlight(again, hl(A), LINK(A), compare, undefined, { frame })).toBe(md)
  })

  it('writes the field again where it was taken out by hand', () => {
    const template = '{{#body}}\n{{ quote }}\n\nNote: {{ comment }}\n{{/body}}'
    const frame = entryFrame(parseNoteTemplate(template))
    const md = noteWith(template, hl(A), hl(B)).replace('Note:\n\n', '')
    expect(md.match(/Note:/g)).toHaveLength(1)
    const edited = upsertHighlight(md, hl(A, { comment: 'Back.' }), LINK(A), compare, undefined, {
      frame,
    })
    expect(edited).toContain(
      `> The river ran north that year.\n\nNote: Back.\n\n> [!quote|green] ${LINK(B)}`
    )
    expect(parseHighlights(edited, undefined, frame).map((h) => h.comment)).toEqual(['Back.', ''])
  })

  it('takes the comment away with the highlight', () => {
    const t = parseNoteTemplate(AFTER)
    const md = noteWith(AFTER, hl(A, { comment: 'Gone too.' }), hl(B))
    const gone = removeHighlight(md, A, { frame: entryFrame(t) })
    expect(gone).not.toContain('Gone too.')
    expect(gone).toBe(noteWith(AFTER, hl(B)))
  })

  it('makes the note whole the first time with both fields in their places', () => {
    const t = parseNoteTemplate(`# {{ title }}\n\n${AFTER}\nThe end.\n`)
    const note = newNoteFrom(t, vars(hl(A, { comment: 'First.' }), true))
    expect(note).toContain('> The river ran north that year.\n\n**Comment:** First.\n')
    expect(parseHighlights(note, undefined, entryFrame(t))).toEqual([hl(A, { comment: 'First.' })])
  })
})

describe('notes and templates made before', () => {
  const OLD = [
    '# Reading',
    '',
    `> [!quote|green] ${LINK(A)}`,
    '> The river ran north that year.',
    '>',
    '> Written inside the quote.',
    '',
  ].join('\n')

  it('still read a comment kept inside the callout, with or without a template', () => {
    const frame = entryFrame(parseNoteTemplate(AFTER))
    expect(parseHighlights(OLD)[0].comment).toBe('Written inside the quote.')
    expect(parseHighlights(OLD, undefined, frame)[0].comment).toBe('Written inside the quote.')
  })

  it('keep the comment inside the callout when the note does not have the field around it', () => {
    const frame = entryFrame(parseNoteTemplate(AFTER))
    const md = upsertHighlight(OLD, hl(A, { comment: 'Changed.' }), LINK(A), compare, undefined, {
      frame,
    })
    expect(md).toBe(OLD.replace('Written inside the quote.', 'Changed.'))
  })

  it('write the comment inside the callout for a template with only {{ highlight }}', () => {
    const t = parseNoteTemplate('{{#body}}\n## {{ chapter }}\n{{ highlight }}\n{{/body}}')
    expect(entryFrame(t).comment).toBeUndefined()
    const h = hl(A, { comment: 'Inside.' })
    const entry = entryFrom(t, vars(h, false))
    expect(entry).toContain('> The river ran north that year.\n>\n> Inside.')
    expect(parseHighlights(entry, undefined, entryFrame(t))).toEqual([h])
  })

  it('treat {{ quote }} without a comment field like {{ highlight }}', () => {
    const t = parseNoteTemplate('{{#body}}\n{{ quote }}\n{{/body}}')
    expect(entryFrame(t).comment).toBeUndefined()
    const h = hl(A, { comment: 'Inside.' })
    expect(entryFrom(t, vars(h, false))).toBe(highlightBlock(h, LINK(A)))
  })
})
