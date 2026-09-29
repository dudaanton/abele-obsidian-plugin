/**
 * Words as vocabulary rules find them in a book (`src/reader/vocab/words.ts`) and a chapter's text
 * as one string they are found in (`sectionText.ts`): whole words, whatever the case and the
 * Unicode form, diacritics kept apart, no stems; a word split across inline elements found whole,
 * words in two paragraphs never run together.
 */
import { describe, it, expect } from 'vitest'
import { findWords, formKey, parseForms, wordKey } from '@/reader/vocab/words'
import { offsetOf, rangeOf, sectionText } from '@/reader/vocab/sectionText'

/** A soft hyphen. */
const SHY = String.fromCharCode(0xad)

const keys = (...forms: string[]) => new Set(forms.map((f) => formKey(f)!))
const found = (text: string, ...forms: string[]) =>
  findWords(text, keys(...forms)).matches.map((m) => text.slice(m.start, m.end))

describe('words and forms', () => {
  it('compares whatever the case and the Unicode form', () => {
    expect(wordKey('Māja')).toBe(wordKey('māja'))
    // Decomposed: a plus a combining macron.
    expect(wordKey('māja')).toBe(wordKey('māja'))
    expect(found('MĀJA un mājas', 'māja', 'mājas')).toEqual(['MĀJA', 'mājas'])
  })

  it('keeps letters with a diacritic apart from the ones without', () => {
    expect(found('maja māja', 'māja')).toEqual(['māja'])
    expect(found('все всё', 'всё')).toEqual(['всё'])
  })

  it('finds whole words only, and no other forms', () => {
    expect(found('mājas mājā māja mājasvieta', 'māja')).toEqual(['māja'])
    expect(found('Книга, книги; книгой.', 'книга', 'книгой')).toEqual(['Книга', 'книгой'])
  })

  it('ignores a soft hyphen inside a word', () => {
    expect(found(`mā${SHY}jas`, 'mājas')).toEqual([`mā${SHY}jas`])
  })

  it('takes a joined word whole when it is a form, and its parts otherwise', () => {
    expect(found("don't l'homme", "don't", 'homme')).toEqual(["don't", 'homme'])
    expect(found('какой-то', 'какой-то')).toEqual(['какой-то'])
    expect(found('какой-то', 'какой')).toEqual(['какой'])
    expect(found('it’s', "it's")).toEqual(['it’s'])
  })

  it('reads a list of forms however it is written, each once', () => {
    expect(parseForms('māja, mājas;mājā\nMāja')).toEqual(['māja', 'mājas', 'mājā'])
    expect(parseForms(['māja', 'mājas, mājā', 3, null])).toEqual(['māja', 'mājas', 'mājā', '3'])
    expect(parseForms(' , ;')).toEqual([])
  })

  it('has no key for a form of several words: v1 underlines single words', () => {
    expect(formKey('māja')).toBe('māja')
    expect(formKey('liela māja')).toBeNull()
  })

  it('reads a long text a piece at a time, finding the same', () => {
    const text = Array.from({ length: 50 }, (_, i) => `vārds${i % 7} māja`).join(' ')
    const all = findWords(text, keys('māja')).matches
    const pieces = []
    for (let from = 0; from >= 0; ) {
      const r = findWords(text, keys('māja'), from, 9)
      pieces.push(...r.matches)
      from = r.next
    }
    expect(pieces).toEqual(all)
    expect(all).toHaveLength(50)
  })
})

describe('a chapter’s text', () => {
  const page = (html: string) => {
    const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    document.body.replaceChildren(...Array.from(parsed.body.childNodes))
    return document
  }

  it('joins a word split across inline elements, and parts words between blocks', () => {
    const doc = page('<p>Lie<em>la</em> māja</p><p>stāv</p><ul><li>kalnā</li><li>tur</li></ul>')
    const st = sectionText(doc)
    expect(st.text).toBe('Liela māja stāv kalnā tur')
    expect(found(st.text, 'liela')).toEqual(['Liela'])
  })

  it('parts words at a line break and a picture, and leaves ruby annotations out', () => {
    const doc = page('<p>viens<br/>divi<img src="x"/>trīs <ruby>漢<rt>kan</rt></ruby></p>')
    expect(sectionText(doc).text).toBe('viens divi trīs 漢')
  })

  it('leaves the words of a drawing out, and parts the words around it', () => {
    const doc = page('<p>viens<svg><text>māja</text></svg>divi</p>')
    expect(sectionText(doc).text).toBe('viens divi')
  })

  it('maps a word found back onto the page’s own nodes, and a point of the page into the text', () => {
    const doc = page('<p>Lie<em>la</em> māja</p><p>stāv</p>')
    const st = sectionText(doc)
    const [m] = findWords(st.text, keys('liela')).matches
    const range = rangeOf(st, m.start, m.end)!
    expect(range.toString()).toBe('Liela')
    expect(range.startContainer.textContent).toBe('Lie')
    expect(range.endContainer.textContent).toBe('la')
    const stav = doc.querySelectorAll('p')[1]
    expect(offsetOf(st, stav.firstChild!, 2)).toBe(st.text.indexOf('stāv') + 2)
    // A point between nodes: the start of the next text.
    expect(offsetOf(st, doc.body, 1)).toBe(st.text.indexOf('stāv'))
  })
})
