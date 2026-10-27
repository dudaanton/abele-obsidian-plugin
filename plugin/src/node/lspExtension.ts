import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
  type Text,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  hoverTooltip,
  closeHoverTooltips,
  tooltips,
  ViewPlugin,
} from '@codemirror/view'
import type { LspDiagnostic } from '@abele/node-protocol'
import { Menu } from 'obsidian'
import { lspFor } from './lspContext'
import type { LspPosition } from './NodeLspDocument'
import { appendLspHoverContent, lspMenuLabel } from './lspMenu'

export function lspOffset(doc: Text, position: LspPosition): number | null {
  if (position.line < 0 || position.line >= doc.lines || position.character < 0) return null
  const line = doc.line(position.line + 1)
  if (position.character > line.length) return null
  return line.from + position.character
}
const updateDiagnostics = StateEffect.define<LspDiagnostic[]>()
const diagnostics = StateField.define<LspDiagnostic[]>({
  create: () => [],
  update(value, tr) {
    if (tr.docChanged) return []
    for (const effect of tr.effects) if (effect.is(updateDiagnostics)) return effect.value
    return value
  },
})
function diagnosticText(d: LspDiagnostic) {
  return `${d.source}: ${d.message}`
}
class ProblemMarker extends GutterMarker {
  constructor(
    readonly messages: string,
    readonly warning: boolean
  ) {
    super()
  }
  toDOM(view: EditorView) {
    const mark = view.dom.ownerDocument.win.createSpan()
    mark.textContent = '●'
    mark.title = this.messages
    mark.style.color = this.warning ? 'var(--text-warning)' : 'var(--text-error)'
    return mark
  }
}

// Keep modifier state per editor, including key changes while the pointer is stationary.
const hoverModifiers = ViewPlugin.fromClass(
  class {
    active = false
    revision = 0
    private pointer?: MouseEvent
    private destroyed = false
    get overEditor() {
      return !!this.pointer
    }
    constructor(readonly view: EditorView) {
      view.dom.addEventListener('mousemove', this.move)
      view.dom.addEventListener('mouseleave', this.leave)
      // Observe modifiers before a focused pane or hotkey handler consumes the key.
      // This does not prevent the host's selection or shortcut behavior.
      view.dom.ownerDocument.addEventListener('keydown', this.key, true)
      view.dom.ownerDocument.addEventListener('keyup', this.key, true)
      view.dom.ownerDocument.defaultView?.addEventListener('blur', this.blur)
    }
    private move = (event: MouseEvent) => {
      this.pointer = event
      this.setActive(event.ctrlKey || event.metaKey || event.altKey)
      // A navigation mark can replace the event target before it reaches this listener.
      if (event.target && 'isConnected' in event.target && event.target.isConnected === false)
        queueMicrotask(() => {
          if (!this.destroyed && this.pointer === event) this.replay(event)
        })
    }
    private replay(event: MouseEvent | KeyboardEvent) {
      if (!this.pointer) return
      this.view.contentDOM.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: this.pointer.clientX,
          clientY: this.pointer.clientY,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
        })
      )
    }
    private leave = () => {
      this.pointer = undefined
      this.revision++
    }
    private setActive(active: boolean) {
      if (this.active === active) return false
      this.active = active
      this.revision++
      this.view.dispatch({ effects: closeHoverTooltips })
      return true
    }
    private key = (event: KeyboardEvent) => {
      if (!this.setActive(event.ctrlKey || event.metaKey || event.altKey) || !this.pointer) return
      // The editor content survives syntax and diagnostic token redraws.
      this.replay(event)
    }

    private blur = () => {
      this.setActive(false)
      this.pointer = undefined
    }
    destroy() {
      this.destroyed = true
      this.revision++
      this.view.dom.removeEventListener('mousemove', this.move)
      this.view.dom.removeEventListener('mouseleave', this.leave)
      this.view.dom.ownerDocument.removeEventListener('keydown', this.key, true)
      this.view.dom.ownerDocument.removeEventListener('keyup', this.key, true)
      this.view.dom.ownerDocument.defaultView?.removeEventListener('blur', this.blur)
    }
  }
)

/** Inert outside a node document; shared by readers and editors, including repository tabs. */
export function nodeLspExtension(tooltipParent: HTMLElement = document.body): Extension {
  return [
    tooltips({ parent: tooltipParent }),
    diagnostics,
    EditorView.decorations.compute([diagnostics], (state) => {
      const ranges = state.field(diagnostics).flatMap((d) => {
        const from = lspOffset(state.doc, d.range.start),
          to = lspOffset(state.doc, d.range.end)
        return from === null || to === null || to <= from
          ? []
          : [
              Decoration.mark({
                class: d.severity === 2 ? 'abele-lsp-warning' : 'abele-lsp-error',
                attributes: { title: diagnosticText(d) },
              }).range(from, to),
            ]
      })
      return Decoration.set(ranges, true)
    }),
    gutter({
      class: 'abele-lsp-gutter',
      markers(view) {
        const builder = new RangeSetBuilder<GutterMarker>()
        const lines = new Map<number, LspDiagnostic[]>()
        for (const d of view.state.field(diagnostics)) {
          const offset = lspOffset(view.state.doc, d.range.start)
          if (offset === null) continue
          const from = view.state.doc.lineAt(offset).from
          lines.set(from, [...(lines.get(from) ?? []), d])
        }
        for (const [from, items] of [...lines].sort((a, b) => a[0] - b[0]))
          builder.add(
            from,
            from,
            new ProblemMarker(
              items.map(diagnosticText).join('\n'),
              items.every((d) => d.severity === 2)
            )
          )
        return builder.finish()
      },
      domEventHandlers: {
        click(view, line, event) {
          const items = view.state
            .field(diagnostics)
            .filter((d) => d.range.start.line === view.state.doc.lineAt(line.from).number - 1)
          if (!items.length) return false
          showMessages(view, line.from, items.map(diagnosticText).join('\n'))
          event.preventDefault()
          return true
        },
      },
    }),
    hoverModifiers,
    hoverTooltip(async (view, pos) => {
      const context = lspFor(view.dom)
      if (!context?.document.supported) return null
      const line = view.state.doc.lineAt(pos)
      const raw = { line: line.number - 1, character: pos - line.from }
      const position = context.mapPosition ? context.mapPosition(raw) : raw
      if (!position) return null
      const problems = view.state.field(diagnostics).filter((d) => {
        const start = lspOffset(view.state.doc, d.range.start),
          end = lspOffset(view.state.doc, d.range.end)
        return start !== null && end !== null && pos >= start && pos <= end
      })
      const modifier = view.plugin(hoverModifiers)
      const revision = modifier?.revision
      if (!modifier?.overEditor) return null
      if (!modifier?.active && !problems.length) return null
      const text = modifier?.active
        ? await context.document.hover(position, context.text?.() ?? view.state.doc.toString())
        : ''
      // Releasing the key or leaving the editor invalidates an in-flight response.
      if (modifier?.revision !== revision) return null
      if ((!problems.length && !text) || !view.dom.isConnected) return null
      return { pos, create: () => ({ dom: messageDOM(view, problems, text) }) }
    }),
    ViewPlugin.fromClass(
      class {
        private stop?: () => void
        private destroyed = false
        constructor(readonly view: EditorView) {
          // Vue mounts the containing document context in the same render turn.
          const attach = () => {
            if (this.destroyed) return
            const context = lspFor(view.dom)
            if (!context) return
            this.stop?.()
            const refresh = () => {
              // Even an identical effect invalidates an asynchronous hover in CodeMirror.
              // Status notifications and repeated cached diagnostics must leave it intact.
              if (
                !this.destroyed &&
                JSON.stringify(view.state.field(diagnostics)) !==
                  JSON.stringify(context.mapPosition ? [] : context.document.diagnostics)
              )
                view.dispatch({
                  effects: updateDiagnostics.of(
                    context.mapPosition ? [] : context.document.diagnostics
                  ),
                })
            }
            context.document.listeners.add(refresh)
            this.stop = () => context.document.listeners.delete(refresh)
            refresh()
          }
          view.dom.ownerDocument.addEventListener('abele-lsp-context', attach)
          this.detach = () =>
            view.dom.ownerDocument.removeEventListener('abele-lsp-context', attach)
          queueMicrotask(attach)
        }
        private detach?: () => void
        destroy() {
          this.destroyed = true
          this.stop?.()
          this.detach?.()
        }
      }
    ),
    EditorView.baseTheme({
      '.abele-lsp-error': {
        textDecoration: 'underline wavy var(--text-error)',
        textUnderlineOffset: '3px',
      },
      '.abele-lsp-warning': {
        textDecoration: 'underline wavy var(--text-warning)',
        textUnderlineOffset: '3px',
      },
      '.cm-tooltip-hover:has(.abele-lsp-message)': {
        width: 'max-content',
        height: 'max-content',
        maxWidth: 'min(80ch, 90vw)',
        right: 'auto',
        bottom: 'auto',
        borderColor: 'var(--background-modifier-border)',
        backgroundColor: 'var(--background-primary)',
        borderRadius: 'var(--radius-m)',
        boxShadow: 'var(--shadow-s)',
        fontFamily: 'var(--font-interface)',
        fontSize: 'var(--font-ui-small)',
      },
      '.abele-lsp-message': {
        whiteSpace: 'normal',
        maxHeight: 'min(60vh, 32em)',
        overflowY: 'auto',
        padding: 'var(--size-4-2)',
        maxWidth: 'min(80ch, 90vw)',
        boxSizing: 'border-box',
        borderRadius: 'inherit',
        overflowWrap: 'anywhere',
        color: 'var(--text-normal)',
        backgroundColor: 'var(--background-primary)',
      },
    }),
  ]
}
function messageDOM(view: EditorView, problems: LspDiagnostic[], text: string) {
  const dom = view.dom.ownerDocument.win.createDiv()
  dom.className = 'abele-lsp-message'
  const doc = dom.ownerDocument
  for (const problem of problems) {
    const row = dom.appendChild(doc.win.createDiv())
    row.className = 'abele-lsp-problem'
    const dot = row.appendChild(doc.win.createSpan())
    dot.className = 'abele-lsp-problem__dot'
    dot.setAttribute('aria-hidden', 'true')
    dot.textContent = '●'
    dot.style.color = problem.severity === 2 ? 'var(--text-warning)' : 'var(--text-error)'
    const message = row.appendChild(doc.win.createSpan())
    message.textContent = problem.message
    const source = message.appendChild(doc.win.createSpan())
    source.className = 'abele-lsp-problem__source'
    const name =
      problem.source === 'typescript'
        ? 'TypeScript'
        : problem.source === 'eslint'
          ? 'ESLint'
          : problem.source
    source.textContent = ` · ${name}`
  }
  if (problems.length && text) dom.appendChild(doc.win.createEl('hr'))
  appendLspHoverContent(dom, text)
  return dom
}
function showMessages(view: EditorView, position: number, text: string) {
  // Native Obsidian menu gives tap users the same messages without a hover dependency.
  const menu = new Menu().setUseNativeMenu(false)
  menu.addItem((item) =>
    item.setTitle(lspMenuLabel(view.dom.ownerDocument, text)).setDisabled(true)
  )
  const coords = view.coordsAtPos(position)
  if (coords) menu.showAtPosition({ x: coords.left, y: coords.bottom }, view.dom.ownerDocument)
}
