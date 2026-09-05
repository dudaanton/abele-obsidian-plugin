/**
 * `::abele-gallery::` everywhere the editor is not.
 *
 * The gallery has always been a CodeMirror decoration, which means it only ever existed in
 * live preview. Reading mode, a note embedded in another, a chat reply that quotes a note,
 * a script view's `Markdown` node — all of those go through Obsidian's markdown renderer,
 * and there the marker stayed on screen as a line of text with the pictures stacked under
 * it at full size. This is the renderer's half: find the marker in what was rendered, take
 * the embeds that belong to it, and put the same gallery component in their place.
 *
 * Two shapes arrive. Reading mode renders a note section by section and says which source
 * lines each section is, so the block is read from the text — the way the editor reads it —
 * and a later section made only of that block's images is emptied. `MarkdownRenderer.render`
 * hands the whole document as one element with no line information, so there the marker's
 * paragraph and the embed-only paragraphs after it are read from the DOM instead.
 *
 * A gallery drawn here is read-only: there is no editor behind it to write a reorder or a
 * deletion back to, and controls that do nothing are worse than none.
 */
import { MarkdownRenderChild, TFile, type MarkdownPostProcessorContext } from 'obsidian'
import { Gallery } from '@/entities/Gallery'
import { GlobalStore } from '@/stores/GlobalStore'
import {
  findGalleryBlocks,
  parseGalleryHeader,
  parseImageLine,
  type GalleryImageEntry,
  type GalleryOptions,
  type GalleryTextBlock,
} from '@/helpers/galleryUtils'
import { genid } from '@/helpers/vueUtils'

/** A section's place in its note, as reading mode reports it. */
interface SectionInfo {
  text: string
  lineStart: number
  lineEnd: number
}

/** Every section of one note asks about the same text; parse it once per document. */
let lastText = ''
let lastBlocks: GalleryTextBlock[] = []
function blocksIn(text: string): GalleryTextBlock[] {
  if (text !== lastText) {
    lastText = text
    lastBlocks = findGalleryBlocks(text.split('\n'))
  }
  return lastBlocks
}

export function galleryPostProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
  const info = ctx.getSectionInfo(el) as SectionInfo | null
  const blocks = info ? blocksIn(info.text) : null

  if (info && blocks) {
    // Only a block's images, drawn under the gallery that already shows them.
    const consumed = blocks.find((b) => info.lineStart > b.headerLine && info.lineEnd <= b.lastLine)
    if (consumed) {
      el.replaceChildren()
      el.classList.add('abele-gallery-consumed')
      return
    }
  }

  for (const { paragraph, marker } of markers(el)) {
    const options = parseGalleryHeader(marker.textContent ?? '')
    if (!options) continue
    const block =
      info && blocks
        ? blocks.find((b) => b.headerLine >= info.lineStart && b.headerLine <= info.lineEnd)
        : undefined
    const embeds = takeEmbeds(paragraph, marker, !block)
    const images = block ? block.images : embeds.map(entryOf).filter((e) => e !== null)
    marker.remove()
    mount(paragraph, ctx, options, images)
  }
}

/** Each paragraph under `el` that holds a marker line, with the text node that is the marker. */
function markers(el: HTMLElement): Array<{ paragraph: HTMLElement; marker: Text }> {
  const paragraphs = el.matches('p') ? [el] : Array.from(el.querySelectorAll('p'))
  const found: Array<{ paragraph: HTMLElement; marker: Text }> = []
  for (const paragraph of paragraphs) {
    for (const node of Array.from(paragraph.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) continue
      if (parseGalleryHeader(node.textContent ?? '')) {
        found.push({ paragraph, marker: node as Text })
        break
      }
    }
  }
  return found
}

const isBreak = (n: Node) => n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'BR'
const isBlank = (n: Node) => n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').trim()
const isEmbed = (n: Node) =>
  n.nodeType === Node.ELEMENT_NODE &&
  ((n as Element).classList.contains('internal-embed') || (n as Element).tagName === 'IMG')

/**
 * The embeds that follow the marker, taken out of the DOM as they are found: the rest of
 * the marker's own paragraph, and — when the paragraphs after it are in reach — each
 * following paragraph that holds nothing but embeds. Breaks and whitespace between them go
 * too, and so does the break that put the marker on a line of its own.
 */
function takeEmbeds(paragraph: HTMLElement, marker: Text, siblings: boolean): Element[] {
  const embeds: Element[] = []
  const before = marker.previousSibling
  if (before && isBreak(before)) before.remove()

  let node = marker.nextSibling
  while (node && (isBreak(node) || isBlank(node) || isEmbed(node))) {
    const next = node.nextSibling
    if (isEmbed(node)) embeds.push(node as Element)
    node.remove()
    node = next
  }

  if (siblings) {
    let sibling = paragraph.nextElementSibling
    while (sibling && sibling.tagName === 'P' && embedsOnly(sibling)) {
      const next = sibling.nextElementSibling
      embeds.push(
        ...Array.from(sibling.childNodes)
          .filter(isEmbed)
          .map((n) => n as Element)
      )
      sibling.remove()
      sibling = next
    }
  }
  return embeds
}

function embedsOnly(p: Element): boolean {
  const nodes = Array.from(p.childNodes)
  return nodes.some(isEmbed) && nodes.every((n) => isEmbed(n) || isBreak(n) || isBlank(n))
}

/** What the renderer made of an embed line, back into the line the gallery understands. */
function entryOf(embed: Element): GalleryImageEntry | null {
  const src = embed.getAttribute('src') ?? ''
  const alt = embed.getAttribute('alt') ?? ''
  if (!src) return null
  if (embed.classList.contains('internal-embed')) {
    return parseImageLine(alt && alt !== src ? `![[${src}|${alt}]]` : `![[${src}]]`)
  }
  return parseImageLine(`![${alt}](${src})`)
}

/** Keeps the gallery in the store for exactly as long as the rendered section lives. */
class GalleryRenderChild extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private readonly gallery: Gallery
  ) {
    super(containerEl)
  }
  onunload(): void {
    const list = GlobalStore.getInstance().galleriesContainers.value
    const at = list.indexOf(this.gallery)
    if (at !== -1) {
      list[at].cleanup()
      list.splice(at, 1)
    }
  }
}

/**
 * The gallery goes in front of the marker's paragraph, and the paragraph itself goes only if
 * nothing else was in it — text on the line after the last image, without a blank line
 * between, is part of the same paragraph and stays.
 *
 * The mount element is handed to the store as an element, not found by id later: the
 * renderer often works in a detached element and swaps it in when done, and a selector
 * looked up in the document would find nothing at the moment Vue asks.
 */
function mount(
  paragraph: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  options: GalleryOptions,
  images: GalleryImageEntry[]
): void {
  // Built in the paragraph's own window: a popout has its own document, and an element made
  // in the main one would not be allowed into it.
  const win = paragraph.ownerDocument.win
  const container = win.createDiv({
    cls: 'abele-gallery-widget-container abele-gallery-widget-container_rendered',
  })
  const id = genid()
  const target = win.createDiv({
    cls: 'abele-vue-mount',
    attr: { 'data-gallery-id': id },
    parent: container,
  })

  paragraph.before(container)
  if (!(paragraph.textContent ?? '').trim() && !paragraph.querySelector('*')) paragraph.remove()

  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(ctx.sourcePath)
  const gallery = new Gallery({
    id,
    file: file instanceof TFile ? file : null,
    sourcePath: ctx.sourcePath,
    images,
    layout: options.layout,
    height: options.height,
    bg: options.bg,
    readonly: true,
    mountEl: target,
  })
  GlobalStore.getInstance().galleriesContainers.value.push(gallery)
  ctx.addChild(new GalleryRenderChild(container, gallery))
}
