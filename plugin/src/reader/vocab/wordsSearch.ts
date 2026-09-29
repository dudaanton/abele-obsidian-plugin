/**
 * The book searched for the forms of a word, as vocabulary rules find them (`words.ts`): whole
 * words, whatever the case, diacritics kept, and nothing else — so the list of places is exactly
 * the words underlined. What the engine's search is given as its matcher, for a link from a
 * highlight's forms (`formsLinks.ts`); its results go to the reader's own search panel.
 */
import { findWords, formKey } from './words'
import { rangeOf, sectionText } from './sectionText'

/** How much of the text either side of a match its excerpt shows, as the engine's does. */
const CONTEXT = 50

const flat = (s: string) => s.replace(/\s+/g, ' ')

/** A matcher for the engine's search: each whole word of `forms` in a chapter, with its excerpt. */
export function wordsMatcher(forms: string[]) {
  const keys = new Set(forms.map(formKey).filter((k): k is string => !!k))
  return function* (doc: Document): Generator<{
    range: Range
    excerpt: { pre: string; match: string; post: string }
  }> {
    const st = sectionText(doc)
    for (const m of findWords(st.text, keys).matches) {
      const range = rangeOf(st, m.start, m.end)
      if (!range) continue
      const before = flat(st.text.slice(Math.max(0, m.start - CONTEXT * 2), m.start)).trimStart()
      const after = flat(st.text.slice(m.end, m.end + CONTEXT * 2)).trimEnd()
      yield {
        range,
        excerpt: {
          pre: `${before.length > CONTEXT ? '…' : ''}${before.slice(-CONTEXT)}`,
          match: st.text.slice(m.start, m.end),
          post: `${after.slice(0, CONTEXT)}${after.length > CONTEXT ? '…' : ''}`,
        },
      }
    }
  }
}
