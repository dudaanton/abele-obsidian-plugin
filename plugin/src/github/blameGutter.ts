/** CodeMirror owns the virtualized rows; Vue owns only the range headers currently drawn. */
import { GutterMarker, gutter, type EditorView } from '@codemirror/view'
import { rangeAt, type BlameRange } from './blame'

export interface BlameHost {
  element: HTMLElement
  range: BlameRange
}
export interface BlameGutter {
  ranges: readonly BlameRange[]
  add(host: BlameHost): void
  remove(element: HTMLElement): void
}

export function blameGutter(options: BlameGutter) {
  class Marker extends GutterMarker {
    constructor(
      readonly attribution: BlameRange,
      readonly header: boolean
    ) {
      super()
    }
    eq(other: Marker) {
      return this.attribution === other.attribution && this.header === other.header
    }
    toDOM(view: EditorView) {
      const el = view.dom.ownerDocument.win.createDiv()
      el.className = this.header ? 'abele-github-blame__start' : 'abele-github-blame__continuation'
      if (this.header) options.add({ element: el, range: this.attribution })
      return el
    }
    destroy(dom: Node) {
      if (this.header) options.remove(dom as HTMLElement)
    }
  }
  return gutter({
    class: 'abele-github-blame',
    lineMarker(view, block) {
      const line = view.state.doc.lineAt(block.from).number
      const range = rangeAt(options.ranges, line)
      if (!range) return null
      return new Marker(range, line === range.start || block.from === view.viewport.from)
    },
    lineMarkerChange: (update) => update.viewportChanged,
  })
}
