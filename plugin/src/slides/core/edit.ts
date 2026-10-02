import { parseDeck } from './markdown'

export interface SlideEdit {
  /** One-based; insert is before this slide, count + 1 appends. */
  slide: number
  operation?: 'replace' | 'insert' | 'remove'
  content?: string
}

export function prepareDeckCreate(params: { content?: unknown }): string {
  if (typeof params.content !== 'string') throw new Error('Missing deck content')
  if (parseDeck(params.content).settings.properties.type !== 'presentation')
    throw new Error('Deck content must have frontmatter type: presentation')
  return params.content
}

/** Markdown codec edit: untouched source, properties and code fences remain byte-for-byte.
 * The portable deck supplies structural locations; a future storage adapter edits its model. */
export function prepareSlideEdit(source: string, edit: SlideEdit): string {
  const deck = parseDeck(source)
  const operation = edit.operation ?? 'replace'
  if (!['replace', 'insert', 'remove'].includes(operation))
    throw new Error('Unknown slide operation')
  const count = deck.slides.length
  if (
    !Number.isInteger(edit.slide) ||
    edit.slide < 1 ||
    edit.slide > count + (operation === 'insert' ? 1 : 0)
  )
    throw new Error(`Invalid slide number; use 1–${count + (operation === 'insert' ? 1 : 0)}`)
  if (operation === 'remove' && count === 1) throw new Error('Cannot remove the last slide')
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r\n?|\n/)
  const starts = deck.slides.map((s) => s.sourceLine!)
  const index = edit.slide - 1
  const start = starts[index] ?? lines.length
  const end = index + 1 < count ? starts[index + 1] - 1 : lines.length
  if (operation === 'remove') {
    if (index === 0) lines.splice(start, starts[1] - start)
    else lines.splice(start - 1, end - start + 1)
  } else {
    if (typeof edit.content !== 'string') throw new Error('Missing slide content')
    // Leading blank prevents a slide's first separator being mistaken for frontmatter.
    const one = parseDeck('\n' + edit.content)
    if (one.slides.length !== 1)
      throw new Error('Content must describe exactly one slide; use insert for another')
    const content = edit.content.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
    if (operation === 'replace') {
      lines.splice(start, end - start, ...content, ...(index === count - 1 ? [''] : ['', '']))
    } else if (index === count) {
      return (
        source.replace(/(?:\r?\n)+$/, '') + eol + eol + '---' + eol + eol + content.join(eol) + eol
      )
    } else lines.splice(start, 0, ...content, '', '---', '')
  }
  return lines.join(eol)
}
