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
      for (const p of paragraphs) {
        for (const node of Array.from(p.childNodes)) {
          if (
            node.nodeType !== Node.TEXT_NODE ||
            !node.textContent?.includes(lines[slide.markerLine].trim())
          )
            continue
          const marker = lines[slide.markerLine].trim()
          const text = node.textContent!
          const at = text.indexOf(marker)
          node.replaceWith(
            el.ownerDocument.createTextNode(text.slice(0, at)),
            divider(),
            el.ownerDocument.createTextNode(text.slice(at + marker.length))
          )
          break
        }
      }
    }
  })
}
