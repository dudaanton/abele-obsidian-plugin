import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  paintNoteComments,
  readingCommentSelection,
  noteCommentPostProcessor,
} from '@/comments/reading'
import type { MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian'
import { setTextCommentInfoSource, setTextCommentClickHandler } from '@/editor/CommentPlugin'

const source = (quotes: Record<string, string>) =>
  setTextCommentInfoSource({
    get: (id) =>
      quotes[id]
        ? {
            kind: 'human',
            quote: quotes[id],
            appearance: 'blue',
            state: 'idle',
            open: false,
            messages: 1,
          }
        : undefined,
    touch() {},
  })
afterEach(() => setTextCommentInfoSource({ get: () => undefined, touch() {} }))
function root(html: string) {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}
describe('ordinary-note reading comments', () => {
  it('registers detached source sections and removes its paint and subscription on unload', () => {
    const text = 'sample%%c:aaaaaa%%'
    source({ aaaaaa: 'sample' })
    const el = root('<p>sample</p>')
    let child: MarkdownRenderChild | undefined
    noteCommentPostProcessor(el, {
      sourcePath: 'sample.md',
      getSectionInfo: () => ({ text, lineStart: 0, lineEnd: 0 }),
      addChild: (value: MarkdownRenderChild) => {
        child = value
      },
    } as MarkdownPostProcessorContext)
    child!.load()
    expect(el.querySelector('[data-comment-kind="human"]')).not.toBeNull()
    child!.unload()
    expect(el.querySelector('[data-comment-kind="human"]')).toBeNull()
  })
  it('maps formatted multiline source to DOM text, preserving links and using separate targets', () => {
    const text = 'First **bold [label](sample.md)**\nand `code`%%c:aaaaaa%%'
    source({ aaaaaa: '**bold [label](sample.md)**\nand `code`' })
    const el = root(
      '<p>First <strong>bold <a href="sample.md">label</a></strong>\nand <code>code</code></p>'
    )
    const click = vi.fn()
    setTextCommentClickHandler(click)
    paintNoteComments(el, text, 0, text.length)
    expect(
      [...el.querySelectorAll('[data-abele-note-comment-quote]')]
        .map((span) => span.textContent)
        .join('')
    ).toBe('bold label\nand code')
    expect(el.querySelector('a')?.getAttribute('href')).toBe('sample.md')
    el.querySelector<HTMLElement>('[data-comment-kind="human"]')!.click()
    expect(click).toHaveBeenCalledWith(['aaaaaa'])
    paintNoteComments(el, text, 0, text.length)
    expect(el.querySelectorAll('.abele-comment-marker')).toHaveLength(1)
    expect(el.textContent).toBe('First bold label\nand code1')
  })
  it('uses source section identity for repeated paragraphs rather than global quote search', () => {
    const text = 'Repeated words%%c:aaaaaa%%\n\nRepeated words%%c:bbbbbb%%'
    source({ aaaaaa: 'Repeated words', bbbbbb: 'Repeated words' })
    const el = root('<p>Repeated words</p>'),
      from = text.indexOf('Repeated', 5)
    paintNoteComments(el, text, from, text.length)
    expect(el.querySelector('[data-comment-ids]')?.getAttribute('data-comment-ids')).toBe('bbbbbb')
    expect(el.querySelectorAll('.abele-comment-marker')).toHaveLength(1)
  })
  it('paints overlapping threads and keeps a missing quote at its own source point', () => {
    const text = 'some words%%c:aaaaaa,bbbbbb,cccccc%% after'
    source({ aaaaaa: 'some words', bbbbbb: 'words', cccccc: 'missing' })
    const el = root('<p>some words after</p>')
    paintNoteComments(el, text, 0, text.length)
    expect(el.querySelectorAll('[data-abele-note-comment-quote]')).toHaveLength(2)
    expect(el.querySelector('.abele-comment-marker_orphan')).not.toBeNull()
    expect(el.textContent).toBe('some words3 after')
  })
  it('maps wikilink aliases and escaped characters without putting icons inside links', () => {
    const text = 'See [[sample|shown label]] and \\*literal\\*%%c:aaaaaa%%'
    source({ aaaaaa: '[[sample|shown label]] and \\*literal\\*' })
    const el = root('<p>See <a>shown label</a> and *literal*</p>')
    paintNoteComments(el, text, 0, text.length)
    expect(
      [...el.querySelectorAll('[data-abele-note-comment-quote]')]
        .map((el) => el.textContent)
        .join('')
    ).toBe('shown label and *literal*')
    expect(el.querySelector('a .abele-comment-marker')).toBeNull()
  })
  it('captures a rendered selection as source offsets before focus changes', () => {
    const text = 'A **sample** passage%%c:aaaaaa%%'
    source({ aaaaaa: '**sample**' })
    const el = root('<p>A <strong>sample</strong> passage</p>')
    paintNoteComments(el, text, 0, text.length, 'sample.md')
    const node = el.querySelector('strong')!.firstChild!
    const range = document.createRange()
    range.selectNodeContents(node)
    expect(readingCommentSelection(el, range)).toEqual({
      note: 'sample.md',
      source: text,
      from: 4,
      to: 10,
    })
  })
  it('does not paint a different rendered revision or unrelated embedded content', () => {
    const text = 'sample%%c:aaaaaa%%'
    source({ aaaaaa: 'sample' })
    const el = root('<p>different words</p>')
    paintNoteComments(el, text, 0, text.length)
    expect(el.querySelector('[data-abele-note-comment-quote]')).toBeNull()
    expect(el.querySelector('.abele-comment-marker_orphan')).not.toBeNull()
  })
})
