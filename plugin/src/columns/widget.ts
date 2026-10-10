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
    return (
      other.text === this.text &&
      other.from === this.from &&
      other.to === this.to &&
      other.sourcePath === this.sourcePath
    )
  }
  toDOM(view: EditorView): HTMLElement {
    const host = view.dom.ownerDocument.win.createDiv({
      cls: 'cm-embed-block cm-callout abele-columns-editor-widget',
    })
    const rendered = host.createDiv({ cls: 'markdown-rendered' })
    setColumnRenderOrigin(rendered, this.text, this.from, this.to)
    const child = new ColumnRenderChild(host)
    child.load()
    lifetimes.set(host, child)
    // The ordinary renderer still supplies links, diagrams, math, embeds and post-processors.
    void MarkdownRenderer.render(
      this.app,
      this.text.slice(this.from, this.to),
      rendered,
      this.sourcePath,
      child
    ).catch((error: unknown) => {
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
        view.dispatch({
          changes: { from: at, to: at + 1, insert: marker === ' ' ? 'x' : ' ' },
          userEvent: 'input',
        })
      },
      true
    )
    return host
  }
  ignoreEvent(): boolean {
    return true
  }
  destroy(host: HTMLElement): void {
    lifetimes.get(host)?.unload()
    lifetimes.delete(host)
  }
}
const lifetimes = new WeakMap<HTMLElement, ColumnRenderChild>()

export function registerColumnWidgets(plugin: Plugin): void {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state),
    update: (value, tr) =>
      tr.docChanged ||
      tr.selection ||
      tr.state.field(editorLivePreviewField, false) !==
        tr.startState.field(editorLivePreviewField, false)
        ? build(tr.state)
        : value,
    provide: (field) => EditorView.decorations.from(field),
  })
  const build = (state: import('@codemirror/state').EditorState): DecorationSet => {
    if (!state.field(editorLivePreviewField, false)) return Decoration.none
    const text = state.doc.toString(),
      path = state.field(editorInfoField, false)?.file?.path ?? ''
    const decorations: ReturnType<Decoration['range']>[] = []
    const visit = (nodes: QuoteSourceRange[]) => {
      for (const node of nodes) {
        const frame =
          node.callout === 'abele-columns' ? resolveColumnTarget(text, node.from, node) : null
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
    return Decoration.set(decorations, true)
  }
  plugin.registerEditorExtension(Prec.highest(field))
}
