/**
 * Human interaction over the existing shared document. Every change applies in memory at once,
 * one undo step each; writing the file is batched by the write scheduler, later and less often.
 */
import { nanoid } from 'nanoid'
import { editCanvas, type CanvasOperation, type NodeInput } from './core/edit'
import { canvasFingerprint, SHAPES, type Shape } from './core/model'
import { linesOf } from './core/primitives'
import { allInkEntries, inkEntries } from './core/ink'
import { canvasVisibility } from './core/visibility'
import type { CanvasSession, GraphTransform } from './core/session'
import { CanvasSessionError } from './core/session'
import {
  CANVAS_TEXT_SCHEDULE,
  CanvasWriteScheduler,
  type CanvasWriteSchedule,
} from './core/writeScheduler'
import type { CanvasViewer } from './Viewer'
import { CanvasInput, type CanvasInputTool } from './input'
import { WIDTHS } from '../drawing/model'
import { THICKNESSES, type Thickness } from '../ink/thickness'

export interface CanvasEditorDocument {
  session: CanvasSession
  file: { path: string }
  draftPath: string | null
  error: string | null
  recovery: unknown
  state: { native: boolean; conflict: boolean }
  writes: { flush(): Promise<boolean> } | null
  beginDraft(): void
  updateDraft(transform: GraphTransform): void
  finishDraft(): void
  cancelDraft(): void
  undoLocal(): void
  redoLocal(): void
  discardDraft(): void
  releaseWriter(retainPending?: boolean): void
}
export interface CanvasEditorPorts {
  document(): CanvasEditorDocument | null
  /** Writes the document's unwritten human work to its file. */
  publish(document: CanvasEditorDocument): Promise<unknown>
  /** When unwritten work is written; tests shorten it. */
  schedule?: CanvasWriteSchedule
  /** When typed card text becomes a step and is written; tests lengthen or shorten it. */
  textSchedule?: CanvasWriteSchedule
  pickFile(): Promise<string | null>
  pickLink(): Promise<string | null>
  confirmDiscard(): Promise<boolean>
  handoffChoice(): Promise<'stay' | 'retain' | 'discard'>
  notice(message: string): void
}
export class CanvasEditor {
  private selected = new Set<string>()
  private multiple = false
  private tool: CanvasInputTool = 'select'
  private readonly palette: HTMLElement
  private readonly inkControls: HTMLElement
  private readonly inkSelectionControls: HTMLDetailsElement
  private readonly inkAttachment: HTMLSelectElement
  private readonly inkColor: HTMLSelectElement
  private readonly inkSize: HTMLSelectElement
  private readonly shape: HTMLSelectElement
  private readonly shapeColor: HTMLSelectElement
  private readonly properties: HTMLDetailsElement
  private readonly label: HTMLInputElement
  private readonly fromEnd: HTMLSelectElement
  private readonly toEnd: HTMLSelectElement
  private readonly routing: HTMLSelectElement
  private readonly color: HTMLSelectElement
  private propertyBaseline = ''
  private propertyId = ''
  private readonly inputAdapter: CanvasInput
  private geometry: { document: CanvasEditorDocument; generation: number; path: string } | null =
    null
  private editing: string | null = null
  private ownedDraft: CanvasEditorDocument | null = null
  private composing = false
  private textTimer: number | null = null
  private textFirst: number | null = null
  private waiting = false
  private destroyed = false
  private readonly writes: CanvasWriteScheduler<CanvasEditorDocument>
  /** The last batched write failed with the work still in memory; Retry and Discard show. */
  private writeFailed: CanvasEditorDocument | null = null
  private flushHook: { document: CanvasEditorDocument; flush(): Promise<boolean> } | null = null
  private readonly bar: HTMLElement
  private readonly panel: HTMLElement
  private readonly text: HTMLTextAreaElement
  private readonly status: HTMLElement
  private readonly buttons = new Map<string, HTMLButtonElement>()
  private readonly off: (() => void)[] = []

  constructor(
    readonly viewer: CanvasViewer,
    private readonly ports: CanvasEditorPorts
  ) {
    this.writes = new CanvasWriteScheduler<CanvasEditorDocument>(
      {
        pending: (document) => this.writable(document),
        write: (document) => {
          console.debug('[abele] canvas: writing batched changes', {
            steps: document.session.pendingSteps,
          })
          return this.ports.publish(document)
        },
        failed: (document, error) => {
          // A local edit begun while the write was being prepared only postpones it.
          if (
            error instanceof CanvasSessionError &&
            (error.code === 'busy' || error.code === 'stale') &&
            !document.session.conflict &&
            !document.session.publicationOutcome
          ) {
            this.writes.changed(document)
            return
          }
          this.writeFailed = document
          this.fail(error)
        },
      },
      {
        set: (run, ms) => viewer.el.ownerDocument.defaultView.setTimeout(run, ms),
        clear: (id) => viewer.el.ownerDocument.defaultView.clearTimeout(id),
      },
      ports.schedule
    )
    const doc = viewer.el.ownerDocument
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
      doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K]
    this.bar = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    this.bar.className = 'abele-canvas-controls abele-canvas-editor-controls'
    this.panel = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    this.panel.className = 'abele-canvas-text-editor'
    this.text = doc.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'textarea'
    ) as HTMLTextAreaElement
    this.text.rows = 4
    this.text.setAttribute('aria-label', 'Canvas card text')
    this.panel.append(this.text)
    this.status = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    this.status.className = 'abele-canvas-status abele-canvas-editor-status'
    this.status.setAttribute('role', 'status')
    viewer.el.insertBefore(this.bar, viewer.stage)
    viewer.el.insertBefore(this.panel, viewer.stage)
    viewer.el.insertBefore(this.status, viewer.stage)
    this.palette = make('div')
    this.palette.className = 'abele-canvas-controls abele-canvas-shape-controls'
    this.palette.hidden = true
    viewer.el.insertBefore(this.palette, viewer.stage)
    this.button('Shapes and connections', 'Shapes and lines', () => {
      this.inputAdapter.cancel()
      this.inkControls.hidden = true
      this.tool = 'select'
      this.palette.hidden = !this.palette.hidden
      this.refresh()
    })
    this.inkControls = make('div')
    this.inkControls.className = 'abele-canvas-controls abele-canvas-shape-controls'
    this.inkControls.hidden = true
    viewer.el.insertBefore(this.inkControls, viewer.stage)
    this.button('Canvas drawing tools', 'Drawing', () => {
      this.inputAdapter.cancel()
      this.inkControls.hidden = !this.inkControls.hidden
      this.palette.hidden = true
      if (this.inkControls.hidden) this.tool = 'select'
      this.refresh()
    })
    for (const [tool, label, text] of [
      ['pan', 'Navigate canvas', 'Navigate'],
      ['pen', 'Draw with pen', 'Pen'],
      ['marker', 'Draw with marker', 'Marker'],
      ['eraser', 'Erase whole strokes', 'Eraser'],
      ['partial-eraser', 'Erase part of strokes', 'Partial eraser'],
      ['lasso', 'Lasso canvas objects', 'Lasso'],
    ] as const)
      this.button(
        label,
        text,
        () => {
          this.inputAdapter.cancel()
          this.selected.clear()
          this.tool = tool
          this.multiple = false
          this.refresh()
        },
        this.inkControls
      )
    this.inkColor = this.select(this.inkControls, 'Canvas ink color', this.colorOptions())
    this.inkSize = this.select(
      this.inkControls,
      'Canvas ink thickness',
      THICKNESSES.map((t) => [t, t])
    )
    this.inkSize.value = 'medium'
    this.inkSelectionControls = make('details')
    this.inkSelectionControls.className = 'abele-canvas-ink-selection'
    const inkSummary = make('summary')
    inkSummary.textContent = 'Selection actions'
    this.inkSelectionControls.append(inkSummary)
    const inkActions = make('div')
    inkActions.className = 'abele-canvas-controls'
    this.inkSelectionControls.append(inkActions)
    this.inkControls.append(this.inkSelectionControls)
    this.button(
      'Toggle lasso multiple selection',
      'Select multiple',
      () => {
        this.multiple = !this.multiple
        this.refresh()
      },
      inkActions
    )
    this.button('Delete canvas selection', 'Delete', () => this.remove(), inkActions)
    this.button('Group canvas selection', 'Group', () => this.group(), inkActions)
    this.button('Ungroup canvas selection', 'Ungroup', () => this.group(true), inkActions)
    this.button(
      'Recolor canvas selection',
      'Apply color',
      () => this.inkAction('color'),
      inkActions
    )
    this.button('Detach selected ink', 'Detach ink', () => this.inkAction('detach'), inkActions)
    this.inkAttachment = this.select(inkActions, 'Ink attachment card', [
      ['', 'Selected card or choose attachment'],
    ])
    this.button('Attach selected ink', 'Attach ink', () => this.inkAction('attach'), inkActions)
    this.shape = this.select(
      this.palette,
      'Canvas shape',
      SHAPES.map((s) => [s, s.replace(/-/g, ' ')])
    )
    this.shapeColor = this.select(this.palette, 'Shape color', this.colorOptions())
    this.button('Apply selected shape', 'Change shape', () => this.applyShape(), this.palette)
    this.button(
      'Add canvas shape',
      'Add shape',
      () => this.addText(this.shape.value as Shape),
      this.palette
    )
    for (const [tool, label, text] of [
      ['select', 'Select canvas objects', 'Select'],
      ['connect', 'Draw connection', 'Connect'],
      ['line', 'Draw free line', 'Line'],
      ['arrow', 'Draw free arrow', 'Arrow'],
    ] as const)
      this.button(
        label,
        text,
        () => {
          this.inputAdapter.cancel()
          this.tool = tool
          this.multiple = false
          this.refresh()
        },
        this.palette
      )
    this.properties = make('details')
    this.properties.className = 'abele-canvas-connection-properties'
    const summary = make('summary')
    summary.textContent = 'Connection style'
    this.properties.append(summary)
    const fields = make('div')
    fields.className = 'abele-canvas-controls'
    this.properties.append(fields)
    this.label = make('input')
    this.label.type = 'text'
    this.label.setAttribute('aria-label', 'Connection label')
    this.label.placeholder = 'Connection label'
    fields.append(this.label)
    this.button('Apply connection style', 'Apply', () => this.applyConnection(), fields)
    this.fromEnd = this.select(fields, 'Start arrow', [
      ['none', 'Start: no arrow'],
      ['arrow', 'Start: arrow'],
    ])
    this.toEnd = this.select(fields, 'End arrow', [
      ['none', 'End: no arrow'],
      ['arrow', 'End: arrow'],
    ])
    this.routing = this.select(fields, 'Connection routing', [
      ['bezier', 'Curved'],
      ['square', 'Elbow'],
      ['direct', 'Straight'],
    ])
    this.color = this.select(fields, 'Connection color', this.colorOptions())
    this.button(
      'Reverse connection arrows',
      'Reverse arrows',
      () => {
        const start = this.fromEnd.value
        this.fromEnd.value = this.toEnd.value
        this.toEnd.value = start
        return this.applyConnection()
      },
      fields
    )
    viewer.el.insertBefore(this.properties, viewer.stage)
    this.button('Add text card', 'Text', () => this.addText())
    this.button('Add note or attachment', 'File', () => this.pick('file'))
    this.button('Add link', 'Link', () => this.pick('link'))
    this.button('Edit card text', 'Edit text', () => this.editText())
    this.button('Open selected card', 'Open', () => {
      const node = this.node()
      if (node) viewer.openNode(node)
    })
    this.button('Delete selected card', 'Delete', () => this.remove())
    this.button('Toggle multiple selection', 'Select multiple', () => {
      this.multiple = !this.multiple
      this.refresh()
    })
    this.button('Group selected cards', 'Group', () => this.group())
    this.button('Ungroup selected group', 'Ungroup', () => this.group(true))
    this.button('Undo canvas change', 'Undo', () => this.history('undo'))
    this.button('Redo canvas change', 'Redo', () => this.history('redo'))
    this.button('Retry save', 'Retry save', () => this.retry())
    this.button('Discard local draft', 'Discard draft…', () => this.discard())
    this.listen(this.text, 'compositionstart', () => {
      this.composing = true
      this.refresh()
    })
    this.listen(this.text, 'compositionend', () => {
      this.composing = false
      this.input()
      this.refresh()
    })
    this.listen(this.text, 'input', () => this.input())
    // Leaving the field writes the text; the card stays open until the canvas is tapped.
    this.listen(this.text, 'blur', () => void this.saveText())
    this.listen(this.text, 'keydown', (event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      void this.finishText()
    })
    this.inputAdapter = new CanvasInput(viewer, {
      tool: () => this.tool,
      brush: () => ({
        color: this.inkColor.value,
        size: WIDTHS[this.tool === 'marker' ? 'marker' : 'pen'][this.inkSize.value as Thickness],
      }),
      enabled: () => this.canGesture(),
      selection: () => this.selected,
      select: (ids) => {
        this.selected = ids
        this.refresh()
      },
      multiple: () => this.multiple,
      begin: () => {
        try {
          const document = this.ready()
          this.geometry = {
            document,
            generation: document.session.generation,
            path: document.file.path,
          }
          document.beginDraft()
          this.geometry.generation = document.session.generation
          this.refresh()
          return true
        } catch (error) {
          this.geometry = null
          this.fail(error)
          return false
        }
      },
      valid: () => this.validGeometry(),
      complete: (ops) => {
        void this.completeGeometry(ops).catch((error) => this.fail(error))
      },
      cancel: () => this.cancelGeometry(),
      invalid: (error) => this.fail(error),
    })
    viewer.onSelect = (node) => {
      if (this.waiting) return
      // Tapping the canvas ends text editing, as leaving a note does; the text is written.
      if (this.editing) {
        if (this.composing) return
        void this.finishText()
      }
      this.selected = new Set(node ? [node.id] : [])
      this.refresh()
    }
    viewer.onEditorKey = (event) => this.key(event)
    // Leaving the window or the app writes at once: a phone may stop it in the background.
    const view = doc.defaultView
    if (view) {
      const leave = (): void => void this.flush()
      view.addEventListener('blur', leave)
      this.off.push(() => view.removeEventListener('blur', leave))
      const hidden = (): void => {
        if (doc.visibilityState === 'hidden') void this.flush()
      }
      doc.addEventListener('visibilitychange', hidden)
      this.off.push(() => doc.removeEventListener('visibilitychange', hidden))
    }
    this.refresh()
  }
  private listen(el: HTMLElement, type: string, fn: EventListener): void {
    el.addEventListener(type, fn)
    this.off.push(() => el.removeEventListener(type, fn))
  }
  private colorOptions(): [string, string][] {
    return [
      ['', 'Default color'],
      ...['1', '2', '3', '4', '5', '6'].map((v, i): [string, string] => [
        v,
        ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Purple'][i],
      ]),
    ]
  }
  private select(
    parent: HTMLElement,
    label: string,
    options: readonly (readonly [string, string])[]
  ): HTMLSelectElement {
    const select = parent.ownerDocument.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'select'
    ) as HTMLSelectElement
    select.setAttribute('aria-label', label)
    select.title = label
    for (const [value, text] of options) {
      const option = parent.ownerDocument.createElementNS(
        'http://www.w3.org/1999/xhtml',
        'option'
      ) as HTMLOptionElement
      option.value = value
      option.textContent = text
      select.append(option)
    }
    parent.append(select)
    return select
  }
  private button(label: string, text: string, action: () => unknown, parent = this.bar): void {
    const button = this.bar.ownerDocument.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'button'
    ) as HTMLButtonElement
    button.type = 'button'
    button.textContent = text
    button.setAttribute('aria-label', label)
    button.title = label
    parent.append(button)
    this.buttons.set(label, button)
    this.listen(button, 'click', () => {
      if (button.disabled) return
      try {
        Promise.resolve(action()).catch((error) => this.fail(error))
      } catch (error) {
        this.fail(error)
      }
    })
  }
  private fail(error: unknown): void {
    this.ports.notice(
      `Canvas change did not complete: ${error instanceof Error ? error.message : 'Local failure'}`
    )
    this.refresh()
  }
  private node() {
    return this.selected.size === 1
      ? this.ports.document()?.session.graph.nodes.find((node) => this.selected.has(node.id))
      : undefined
  }
  /**
   * A new local change may start: unwritten earlier changes and a write in flight do not stop
   * it. A conflict, an uncertain or failed agent write, a rename in progress or native Canvas do.
   */
  private editable(document: CanvasEditorDocument | null): boolean {
    const session = document?.session
    return (
      !!document &&
      !this.destroyed &&
      !this.waiting &&
      !document.state.native &&
      !document.state.conflict &&
      !document.error &&
      !document.recovery &&
      !session.conflict &&
      !session.publicationOutcome &&
      !session.draft?.active &&
      // Someone else's write (an agent's) is landing; local edits would not build on it.
      !session.foreignPublication &&
      (!session.dirty || document.draftPath === document.file.path)
    )
  }
  /** Unwritten human work the scheduler may write now. */
  private writable(document: CanvasEditorDocument): boolean {
    const session = document.session
    // A gesture still in progress is left out of the write and goes with the next one.
    return (
      session.dirty &&
      (session.pendingSteps > 0 || !session.draft?.active) &&
      !session.writing &&
      !session.conflict &&
      !session.publicationOutcome &&
      !document.recovery &&
      !document.error &&
      !document.state.native &&
      !document.state.conflict &&
      document.draftPath === document.file.path
    )
  }
  /** A local change was made: show it now, write it later. */
  private changed(document: CanvasEditorDocument): void {
    if (this.writeFailed === document && !document.session.dirty) this.writeFailed = null
    this.writes.changed(document)
    this.refresh()
  }
  /** Writes all unwritten work now; false when some is still only in memory. */
  async flush(): Promise<boolean> {
    const document = this.ports.document()
    if (!document) return true
    const ok = await this.writes.flush(document)
    if (ok && this.writeFailed === document) this.writeFailed = null
    if (!this.destroyed) this.refresh()
    return ok
  }
  private canGesture(): boolean {
    return !this.editing && (this.editable(this.ports.document()) || this.validGeometry())
  }
  private validGeometry(): boolean {
    const g = this.geometry
    // The gesture's own draft; a write of earlier changes landing meanwhile does not end it.
    return (
      !!g &&
      this.ports.document() === g.document &&
      g.path === g.document.file.path &&
      !!g.document.session.draft?.active &&
      !g.document.session.conflict &&
      !g.document.state.conflict &&
      !g.document.state.native &&
      !g.document.error
    )
  }
  private cancelGeometry(): void {
    const g = this.geometry
    this.geometry = null
    if (g?.document.session.draft?.active) g.document.cancelDraft()
  }
  private async completeGeometry(ops: CanvasOperation[]): Promise<void> {
    const g = this.geometry
    if (!this.validGeometry()) {
      this.cancelGeometry()
      return
    }
    this.geometry = null
    try {
      this.update(g.document, ops)
      for (const op of ops) {
        if (op.op === 'connect') this.selected = new Set([op.edge.id])
        if (op.op === 'add_line') this.selected = new Set([op.line.id])
      }
      g.document.finishDraft()
    } catch (error) {
      if (g.document.session.draft?.active) g.document.cancelDraft()
      throw error
    }
    this.changed(g.document)
  }
  private ready(): CanvasEditorDocument {
    const document = this.ports.document()
    if (!this.editable(document))
      throw new Error('Canvas is busy or has retained pending work; settle it before editing')
    if (this.viewer.step !== null) this.viewer.go(null, false)
    return document
  }
  private update(document: CanvasEditorDocument, ops: CanvasOperation[]): void {
    document.updateDraft((graph) => editCanvas(graph, ops).graph)
  }
  /** One local change, one undo step, written with the next batch. */
  private commit(document: CanvasEditorDocument, ops: CanvasOperation[]): void {
    document.beginDraft()
    try {
      this.update(document, ops)
      document.finishDraft()
    } catch (error) {
      if (document.session.draft?.active) document.cancelDraft()
      throw error
    }
    this.changed(document)
  }
  private location(): { x: number; y: number } {
    const region = this.viewer.visible()
    // Small stagger prevents newly inserted cards hiding every previous card.
    const offset = ((this.ports.document()?.session.graph.nodes.length ?? 0) % 5) * 32
    return {
      x: region.x + region.width / 2 - 130 + offset,
      y: region.y + region.height / 2 - 80 + offset,
    }
  }
  private addText(shape?: Shape): void {
    const document = this.ready(),
      id = nanoid()
    document.beginDraft()
    this.ownedDraft = document
    this.update(document, [
      {
        op: 'add_node',
        node: {
          id,
          kind: shape ? 'shape' : 'text',
          shape,
          ...(shape && this.shapeColor.value ? { color: this.shapeColor.value } : {}),
          label: '',
          ...this.location(),
        },
      },
    ])
    this.selected = new Set([id])
    this.tool = 'select'
    this.palette.hidden = true
    this.showText(id)
  }
  private showText(id: string): void {
    this.editing = id
    this.text.value = this.node()?.text ?? ''
    this.refresh()
    this.text.focus()
  }
  private editText(): void {
    const document = this.ports.document(),
      node = this.node()
    if (
      !document ||
      node?.type !== 'text' ||
      document.state.native ||
      document.error ||
      document.session.conflict ||
      !this.editable(document)
    )
      return
    document.beginDraft()
    this.ownedDraft = document
    this.showText(node.id)
  }
  /** The field's text goes into the open draft at once; it is written after a pause. */
  private input(): void {
    if (!this.applyText()) return
    if (this.composing) return
    const now = Date.now(),
      schedule = this.ports.textSchedule ?? CANVAS_TEXT_SCHEDULE,
      view = this.viewer.el.ownerDocument.defaultView
    this.textFirst ??= now
    if (this.textTimer !== null) view.clearTimeout(this.textTimer)
    const delay = Math.max(0, Math.min(schedule.idle, this.textFirst + schedule.max - now))
    this.textTimer = view.setTimeout(() => {
      this.textTimer = null
      void this.saveText()
    }, delay)
  }
  private applyText(): boolean {
    if (!this.editing || !this.ownedDraft || this.ports.document() !== this.ownedDraft) return false
    try {
      this.update(this.ownedDraft, [
        { op: 'update', id: this.editing, patch: { text: this.text.value } },
      ])
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }
  private clearText(): void {
    if (this.textTimer !== null)
      this.viewer.el.ownerDocument.defaultView.clearTimeout(this.textTimer)
    this.textTimer = null
    this.textFirst = null
  }
  /**
   * The text typed so far becomes one undo step, and editing goes on in a new draft of the same
   * card. An unchanged text adds no step, so it neither writes nor clears redo.
   */
  private settleText(): CanvasEditorDocument | null {
    const document = this.ownedDraft
    if (
      !this.editing ||
      this.composing ||
      !document ||
      this.ports.document() !== document ||
      !document.session.draft?.active
    )
      return null
    this.clearText()
    this.applyText()
    try {
      document.finishDraft()
    } catch (error) {
      this.fail(error)
      return null
    }
    try {
      document.beginDraft()
    } catch (error) {
      // The card cannot stay open (another writer is landing); what was typed is kept.
      this.editing = null
      this.ownedDraft = null
      this.text.blur()
      this.fail(error)
    }
    this.changed(document)
    return document
  }
  /** Typing paused or the field was left: write the text now, keep the card open. */
  private async saveText(): Promise<void> {
    if (this.waiting || this.destroyed || !this.settleText()) return
    await this.flush()
  }
  /** Ends text editing: the text is one last step, if it changed since the previous one. */
  private endText(): CanvasEditorDocument | null {
    if (!this.editing) return null
    this.clearText()
    this.applyText()
    const document = this.ownedDraft
    this.editing = null
    this.ownedDraft = null
    this.composing = false
    try {
      if (document?.session.draft?.active) document.finishDraft()
    } catch (error) {
      this.fail(error)
    }
    this.text.blur()
    if (document) this.changed(document)
    else this.refresh()
    return document
  }
  private async finishText(): Promise<void> {
    if (this.waiting || this.composing) return
    const document = this.endText()
    if (document && this.ports.document() === document && !this.destroyed) await this.flush()
  }
  private async saving(action: () => Promise<unknown>): Promise<void> {
    this.waiting = true
    this.refresh()
    try {
      await action()
    } finally {
      this.waiting = false
      this.refresh()
    }
  }
  private async retry(): Promise<void> {
    const document = this.ports.document()
    if (!document || this.waiting || !this.writable(document)) return
    await this.flush()
  }
  private async pick(kind: 'file' | 'link'): Promise<void> {
    const document = this.ready(),
      generation = document.session.generation,
      path = document.file.path
    await this.saving(async () => {
      const value = await (kind === 'file' ? this.ports.pickFile() : this.ports.pickLink())
      if (!value) return
      if (
        this.destroyed ||
        this.ports.document() !== document ||
        document.session.generation !== generation ||
        document.file.path !== path ||
        document.state.native
      )
        throw new Error('Canvas changed while the picker was open; pick again')
      const node: NodeInput = {
        id: nanoid(),
        kind: kind === 'file' ? 'note' : 'link',
        ...this.location(),
        ...(kind === 'file' ? { file: value } : { url: value }),
      }
      this.commit(document, [{ op: 'add_node', node }])
      this.selected = new Set([node.id])
    })
    this.refresh()
  }
  private async applyShape(): Promise<void> {
    const document = this.ready(),
      node = this.node()
    if (node?.type !== 'text') return
    const ops: CanvasOperation[] = [
      {
        op: 'update',
        id: node.id,
        patch: { color: this.shapeColor.value, styleAttributes: { shape: this.shape.value } },
      },
    ]
    if (
      canvasFingerprint(editCanvas(document.session.graph, ops).graph) ===
      canvasFingerprint(document.session.graph)
    )
      return
    this.commit(document, ops)
  }
  private connection() {
    if (this.selected.size !== 1) return undefined
    const graph = this.ports.document()?.session.graph
    return (
      graph?.edges.find((e) => this.selected.has(e.id)) ??
      linesOf(graph ?? { nodes: [], edges: [] }).find((l) => this.selected.has(l.id))
    )
  }
  private async applyConnection(): Promise<void> {
    const document = this.ready(),
      element = this.connection()
    if (!element) return
    if (JSON.stringify(element) !== this.propertyBaseline)
      throw new Error('Connection changed; select it again before applying its style')
    const patch: Record<string, unknown> = {}
    const changed = (key: string, value: string, previous: unknown) => {
      if (value !== previous) patch[key] = value
    }
    changed('label', this.label.value, element.label ?? '')
    changed('fromEnd', this.fromEnd.value, element.fromEnd ?? 'none')
    changed('toEnd', this.toEnd.value, element.toEnd ?? ('fromNode' in element ? 'arrow' : 'none'))
    if (this.color.value !== '__retain') changed('color', this.color.value, element.color ?? '')
    if ('fromNode' in element)
      changed('pathfindingMethod', this.routing.value, element.pathfindingMethod ?? 'bezier')
    if (!Object.keys(patch).length) {
      this.label.blur()
      return
    }
    if (
      canvasFingerprint(
        editCanvas(document.session.graph, [{ op: 'update', id: element.id, patch }]).graph
      ) === canvasFingerprint(document.session.graph)
    )
      return
    // Release the keyboard before draft notifications disable the field.
    this.label.blur()
    this.commit(document, [{ op: 'update', id: element.id, patch }])
    this.propertyBaseline = JSON.stringify(this.connection())
  }
  private async inkAction(action: 'color' | 'detach' | 'attach'): Promise<void> {
    const document = this.ready(),
      graph = document.session.graph,
      entries = allInkEntries(graph).filter((e) => this.selected.has(e.stroke.id)),
      cards = graph.nodes.filter((n) => this.selected.has(n.id)),
      target = this.inkAttachment.value || (cards.length === 1 ? cards[0].id : '')
    const ops: CanvasOperation[] =
      action === 'color'
        ? [
            ...entries.map((e) => ({
              op: 'update_ink' as const,
              id: e.stroke.id,
              patch: { color: this.inkColor.value },
            })),
            ...graph.nodes
              .filter((n) => this.selected.has(n.id))
              .map((n) => ({
                op: 'update' as const,
                id: n.id,
                patch: { color: this.inkColor.value },
              })),
          ]
        : entries
            .filter((e) => action === 'attach' || e.node)
            .map((e) => ({
              op: 'attach_ink',
              id: e.stroke.id,
              ...(action === 'attach' ? { node: target } : {}),
            }))
    if (!ops.length || (action === 'attach' && !target)) return
    if (canvasFingerprint(editCanvas(graph, ops).graph) === canvasFingerprint(graph)) return
    this.commit(document, ops)
  }
  private async remove(): Promise<void> {
    const document = this.ready()
    if (!this.selected.size) return
    const owned = new Set(
      allInkEntries(document.session.graph)
        .filter((e) => e.node && this.selected.has(e.node.id))
        .map((e) => e.stroke.id)
    )
    this.commit(
      document,
      [...this.selected].filter((id) => !owned.has(id)).map((id) => ({ op: 'remove', id }))
    )
    this.selected.clear()
    this.refresh()
  }
  private async group(ungroup = false): Promise<void> {
    const document = this.ready(),
      node = this.node()
    if (ungroup ? node?.type !== 'group' : this.selected.size < 1) return
    const id = ungroup ? node.id : nanoid()
    document.beginDraft()
    try {
      this.update(document, [
        ungroup
          ? { op: 'ungroup', id }
          : { op: 'group', id, label: 'Group', ids: [...this.selected] },
      ])
      this.selected = new Set(ungroup ? [] : [id])
      document.finishDraft()
    } catch (error) {
      if (document.session.draft?.active) document.cancelDraft()
      throw error
    }
    this.changed(document)
  }
  /** Undo and redo happen in memory at once; the result is written with the next batch. */
  private history(direction: 'undo' | 'redo'): void {
    const document = this.ready()
    if (direction === 'undo') document.undoLocal()
    else document.redoLocal()
    this.changed(document)
  }
  private async discard(): Promise<void> {
    const document = this.ports.document()
    if (
      !document ||
      this.waiting ||
      this.composing ||
      document.session.publicationOutcome ||
      document.recovery ||
      (document.session.busy && this.ownedDraft !== document)
    )
      return
    const generation = document.session.generation
    await this.saving(async () => {
      if (!(await this.ports.confirmDiscard())) return
      if (
        this.destroyed ||
        this.ports.document() !== document ||
        document.session.generation !== generation
      )
        throw new Error('Canvas changed while confirmation was open; draft was kept')
      document.discardDraft()
      if (this.writeFailed === document) this.writeFailed = null
      this.clearText()
      this.editing = null
      this.ownedDraft = null
      this.text.blur()
    })
  }
  /** The only human native exit: an explicit local retain/discard, never an implicit save. */
  async prepareNative(): Promise<boolean> {
    const document = this.ports.document()
    if (!document) return !this.waiting
    if (this.waiting || this.composing) return false
    this.inputAdapter.cancel()
    if (this.editing) this.endText()
    // Native Canvas reads the file: write what is only in memory first.
    await this.writes.flush(document)
    if (this.destroyed || this.ports.document() !== document) return false
    if (document.session.busy) {
      this.ports.notice('Another canvas edit is active; finish it before opening native Canvas')
      return false
    }
    if (document.session.dirty) {
      const generation = document.session.generation,
        path = document.file.path
      let choice: 'stay' | 'retain' | 'discard' = 'stay'
      await this.saving(async () => {
        choice = await this.ports.handoffChoice()
      })
      if (
        this.destroyed ||
        this.ports.document() !== document ||
        document.session.generation !== generation ||
        document.file.path !== path ||
        choice === 'stay'
      )
        return false
      if (choice === 'discard') {
        if (document.session.publicationOutcome || document.recovery) {
          this.ports.notice(
            'Use Recover failed canvas change to review and discard this retained change first'
          )
          return false
        }
        document.discardDraft()
      }
    }
    document.releaseWriter(true)
    return true
  }
  refresh(): void {
    if (this.destroyed) return
    this.inputAdapter?.validate()
    const document = this.ports.document(),
      session = document?.session,
      node = this.node()
    const graph = session?.graph,
      ids = new Set(
        [
          ...(graph?.nodes ?? []),
          ...(graph?.edges ?? []),
          ...linesOf(graph ?? { nodes: [], edges: [] }),
          ...inkEntries(graph ?? { nodes: [], edges: [] }).map((e) => e.stroke),
        ].map((e) => e.id)
      )
    this.selected = new Set([...this.selected].filter((id) => ids.has(id)))
    this.viewer.selection = this.selected
    this.viewer.draw()
    if (document && this.flushHook?.document !== document) {
      // The store writes this document's unwritten work before anyone else reads or writes it.
      if (this.flushHook && this.flushHook.document.writes === this.flushHook)
        this.flushHook.document.writes = null
      this.flushHook = {
        document,
        flush: () => {
          // A reader or a closing tab gets the text typed so far, too.
          if (this.ownedDraft === document) this.settleText()
          return this.writes.flush(document)
        },
      }
      document.writes = this.flushHook
      // Work left unwritten by an earlier tab is written like a new change.
      if (this.writable(document)) this.writes.changed(document)
    }
    const active = !!this.editing,
      blocked = !this.editable(document),
      // Unwritten work is normal; it is only shown as retained when it cannot simply be written.
      retained =
        !!session?.dirty &&
        (this.writeFailed === document ||
          !!session.conflict ||
          !!document.recovery ||
          !!session.publicationOutcome ||
          document.draftPath !== document.file.path)
    for (const label of [
      'Shapes and connections',
      'Add text card',
      'Add note or attachment',
      'Add link',
      'Edit card text',
      'Open selected card',
      'Delete selected card',
      'Toggle multiple selection',
      'Group selected cards',
      'Ungroup selected group',
    ])
      this.buttons.get(label).hidden = !this.inkControls.hidden
    const ink = allInkEntries(graph ?? { nodes: [], edges: [] }).filter((e) =>
        this.selected.has(e.stroke.id)
      ),
      groupable =
        this.selected.size > 0 &&
        [...this.selected].every(
          (id) => graph?.nodes.some((n) => n.id === id) || ink.some((e) => e.stroke.id === id)
        )
    this.inkSelectionControls.hidden = this.tool !== 'lasso'
    const attachment = this.inkAttachment.value
    this.inkAttachment.replaceChildren()
    for (const [value, text] of [
      ['', 'Selected card or choose attachment'],
      ...canvasVisibility(graph ?? { nodes: [], edges: [] }).visible.map((n) => [
        n.id,
        n.type === 'group'
          ? n.label || 'Group'
          : n.type === 'text'
            ? n.text?.slice(0, 40) || 'Text card'
            : n.file || n.url || 'Card',
      ]),
    ]) {
      const option = this.inkAttachment.ownerDocument.createElementNS(
        'http://www.w3.org/1999/xhtml',
        'option'
      ) as HTMLOptionElement
      option.value = value
      option.textContent = text
      this.inkAttachment.append(option)
    }
    this.inkAttachment.value = attachment
    this.inkAttachment.disabled = blocked || !ink.length
    this.buttons.get('Toggle lasso multiple selection').disabled = blocked
    this.buttons
      .get('Toggle lasso multiple selection')
      .setAttribute('aria-pressed', String(this.multiple))
    this.buttons.get('Delete canvas selection').disabled = blocked || !this.selected.size
    this.buttons.get('Group canvas selection').disabled = blocked || !groupable
    this.buttons.get('Ungroup canvas selection').disabled = blocked || node?.type !== 'group'
    this.buttons.get('Recolor canvas selection').disabled = blocked || !groupable
    this.buttons.get('Detach selected ink').disabled = blocked || !ink.some((e) => e.node)
    this.buttons.get('Attach selected ink').disabled = blocked || !ink.length
    const connection = this.connection()
    this.properties.hidden = !connection || active || !this.inkControls.hidden
    if (
      connection &&
      (connection.id !== this.propertyId ||
        !this.properties.contains(this.properties.ownerDocument.activeElement))
    ) {
      this.propertyId = connection.id
      this.propertyBaseline = JSON.stringify(connection)
      this.label.value = connection.label ?? ''
      this.fromEnd.value = connection.fromEnd ?? 'none'
      this.toEnd.value = connection.toEnd ?? ('fromNode' in connection ? 'arrow' : 'none')
      // Unsupported Advanced Canvas routing and custom colours are retained unless explicitly changed.
      const retainOption = (select: HTMLSelectElement, value: string) => {
        if (!Array.from(select.options).some((o) => o.value === value)) {
          const option = select.ownerDocument.createElementNS(
            'http://www.w3.org/1999/xhtml',
            'option'
          ) as HTMLOptionElement
          option.value = value
          option.textContent = 'Retain existing'
          select.append(option)
        }
        select.value = value
      }
      retainOption(
        this.routing,
        'fromNode' in connection
          ? typeof connection.pathfindingMethod === 'string'
            ? connection.pathfindingMethod
            : 'bezier'
          : 'direct'
      )
      retainOption(
        this.color,
        connection.color && !/^[1-6]$/.test(connection.color)
          ? '__retain'
          : (connection.color ?? '')
      )
    }
    this.routing.disabled = blocked || !connection || !('fromNode' in connection)
    this.buttons.get('Apply selected shape').disabled = blocked || node?.type !== 'text'
    for (const field of [
      this.inkColor,
      this.inkSize,
      this.shape,
      this.shapeColor,
      this.label,
      this.fromEnd,
      this.toEnd,
      this.color,
    ])
      field.disabled = blocked
    for (const label of ['Apply connection style', 'Reverse connection arrows'])
      this.buttons.get(label).disabled = blocked || !connection
    for (const [tool, label] of [
      ['pan', 'Navigate canvas'],
      ['pen', 'Draw with pen'],
      ['marker', 'Draw with marker'],
      ['eraser', 'Erase whole strokes'],
      ['partial-eraser', 'Erase part of strokes'],
      ['lasso', 'Lasso canvas objects'],
      ['select', 'Select canvas objects'],
      ['connect', 'Draw connection'],
      ['line', 'Draw free line'],
      ['arrow', 'Draw free arrow'],
    ] as const) {
      this.buttons.get(label).disabled = blocked
      this.buttons.get(label).setAttribute('aria-pressed', String(this.tool === tool))
    }
    for (const label of ['Add text card', 'Add note or attachment', 'Add link', 'Add canvas shape'])
      this.buttons.get(label).disabled = blocked
    this.buttons.get('Edit card text').disabled =
      !document ||
      this.waiting ||
      active ||
      node?.type !== 'text' ||
      !!document.error ||
      document.state.native ||
      !this.editable(document)
    this.buttons.get('Open selected card').disabled =
      active || !node || !['file', 'link'].includes(node.type)
    this.buttons.get('Delete selected card').disabled = blocked || !this.selected.size
    this.buttons.get('Toggle multiple selection').disabled = blocked
    this.buttons
      .get('Toggle multiple selection')
      .setAttribute('aria-pressed', String(this.multiple))
    this.buttons.get('Group selected cards').disabled =
      blocked ||
      this.selected.size < 2 ||
      [...this.selected].some((id) => !graph?.nodes.some((n) => n.id === id))
    this.buttons.get('Ungroup selected group').disabled = blocked || node?.type !== 'group'
    for (const direction of ['undo', 'redo'] as const)
      this.buttons.get(
        direction === 'undo' ? 'Undo canvas change' : 'Redo canvas change'
      ).disabled = blocked || !session?.localHistory[direction]
    this.panel.hidden = !active
    const retry = this.buttons.get('Retry save'),
      discard = this.buttons.get('Discard local draft')
    // A live gesture is a preview, not retained work to retry/discard. On a narrow screen
    // these extra buttons wrap and move the stage underneath the captured pointer.
    // Text being typed is written as it goes, so a failed write offers Retry while typing too.
    retry.hidden =
      !!this.geometry || !retained || !!document?.recovery || !!session?.publicationOutcome
    retry.disabled = this.waiting || !document || !this.writable(document)
    discard.hidden =
      !!this.geometry || !retained || !!document?.recovery || !!session?.publicationOutcome
    discard.disabled =
      this.waiting || this.composing || (!!session?.busy && this.ownedDraft !== document)
    const penHint =
      'Draw on a card to attach ink; start on the background for free ink. Two fingers navigate.'
    const eraserHint = 'Drag over ink to erase. Two fingers navigate; Undo restores the gesture.'
    this.status.textContent = this.geometry
      ? this.tool === 'pen' || this.tool === 'marker'
        ? penHint
        : this.tool === 'eraser' || this.tool === 'partial-eraser'
          ? eraserHint
          : 'Canvas gesture in progress…'
      : retained
        ? 'Unsaved canvas work — retained in memory only; not saved. Reloading or crashing can lose it.' +
          (session.conflict || (document.draftPath && document.draftPath !== document.file.path)
            ? ' The source changed; retry is blocked. Keep or explicitly discard this local draft.'
            : '') +
          (!document.draftPath && !document.recovery && !session.publicationOutcome
            ? ' Discard this local history preview before trying Undo or Redo again.'
            : '')
        : this.waiting
          ? 'Canvas operation in progress…'
          : this.selected.size
            ? this.selected.size === 1
              ? `Selected ${node?.type ?? (ink.length ? 'stroke' : 'connection')}`
              : `${this.selected.size} objects selected`
            : this.tool === 'lasso'
              ? 'Circle cards and ink to select; drag the selection to move or its corner to scale. Open Selection actions to edit it.'
              : this.tool === 'eraser' || this.tool === 'partial-eraser'
                ? eraserHint
                : this.tool === 'pen' || this.tool === 'marker'
                  ? penHint
                  : this.tool === 'connect'
                    ? 'Drag from a card to another card to connect them.'
                    : this.tool === 'line' || this.tool === 'arrow'
                      ? 'Drag to draw a free line or arrow.'
                      : ''
  }
  private key(event: KeyboardEvent): boolean {
    if (
      this.editing ||
      this.waiting ||
      event.isComposing ||
      (event.target instanceof Element && event.target.closest('button'))
    )
      return false
    if (event.key === 'Escape' && this.viewer.step === null) {
      this.inputAdapter.cancel()
      this.selected.clear()
      this.tool = 'select'
      this.refresh()
      event.preventDefault()
      return true
    }
    const command = event.metaKey || event.ctrlKey
    let label: string
    if (command && event.key.toLowerCase() === 'z')
      label = event.shiftKey ? 'Redo canvas change' : 'Undo canvas change'
    else if (command && event.key.toLowerCase() === 'y') label = 'Redo canvas change'
    else if (event.key === 'Delete' || event.key === 'Backspace') label = 'Delete selected card'
    else if (event.key === 'Enter') label = 'Edit card text'
    else return false
    event.preventDefault()
    event.stopPropagation()
    this.buttons.get(label)?.click()
    return true
  }
  destroy(): void {
    void this.close()
  }
  /** Closing writes what is only in memory. Resolves false when some of it could not be written. */
  close(): Promise<boolean> {
    if (this.destroyed) return Promise.resolve(true)
    const document = this.ports.document()
    this.inputAdapter.destroy()
    if (this.ownedDraft === document) this.endText()
    this.clearText()
    const written = document ? this.writes.flush(document) : Promise.resolve(true)
    this.writes.dispose()
    this.destroyed = true
    this.off.splice(0).forEach((fn) => fn())
    this.viewer.onSelect = undefined
    this.viewer.onEditorKey = undefined
    this.viewer.selection = new Set()
    this.bar.remove()
    this.panel.remove()
    this.status.remove()
    this.palette.remove()
    this.inkControls.remove()
    this.properties.remove()
    return written
  }
}
