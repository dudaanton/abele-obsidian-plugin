import { parseDeck, type DeckLocations } from './markdown'
import type { Slide } from './model'

const slideContent = ({ settings, title, regions, notes }: Slide) =>
  JSON.stringify({ settings, title, regions, notes })

/** Retain the marker as the first nonblank line while moving shared CSS before new content. */
function prependStyles(lines: string[], styles: string[]): string[] {
  if (!styles.length) return lines
  const marker = parseDeck('\n' + lines.join('\n')).slides[0].markerLine
  const at = marker === undefined ? 0 : marker
  return [...lines.slice(0, at), ...styles, '', ...lines.slice(at)]
}

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
  const locations: DeckLocations = { css: [] }
  const deck = parseDeck(source, locations)
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
  const validate = (result: string): string => {
    const after = parseDeck(result)
    const expected = count + (operation === 'insert' ? 1 : operation === 'remove' ? -1 : 0)
    if (after.slides.length !== expected)
      throw new Error(
        'Edit changes neighbouring slide boundaries; close code fences and HTML blocks'
      )
    deck.slides.forEach((slide, before) => {
      if (before === index && operation !== 'insert') return
      const next =
        before < index
          ? before
          : before + (operation === 'insert' ? 1 : operation === 'remove' ? -1 : 0)
      if (slideContent(slide) !== slideContent(after.slides[next]))
        throw new Error(
          'Edit changes neighbouring slide boundaries or content; close code fences and HTML blocks'
        )
    })
    return result
  }
  const start = starts[index] ?? lines.length
  const end = index + 1 < count ? starts[index + 1] - 1 : lines.length
  const styles = locations.css
    .filter((range) => range.start >= start && range.end < end)
    .flatMap((range) => [...lines.slice(range.start, range.end + 1), ''])
  if (operation === 'remove') {
    if (index === 0) {
      const next = prependStyles(lines.slice(starts[1]), styles)
      lines.splice(start, lines.length - start, ...next)
    } else lines.splice(start - 1, end - start + 1, ...styles)
  } else {
    if (typeof edit.content !== 'string') throw new Error('Missing slide content')
    // Leading blank prevents a slide's first separator being mistaken for frontmatter.
    const one = parseDeck('\n' + edit.content)
    if (one.slides.length !== 1)
      throw new Error('Content must describe exactly one slide; use insert for another')
    const content = prependStyles(
      edit.content.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n'),
      operation === 'replace' ? styles : []
    )
    if (operation === 'replace') {
      lines.splice(start, end - start, ...content, ...(index === count - 1 ? [''] : ['', '']))
    } else if (index === count) {
      return validate(
        source.replace(/(?:\r?\n)+$/, '') + eol + eol + '---' + eol + eol + content.join(eol) + eol
      )
    } else lines.splice(start, 0, ...content, '', '---', '')
  }
  return validate(lines.join(eol))
}
