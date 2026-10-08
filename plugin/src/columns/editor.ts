import { EditorView } from '@codemirror/view'
import { editorLivePreviewField, type Plugin } from 'obsidian'
import { columnPath, renderedColumns } from './target'
import { proseText } from './prose'

interface Entry {
  view: EditorView
  document: string
  anchor: number
  widget: HTMLElement
}
const contextBound = new WeakSet<HTMLElement>()

/** Resolve a native callout's block by syntax order, then its UTF-16 DOM caret offset. */
function entryAt(target: Element, x: number, y: number): Entry | null {
  if (target.closest('a,input,button,pre,table,.math,.internal-embed,svg')) return null
  const parent = target.closest<HTMLElement>('.abele-columns')
  const column = target.closest<HTMLElement>('.abele-column')
  const block = target.closest<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li')
  const editor = parent?.closest<HTMLElement>('.cm-editor')
  if (!parent || !column || !block || !editor) return null
  if (!contextBound.has(parent)) {
    contextBound.add(parent)
    parent.addEventListener(
      'contextmenu',
      (event) => {
        if (Date.now() < Number(parent.dataset.abeleTapUntil ?? 0)) {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
      },
      true
    )
  }
  const view = EditorView.findFromDOM(editor)
  if (!view || !view.state.field(editorLivePreviewField, false)) return null
  const document = view.state.doc.toString()
  const source = renderedColumns(document, view.posAtDOM(columnPath(parent).root), parent)
  if (!source) return null
  const columns = Array.from(
    parent.querySelectorAll<HTMLElement>(':scope > .callout-content > .abele-column')
  )
  const index = columns.indexOf(column)
  const parsed = source.columns[index]
  if (!parsed || columns.length !== source.columns.length) return null
  const blocks = Array.from(column.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li')).filter(
    (el) =>
      !el.closest('.internal-embed') &&
      !el.querySelector('img,.internal-embed,.math') &&
      !(el.tagName === 'LI' && Array.from(el.children).some((c) => c.matches('p')))
  )
  if (
    blocks.length !== parsed.paragraphs.length ||
    blocks.some((el, i) => el.tagName.toLowerCase() !== parsed.paragraphs[i].tag)
  )
    return null
  const at = blocks.indexOf(block)
  if (at < 0) return null
  // These are source coordinates, not text hashes or a search for a repeated passage.
  blocks.forEach((el, i) => {
    el.dataset.abeleSourceFrom = String(parsed.paragraphs[i].from)
    el.dataset.abeleSourceTo = String(parsed.paragraphs[i].to)
  })
  const paragraph = parsed.paragraphs[at]
  const doc = target.ownerDocument
  const point = doc.caretPositionFromPoint?.(x, y)
  const caret = point ? { node: point.offsetNode, offset: point.offset } : null
  const rangePoint = !caret ? doc.caretRangeFromPoint?.(x, y) : null
  const node = caret?.node ?? rangePoint?.startContainer
  const offset = caret?.offset ?? rangePoint?.startOffset
  let anchor = paragraph.from
  if (node && offset !== undefined && block.contains(node)) {
    const range = doc.createRange()
    range.selectNodeContents(block)
    range.setEnd(node, offset)
    const count = proseText(range, block.tagName === 'LI').length
    const complete = doc.createRange()
    complete.selectNodeContents(block)
    // Unknown native transformations enter at this source block's start with a single caret.
    // Only an identical grammar projection proves an exact character offset.
    if (proseText(complete, block.tagName === 'LI').trimEnd() === paragraph.text)
      anchor = paragraph.positions[count] ?? paragraph.to
  }
  return { view, document, anchor, widget: parent }
}

function reveal(entry: Entry): void {
  // A stale DOM callback must not put a caret into a different version of the note.
  if (entry.view.state.doc.toString() !== entry.document) return
  entry.widget.dataset.abeleTapUntil = String(Date.now() + 1000)
  entry.view.dispatch({
    selection: { anchor: entry.anchor },
    scrollIntoView: true,
    userEvent: 'select.pointer',
  })
  entry.view.focus()
}

export function registerColumnEntry(plugin: Plugin): void {
  const attach = (doc: Document) => {
    let touch: { entry: Entry; x: number; y: number; id: number; time: number } | null = null
    let completed: { view: EditorView; x: number; y: number; until: number } | null = null
    const suppress = (event: MouseEvent) => {
      if (
        !completed ||
        Date.now() > completed.until ||
        !completed.view.dom.contains(event.target as Node) ||
        Math.hypot(event.clientX - completed.x, event.clientY - completed.y) > 10
      )
        return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }
    // Prevent the compatibility mouse/click sequence from overwriting the touch's caret.
    plugin.registerDomEvent(doc, 'click', suppress, true)
    plugin.registerDomEvent(doc, 'mouseup', suppress, true)
    plugin.registerDomEvent(doc, 'contextmenu', suppress, true)
    plugin.registerDomEvent(
      doc,
      'pointerdown',
      (event) => {
        if (event.pointerType !== 'touch' || event.button !== 0) return
        if (!event.isPrimary) {
          touch = null
          return
        }
        const target = event.target as Element
        const entry = entryAt(target, event.clientX, event.clientY)
        if (entry)
          touch = {
            entry,
            x: event.clientX,
            y: event.clientY,
            id: event.pointerId,
            time: event.timeStamp,
          }
      },
      true
    )
    plugin.registerDomEvent(
      doc,
      'pointerup',
      (event) => {
        const pending = touch
        touch = null
        if (
          !pending ||
          pending.id !== event.pointerId ||
          event.timeStamp - pending.time > 500 ||
          Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 10
        )
          return
        event.preventDefault()
        event.stopImmediatePropagation()
        reveal(pending.entry)
        completed = {
          view: pending.entry.view,
          x: event.clientX,
          y: event.clientY,
          until: Date.now() + 500,
        }
      },
      true
    )
    plugin.registerDomEvent(
      doc,
      'pointermove',
      (event) => {
        if (touch && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10) touch = null
      },
      true
    )
    plugin.registerDomEvent(
      doc,
      'pointercancel',
      () => {
        touch = null
      },
      true
    )
    plugin.registerDomEvent(
      doc,
      'mousedown',
      (event) => {
        if (suppress(event)) return
        if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
          return
        const entry = entryAt(event.target as Element, event.clientX, event.clientY)
        if (!entry) return
        event.preventDefault()
        event.stopImmediatePropagation()
        reveal(entry)
      },
      true
    )
  }
  attach(document)
  plugin.registerEvent(
    plugin.app.workspace.on('window-open', (_window, win) => attach(win.document))
  )
}
