import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian'
import { appearanceClass } from './model'
import { sourceCharacters, type SourceCharacter } from './sourceProjection'
import { parseMarkers, resolveQuote } from '@/editor/commentMarkers'
import {
  commentInfo,
  markerGroups,
  markerWidget,
  subscribeCommentsChanged,
  touchComments,
} from '@/editor/CommentPlugin'
import type { CommentSelection } from './service'

const QUOTE = 'data-abele-note-comment-quote'
const ICON = 'data-abele-note-comment-icon'
interface DomCharacter {
  char: string
  node: Text
  offset: number
}
const sections = new WeakMap<
  HTMLElement,
  { text: string; from: number; to: number; note: string }
>()

function characters(root: HTMLElement): DomCharacter[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const found: DomCharacter[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (
      node.parentElement?.closest(
        '.abele-comment-marker, .copy-code-button, .heading-collapse-indicator, .list-collapse-indicator, .internal-embed'
      )
    )
      continue
    const text = node.textContent ?? ''
    for (let i = 0; i < text.length; i++)
      if (!/\s/.test(text[i])) found.push({ char: text[i], node: node as Text, offset: i })
  }
  return found
}
function mapping(root: HTMLElement, text: string, from: number, to: number) {
  const projected = sourceCharacters(text.slice(from, to), from)
  const dom = characters(root)
  if (projected.map((c) => c.char).join('') !== dom.map((c) => c.char).join('')) return null
  return { projected, dom }
}
function unpaint(root: HTMLElement): void {
  for (const icon of Array.from(root.querySelectorAll(`[${ICON}]`))) icon.remove()
  for (const quote of Array.from(root.querySelectorAll(`[${QUOTE}]`)))
    quote.replaceWith(...Array.from(quote.childNodes))
  root.normalize()
}
function wrap(root: HTMLElement, chars: DomCharacter[], cls: string): void {
  const first = chars[0],
    last = chars[chars.length - 1]
  if (!first || !last) return
  const pieces = new Map<Text, { from: number; to: number }>()
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let inside = false
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === first.node) inside = true
    if (inside && !node.parentElement?.closest('.abele-comment-marker'))
      pieces.set(node as Text, {
        from: node === first.node ? first.offset : 0,
        to: node === last.node ? last.offset + 1 : (node.textContent?.length ?? 0),
      })
    if (node === last.node) break
  }
  for (const [node, range] of pieces) {
    let piece = node
    if (range.from) piece = node.splitText(range.from)
    if (range.to - range.from < piece.length) piece.splitText(range.to - range.from)
    const span = root.ownerDocument.createElement('span')
    span.className = cls
    span.setAttribute(QUOTE, '')
    piece.replaceWith(span)
    span.appendChild(piece)
  }
}
function putIcon(root: HTMLElement, char: DomCharacter | undefined, icon: HTMLElement): void {
  if (!char) {
    root.appendChild(icon)
    return
  }
  const right = char.node.splitText(char.offset + 1)
  let after: Node = char.node
  // Never let the badge inherit a link's destination, or a formatting element at its end.
  while (
    after.parentElement &&
    after.parentElement !== root &&
    after.parentElement.lastChild === after &&
    ['A', 'STRONG', 'EM', 'CODE', 'MARK', 'SPAN', 'DEL'].includes(after.parentElement.tagName)
  )
    after = after.parentElement
  if (!right.length) right.remove()
  // Remove the empty right node before climbing: splitText leaves it after our character.
  after = char.node
  while (
    after.parentElement &&
    after.parentElement !== root &&
    after.parentElement.lastChild === after &&
    ['A', 'STRONG', 'EM', 'CODE', 'MARK', 'SPAN', 'DEL'].includes(after.parentElement.tagName)
  )
    after = after.parentElement
  after.parentNode?.insertBefore(icon, after.nextSibling)
}

/** Source-section identity first, exact source → rendered projection second. No DOM quote search. */
export function paintNoteComments(
  root: HTMLElement,
  text: string,
  from: number,
  to: number,
  note = ''
): void {
  sections.set(root, { text, from, to, note })
  unpaint(root)
  const markers = parseMarkers(text)
  for (const marker of markers) {
    touchComments(note, marker.ids)
    for (const id of marker.ids) {
      const info = commentInfo(id)
      const range = resolveQuote(text, marker, info?.quote)
      if (!range || range.from >= to || range.to <= from) continue
      const map = mapping(root, text, from, to)
      if (!map) continue
      const chars = map.dom.filter(
        (_char, index) =>
          map.projected[index].source >= range.from && map.projected[index].source < range.to
      )
      wrap(
        root,
        chars,
        info?.kind === 'human' && info.appearance
          ? appearanceClass(info.appearance)
          : 'abele-comment__quote'
      )
    }
    if (marker.from < from || marker.from >= to) continue
    const map = mapping(root, text, from, to)
    const before = map?.projected.findLastIndex((char) => char.source < marker.from) ?? -1
    const groups = markerGroups(marker.ids)
    // Insert groups in reverse so adjacent kinds retain their source order.
    for (const ids of groups.reverse()) {
      const unresolved =
        !map || ids.some((id) => !resolveQuote(text, marker, commentInfo(id)?.quote))
      const icon = markerWidget(ids, unresolved).toDOM()
      icon.setAttribute(ICON, '')
      const latest = mapping(root, text, from, to)
      putIcon(root, latest?.dom[before], icon)
    }
  }
}

/** Reading-mode selection is captured in source space before the command opens a dialog. */
export function readingCommentSelection(root: HTMLElement, range: Range): CommentSelection | null {
  const section = sections.get(root)
  if (!section || !root.contains(range.startContainer) || !root.contains(range.endContainer))
    return null
  const map = mapping(root, section.text, section.from, section.to)
  if (!map) return null
  const chosen = map.dom
    .map((char, index) => {
      const point = root.ownerDocument.createRange()
      point.setStart(char.node, char.offset)
      point.setEnd(char.node, char.offset + 1)
      return range.compareBoundaryPoints(Range.START_TO_START, point) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, point) >= 0
        ? map.projected[index]
        : null
    })
    .filter((value): value is SourceCharacter => value !== null)
  if (!chosen.length) return null
  return {
    note: section.note,
    source: section.text,
    from: chosen[0].source,
    to: chosen[chosen.length - 1].sourceTo,
  }
}

export function noteCommentPostProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
  // Obsidian processes a section before attaching it to the preview DOM. The source section,
  // not an ancestor class on that detached element, distinguishes note rendering from forms.
  if (!ctx.sourcePath.endsWith('.md')) return
  const section = ctx.getSectionInfo(el)
  if (!section) return
  const lines = section.text.split('\n')
  const from = lines.slice(0, section.lineStart).reduce((sum, line) => sum + line.length + 1, 0)
  const to = from + lines.slice(section.lineStart, section.lineEnd + 1).join('\n').length
  const text = section.text
  const repaint = () => paintNoteComments(el, text, from, to, ctx.sourcePath)
  ctx.addChild(
    new (class extends MarkdownRenderChild {
      onload() {
        repaint()
        this.register(
          subscribeCommentsChanged((note) => {
            if (note === ctx.sourcePath) repaint()
          })
        )
      }
      onunload() {
        unpaint(el)
        sections.delete(el)
      }
    })(el)
  )
}

export function selectedReadingComment(view: HTMLElement, range: Range): CommentSelection | null {
  let root: HTMLElement | null =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as HTMLElement)
      : range.commonAncestorContainer.parentElement
  while (root && view.contains(root)) {
    if (sections.has(root)) return readingCommentSelection(root, range)
    root = root.parentElement
  }
  const sectionOf = (node: Node): HTMLElement | null => {
    let element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
    while (element && view.contains(element)) {
      if (sections.has(element)) return element
      element = element.parentElement
    }
    return null
  }
  const start = sectionOf(range.startContainer),
    end = sectionOf(range.endContainer)
  if (!start || !end) return null
  const a = sections.get(start)!,
    b = sections.get(end)!
  // A rerender can leave neighbouring sections on different revisions for a moment.
  if (a.note !== b.note || a.text !== b.text) return null
  const first = range.cloneRange(),
    last = range.cloneRange()
  first.setEnd(start, start.childNodes.length)
  last.setStart(end, 0)
  const from = readingCommentSelection(start, first)?.from
  const to = readingCommentSelection(end, last)?.to
  return from !== undefined && to !== undefined && from < to
    ? { note: a.note, source: a.text, from, to }
    : null
}
