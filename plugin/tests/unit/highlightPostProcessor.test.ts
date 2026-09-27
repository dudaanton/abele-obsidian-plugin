/**
 * Coloured highlights outside the editor.
 *
 * `=={red} text==` has only ever been drawn by a CodeMirror decoration, so it existed in live
 * preview and nowhere else. Reading mode, an embedded note, a chat reply and a script view all
 * go through Obsidian's markdown renderer, which knows `==text==` as a plain `<mark>` and left
 * `{red}` on screen as part of the text. This reads the renderer's `<mark>` back and gives it
 * the editor's classes.
 */
import { describe, it, expect } from 'vitest'
import { coloredHighlightPostProcessor } from '@/editor/highlightPostProcessor'

const render = (html: string) => {
  const el = document.createElement('div')
  // Markup written in the test, standing in for what Obsidian's renderer produced.
  // eslint-disable-next-line no-unsanitized/property -- the test writes the markup itself
  el.innerHTML = html
  coloredHighlightPostProcessor(el)
  return el
}

describe('a highlight the renderer drew', () => {
  it('takes the colour off the text and onto the mark, as the editor draws it', () => {
    const el = render('<p>before <mark>{red} coloured</mark> after</p>')
    const mark = el.querySelector('mark')!

    expect(mark.textContent).toBe('coloured')
    expect(mark.classList.contains('abele-highlight')).toBe(true)
    expect(mark.classList.contains('abele-highlight--red')).toBe(true)
  })

  it('keeps formatting inside the highlight', () => {
    const el = render('<p><mark>{blue} a <strong>bold</strong> word</mark></p>')
    const mark = el.querySelector('mark')!

    expect(mark.innerHTML).toBe('a <strong>bold</strong> word')
    expect(mark.classList.contains('abele-highlight--blue')).toBe(true)
  })

  it('leaves a plain highlight alone', () => {
    const el = render('<p><mark>plain</mark></p>')
    const mark = el.querySelector('mark')!

    expect(mark.textContent).toBe('plain')
    expect(mark.className).toBe('')
  })

  it('leaves braces that are not a colour name, as the editor does', () => {
    const el = render('<p><mark>{not a colour} text</mark> <mark>{red}text</mark></p>')
    const marks = el.querySelectorAll('mark')

    expect(marks[0].textContent).toBe('{not a colour} text')
    expect(marks[1].textContent).toBe('{red}text')
    expect(el.querySelector('.abele-highlight')).toBeNull()
  })

  it('handles every highlight in the section', () => {
    const el = render('<p><mark>{red} one</mark></p><ul><li><mark>{green} two</mark></li></ul>')

    expect([...el.querySelectorAll('mark')].map((m) => m.className)).toEqual([
      'abele-highlight abele-highlight--red',
      'abele-highlight abele-highlight--green',
    ])
  })
})
