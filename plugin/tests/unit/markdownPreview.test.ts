/**
 * The one-line preview a folded comment card shows.
 *
 * Written after a report from the desktop: an answer that mentioned a note came back as
 * `[[Some note]]` in the margin, brackets and all. The card cannot render Markdown — two
 * clamped lines in a 300 px sidenote, once per card on a note that can hold dozens — so what
 * it shows is the words with the syntax taken off.
 */
import { describe, it, expect } from 'vitest'
import { previewText } from '@/helpers/markdownPreview'

describe('a Markdown line shown as prose', () => {
  it('shows a wikilink as the note it names', () => {
    expect(previewText('See [[Some note]] for the rest.')).toBe('See Some note for the rest.')
  })

  it('shows an aliased wikilink as its alias, which is what a reader would see', () => {
    expect(previewText('See [[Notes/Some note|the note]].')).toBe('See the note.')
  })

  it('keeps the text of a Markdown link and drops its target', () => {
    expect(previewText('Read [the docs](https://example.com/x) first.')).toBe(
      'Read the docs first.'
    )
  })

  it('takes the marks off emphasis and code, and leaves the words', () => {
    expect(previewText('**Bold**, *thin*, `code` and ~~gone~~.')).toBe('Bold, thin, code and gone.')
  })

  it('leaves an asterisk that is not emphasis alone', () => {
    expect(previewText('2 * 3 * 4')).toBe('2 * 3 * 4')
  })

  it('drops what a line begins with: headings, quotes, bullets, numbers, task boxes', () => {
    expect(previewText('## A heading')).toBe('A heading')
    expect(previewText('> quoted')).toBe('quoted')
    expect(previewText('- first\n- second')).toBe('first second')
    expect(previewText('1. first\n2. second')).toBe('first second')
    expect(previewText('- [ ] to do')).toBe('to do')
  })

  it('drops a code fence whole, because a preview of a fence is not code', () => {
    expect(previewText('Try this:\n```js\nconst a = 1\n```\nand see.')).toBe('Try this: and see.')
  })

  it('drops an embed, which renders as a thing rather than as words', () => {
    expect(previewText('Here: ![[picture.png]] and on.')).toBe('Here: and on.')
    expect(previewText('Here: ![alt](pic.png) and on.')).toBe('Here: and on.')
  })

  it('drops a horizontal rule, which is a line with no words in it', () => {
    expect(previewText('before\n---\nafter')).toBe('before after')
  })

  it('is one line, whatever it was given', () => {
    expect(previewText('first\n\nsecond   third\n')).toBe('first second third')
  })

  it('has nothing to say about an empty message', () => {
    expect(previewText('')).toBe('')
  })
})
