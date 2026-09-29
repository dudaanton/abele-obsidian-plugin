/**
 * A highlight's forms in its note shown as a link to every place they stand in the book
 * (`src/reader/vocab/formsLinks.ts`, `formsPlaces` in `highlights.ts`), and the book searched for
 * them as whole words, as its underlines find them (`wordsSearch.ts`).
 */
import { describe, it, expect } from 'vitest'
import type { MarkdownPostProcessorContext } from 'obsidian'
import { placeSubpath } from '@/reader/bookLinks'
import { formsPlaces } from '@/reader/highlights'
import { entryFrame, parseNoteTemplate } from '@/reader/noteTemplate'
import {
  FORMS_LINK_CLASS,
  formsHref,
  formsLinkPostProcessor,
  placesIn,
  wordsOfSubpath,
  wordsSubpath,
} from '@/reader/vocab/formsLinks'
import { wordsMatcher } from '@/reader/vocab/wordsSearch'

const CFI = 'epubcfi(/6/8!/4/2,/1:0,/1:4)'
const LINK = `[[Books/Sample Book.epub${placeSubpath({ cfi: CFI })}|Part One]]`
const CALLOUT = `# Words\n\n> [!quote|green] ${LINK}\n> māja\n>\n> A house.\n>\n> forms:: māja, mājas\n`
const TEMPLATE = '{{#body}}\n{{ quote }}\n\n**Forms:** {{ forms }}\n{{/body}}'
const FIELD = `# Words\n\n> [!quote|green] ${LINK}\n> māja\n\n**Forms:** māja, mājas\n`

describe('where the forms are written', () => {
  it('finds a callout’s forms line, the characters of the forms in it, and the book', () => {
    const [place] = formsPlaces(CALLOUT)
    const line = CALLOUT.split('\n')[place.line]
    expect(line.slice(place.from, place.to)).toBe('māja, mājas')
    expect(place).toMatchObject({ forms: ['māja', 'mājas'], book: 'Books/Sample Book.epub' })
  })

  it('finds a template’s field by its frame, and nothing where the field is empty', () => {
    const frame = entryFrame(parseNoteTemplate(TEMPLATE))
    const [place] = placesIn(FIELD, [frame])
    expect(FIELD.split('\n')[place.line].slice(place.from, place.to)).toBe('māja, mājas')
    expect(placesIn(FIELD.replace('māja, mājas', ''), [frame])).toEqual([])
    expect(placesIn('# A note\n\nNothing here.\n')).toEqual([])
  })
})

describe('the link', () => {
  it('names the book and the forms, and the book reads the forms back', () => {
    const href = formsHref({ book: 'Books/Sample Book.epub', forms: ['māja', 'a,b'] })
    expect(href.startsWith('Books/Sample Book.epub#words=')).toBe(true)
    expect(wordsOfSubpath(href.slice(href.indexOf('#')))).toEqual(['māja', 'a,b'])
    expect(wordsOfSubpath(wordsSubpath(['nams']))).toEqual(['nams'])
    expect(wordsOfSubpath('#cfi=/6/2')).toBeNull()
    expect(wordsOfSubpath('#words=')).toBeNull()
  })

  it('is put over the forms of a callout drawn in reading view, the rest of the line left', () => {
    const el = document.createElement('div')
    const parsed = new DOMParser().parseFromString(
      `<div class="callout"><div class="callout-title"><a class="internal-link" data-href="Books/Sample Book.epub#cfi=/6/8!/4/2,/1:0,/1:4">Part One</a></div>` +
        '<div class="callout-content"><p>māja</p><p>A house.</p><p>forms:: māja, mājas</p></div></div>',
      'text/html'
    )
    el.append(...Array.from(parsed.body.childNodes))
    formsLinkPostProcessor(el, {
      getSectionInfo: () => null,
    } as unknown as MarkdownPostProcessorContext)
    const link = el.querySelector<HTMLElement>(`a.${FORMS_LINK_CLASS}`)!
    expect(link.textContent).toBe('māja, mājas')
    expect(link.classList.contains('internal-link')).toBe(true)
    expect(wordsOfSubpath(link.dataset.href!.slice(link.dataset.href!.indexOf('#')))).toEqual([
      'māja',
      'mājas',
    ])
    expect(link.parentElement!.textContent).toBe('forms:: māja, mājas')
    // Drawn again, it is not linked twice.
    formsLinkPostProcessor(el, {
      getSectionInfo: () => null,
    } as unknown as MarkdownPostProcessorContext)
    expect(el.querySelectorAll(`a.${FORMS_LINK_CLASS}`)).toHaveLength(1)
  })
})

describe('the book searched for the forms', () => {
  it('finds each whole word of them, with the words around it', () => {
    const parsed = new DOMParser().parseFromString(
      '<body><p>Tā ir māja. Mājas nav. Majas un mājasvieta.</p></body>',
      'text/html'
    )
    document.body.replaceChildren(...Array.from(parsed.body.childNodes))
    const found = [...wordsMatcher(['māja', 'mājas'])(document)]
    expect(found.map((f) => f.range.toString())).toEqual(['māja', 'Mājas'])
    expect(found[0].excerpt).toEqual({
      pre: 'Tā ir ',
      match: 'māja',
      post: '. Mājas nav. Majas un mājasvieta.',
    })
  })
})
