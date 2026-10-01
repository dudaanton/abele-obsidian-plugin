import type { MarkdownPostProcessorContext } from 'obsidian'
import { parseDeck } from './core/markdown'

let lastText = ''
let lastDeck = parseDeck('')

/** Only source-positioned reading sections: a slide's renderer must not rewrite its own content. */
export function slideDividers(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
  const info = ctx.getSectionInfo(el)
  if (!info) return
  if (info.text !== lastText) {
    lastText = info.text
    lastDeck = parseDeck(info.text)
  }
  if (lastDeck.settings.properties.type !== 'presentation') return
  const lines = info.text.split('\n')
  lastDeck.slides.forEach((slide, index) => {
    const label = `Slide ${index + 1} · ${slide.settings.layout}`
    const divider = () => {
      const span = el.ownerDocument.win.createSpan({ cls: 'abele-slide-divider', text: label })
      return span
    }
    const separator = slide.sourceLine !== undefined ? slide.sourceLine - 1 : -1
    if (
      index > 0 &&
      separator >= info.lineStart &&
      separator <= info.lineEnd &&
      /^ {0,3}---\s*$/.test(lines[separator] ?? '')
    ) {
      const hr = el.matches('hr') ? el : el.querySelector('hr')
      hr?.replaceWith(divider())
    }
    if (
      slide.markerLine !== undefined &&
      slide.markerLine >= info.lineStart &&
      slide.markerLine <= info.lineEnd
    ) {
      const paragraphs = el.matches('p') ? [el] : Array.from(el.querySelectorAll('p'))
      for (const p of paragraphs) replaceRenderedMarker(p, divider)
    }
  })
}

/** Wikilinks inside a directive become anchors, so the marker can span several DOM text nodes.
 * Delete exactly its rendered text range, keeping any prose on the next line in the paragraph. */
function replaceRenderedMarker(p: HTMLElement, divider: () => HTMLElement): void {
  const marker = /^\s*::slide(?:\{(?:[^"'{}]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')*\})?::/.exec(
    p.textContent ?? ''
  )
  if (!marker) return
  const doc = p.ownerDocument
  const walker = doc.createTreeWalker(p, NodeFilter.SHOW_TEXT)
  let remaining = marker[0].length
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (remaining > length) {
      remaining -= length
      continue
    }
    const range = doc.createRange()
    range.setStart(p, 0)
    range.setEnd(node, remaining)
    range.deleteContents()
    p.prepend(divider())
    return
  }
}
