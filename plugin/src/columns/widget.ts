import { Prec, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import {
  MarkdownRenderer,
  MarkdownRenderChild,
  type Component,
  editorInfoField,
  editorLivePreviewField,
  type Plugin,
  type App,
} from 'obsidian'
import { quoteSourceTree, type QuoteSourceRange } from './source'
import { resolveColumnTarget } from './operations'
import { setColumnRenderOrigin } from './renderOrigin'
import { columnFlight } from './flight'

/** A renderer may finish post-processing after CodeMirror has replaced its host. */
class ColumnRenderChild extends MarkdownRenderChild {
  gone = false
  onunload(): void {
    this.gone = true
  }
  addChild<T extends Component>(child: T): T {
    if (!this.gone) return super.addChild(child)
    // Renderers allocate maps, galleries and observers before registering their child.
    // Loading then unloading also disposes resources whose onload has not run yet.
    child.load()
    child.unload()
    return child
  }
}

class ColumnWidget extends WidgetType {
  constructor(
    private readonly app: App,
    private readonly text: string,
    private readonly from: number,
    private readonly to: number,
    private readonly sourcePath: string
  ) {
    super()
  }
  eq(other: ColumnWidget): boolean {
    columnFlight?.record('widget.eq', this.text.length)
    return (
      other.text === this.text &&
      other.from === this.from &&
      other.to === this.to &&
      other.sourcePath === this.sourcePath
    )
  }
  toDOM(view: EditorView): HTMLElement {
    columnFlight?.view('widget.toDOM.in', view)
    const host = view.dom.ownerDocument.win.createDiv({
      cls: 'cm-embed-block cm-callout abele-columns-editor-widget',
    })
    const rendered = host.createDiv({ cls: 'markdown-rendered' })
    setColumnRenderOrigin(rendered, this.text, this.from, this.to)
    const child = new ColumnRenderChild(host)
    child.load()
    lifetimes.set(host, child)
    // The ordinary renderer still supplies links, diagrams, math, embeds and post-processors.
    columnFlight?.view('widget.render.in', view)
    const rendering = MarkdownRenderer.render(
      this.app,
      this.text.slice(this.from, this.to),
      rendered,
      this.sourcePath,
      child
    )
    columnFlight?.view('widget.render.return', view)
    if (columnFlight)
      void rendering.then(
        () => columnFlight?.view('widget.render.done', view),
        () => columnFlight?.view('widget.render.failed', view)
      )
    void rendering.catch((error: unknown) => {
      if (child.gone) return
      child.unload()
      rendered.empty()
      rendered.createEl('p', {
        text: 'Could not render columns. Open the source to edit this area.',
      })
      console.error('Abele: column rendering failed', error)
    })
    host.addEventListener(
      'click',
      (event) => {
        const input = (event.target as Element).closest<HTMLInputElement>(
          'input.task-list-item-checkbox'
        )
        if (!input || input.closest('.internal-embed')) return
        const at = Number(input.dataset.abeleTaskAt)
        if (
          input.dataset.abeleTaskAt === undefined ||
          !Number.isInteger(at) ||
          at < this.from ||
          at >= this.to ||
          view.state.doc.toString() !== this.text
        )
          return
        const marker = this.text[at]
        if (this.text[at - 1] !== '[' || this.text[at + 1] !== ']' || !/[ xX]/.test(marker)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        columnFlight?.view('dispatch.checkbox.in', view)
        view.dispatch({
          changes: { from: at, to: at + 1, insert: marker === ' ' ? 'x' : ' ' },
          userEvent: 'input',
        })
        columnFlight?.view('dispatch.checkbox.out', view)
      },
      true
    )
    columnFlight?.view('widget.toDOM.out', view)
    return host
  }
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    columnFlight?.view('widget.updateDOM', view)
    return super.updateDOM(dom, view)
  }
  ignoreEvent(): boolean {
    return true
  }
  destroy(host: HTMLElement): void {
    columnFlight?.record('widget.destroy.in', this.text.length)
    lifetimes.get(host)?.unload()
    lifetimes.delete(host)
    columnFlight?.record('widget.destroy.out', this.text.length)
  }
}
const lifetimes = new WeakMap<HTMLElement, ColumnRenderChild>()

export function registerColumnWidgets(plugin: Plugin): void {
  const field = StateField.define<DecorationSet>({
    create: (state) => {
      columnFlight?.state('field.create', state)
      return build(state)
    },
    update: (value, tr) => {
      columnFlight?.state('field.update.in', tr.state)
      try {
        return tr.docChanged ||
          tr.selection ||
          tr.state.field(editorLivePreviewField, false) !==
            tr.startState.field(editorLivePreviewField, false)
          ? build(tr.state)
          : value
      } finally {
        columnFlight?.state('field.update.out', tr.state)
      }
    },
    provide: (field) => EditorView.decorations.from(field),
  })
  const build = (state: import('@codemirror/state').EditorState): DecorationSet => {
    columnFlight?.state('decorations.build.in', state)
    if (!state.field(editorLivePreviewField, false)) {
      columnFlight?.state('decorations.build.source', state)
      return Decoration.none
    }
    const text = state.doc.toString(),
      path = state.field(editorInfoField, false)?.file?.path ?? ''
    const decorations: ReturnType<Decoration['range']>[] = []
    const visit = (nodes: QuoteSourceRange[]) => {
      for (const node of nodes) {
        columnFlight?.state('decorations.frame.in', state)
        const frame =
          node.callout === 'abele-columns' ? resolveColumnTarget(text, node.from, node) : null
        columnFlight?.state('decorations.frame.resolved', state)
        if (frame) {
          if (
            !state.selection.ranges.some(
              (range) => range.from <= frame.to && range.to >= frame.from
            )
          )
            decorations.push(
              Decoration.replace({
                block: true,
                widget: new ColumnWidget(plugin.app, text, frame.from, frame.to, path),
              }).range(frame.from, frame.to)
            )
        } else visit(node.children)
      }
    }
    visit(quoteSourceTree(text))
    const result = Decoration.set(decorations, true)
    columnFlight?.state('decorations.build.out', state)
    return result
  }
  plugin.registerEditorExtension(Prec.highest(field))
}
