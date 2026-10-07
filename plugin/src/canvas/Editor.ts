/** Human interaction over the existing shared document; no storage or replay machinery. */
import { nanoid } from 'nanoid'
import { editCanvas, type CanvasOperation, type NodeInput } from './core/edit'
import { canvasFingerprint, SHAPES, type Shape } from './core/model'
import { linesOf } from './core/primitives'
import type { CanvasSession, GraphTransform } from './core/session'
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
  state: { native: boolean }
  beginDraft(): void
  updateDraft(transform: GraphTransform): void
  finishDraft(): void
  discardDraft(): void
  releaseWriter(retainPending?: boolean): void
}
export interface CanvasEditorPorts {
  document(): CanvasEditorDocument | null
  publish(): Promise<unknown>
  history(direction: 'undo' | 'redo'): Promise<unknown>
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
  private waiting = false
  private destroyed = false
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
    this.button('Save text', 'Save text', () => this.complete())
    this.button('Keep text draft', 'Keep draft', () => this.keep())
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
      if (this.editing || this.waiting) return
      this.selected = new Set(node ? [node.id] : [])
      this.refresh()
    }
    viewer.onEditorKey = (event) => this.key(event)
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
  private canGesture(): boolean {
    const document = this.ports.document()
    return (
      !!document &&
      !this.editing &&
      !this.waiting &&
      !this.destroyed &&
      !document.state.native &&
      !document.error &&
      ((!document.session.busy && !document.session.dirty) || this.validGeometry())
    )
  }
  private validGeometry(): boolean {
    const g = this.geometry
    return (
      !!g &&
      this.ports.document() === g.document &&
      g.path === g.document.file.path &&
      g.generation === g.document.session.generation &&
      !g.document.session.conflict &&
      !g.document.state.native &&
      !g.document.error
    )
  }
  private cancelGeometry(): void {
    const g = this.geometry
    this.geometry = null
    if (g?.document.session.draft?.active) g.document.discardDraft()
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
      if (g.document.session.draft?.active) g.document.discardDraft()
      throw error
    }
    await this.saving(() => this.ports.publish())
  }
  private ready(): CanvasEditorDocument {
    const document = this.ports.document()
    if (
      !document ||
      this.destroyed ||
      this.waiting ||
      document.state.native ||
      document.error ||
      document.session.dirty ||
      document.session.busy
    )
      throw new Error('Canvas is busy or has retained pending work; settle it before editing')
    if (this.viewer.step !== null) this.viewer.go(null, false)
    return document
  }
  private update(document: CanvasEditorDocument, ops: CanvasOperation[]): void {
    document.updateDraft((graph) => editCanvas(graph, ops).graph)
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
      (document.session.dirty && !document.draftPath) ||
      document.recovery ||
      this.waiting ||
      document.session.busy
    )
      return
    document.beginDraft()
    this.ownedDraft = document
    this.showText(node.id)
  }
  private input(): void {
    if (!this.editing || !this.ownedDraft || this.ports.document() !== this.ownedDraft) return
    try {
      this.update(this.ownedDraft, [
        { op: 'update', id: this.editing, patch: { text: this.text.value } },
      ])
    } catch (error) {
      this.fail(error)
    }
  }
  private keep(): void {
    if (!this.editing || this.composing || this.waiting) return
    this.input()
    if (this.ownedDraft?.session.draft?.active) this.ownedDraft.finishDraft()
    this.editing = null
    this.ownedDraft = null
    this.text.blur()
    this.refresh()
  }
  private async complete(): Promise<void> {
    if (this.composing || this.waiting || !this.editing) return
    const document = this.ownedDraft
    this.keep()
    if (
      document &&
      this.ports.document() === document &&
      !document.error &&
      !document.state.native &&
      !document.session.conflict &&
      !document.session.publicationOutcome &&
      document.draftPath === document.file.path &&
      canvasFingerprint(document.session.graph) ===
        canvasFingerprint(document.session.committed.graph)
    ) {
      // Completing a no-op draft is not a command and must not clear redo.
      document.discardDraft()
      this.refresh()
      return
    }
    await this.retry()
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
    if (
      !document ||
      this.waiting ||
      document.session.busy ||
      document.session.conflict ||
      document.error ||
      document.state.native ||
      document.recovery ||
      document.session.publicationOutcome ||
      !document.draftPath ||
      !document.session.dirty
    )
      return
    await this.saving(() => this.ports.publish())
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
      document.beginDraft()
      this.update(document, [{ op: 'add_node', node }])
      document.finishDraft()
      this.selected = new Set([node.id])
      await this.ports.publish()
    })
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
    document.beginDraft()
    this.update(document, ops)
    document.finishDraft()
    await this.saving(() => this.ports.publish())
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
    document.beginDraft()
    this.update(document, [{ op: 'update', id: element.id, patch }])
    document.finishDraft()
    await this.saving(() => this.ports.publish())
    this.propertyBaseline = JSON.stringify(this.connection())
  }
  private async remove(): Promise<void> {
    const document = this.ready()
    if (!this.selected.size) return
    document.beginDraft()
    this.update(
      document,
      [...this.selected].map((id) => ({ op: 'remove', id }))
    )
    document.finishDraft()
    this.selected.clear()
    await this.saving(() => this.ports.publish())
  }
  private async group(ungroup = false): Promise<void> {
    const document = this.ready(),
      node = this.node()
    if (ungroup ? node?.type !== 'group' : this.selected.size < 2) return
    const id = ungroup ? node.id : nanoid()
    document.beginDraft()
    this.update(document, [
      ungroup
        ? { op: 'ungroup', id }
        : { op: 'group', id, label: 'Group', ids: [...this.selected] },
    ])
    document.finishDraft()
    this.selected = new Set(ungroup ? [] : [id])
    await this.saving(() => this.ports.publish())
  }
  private async history(direction: 'undo' | 'redo'): Promise<void> {
    this.ready()
    await this.saving(() => this.ports.history(direction))
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
    if (this.editing) this.keep()
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
        ].map((e) => e.id)
      )
    this.selected = new Set([...this.selected].filter((id) => ids.has(id)))
    this.viewer.selection = this.selected
    this.viewer.draw()
    const active = !!this.editing,
      blocked =
        !document ||
        this.waiting ||
        !!document.error ||
        document.state.native ||
        !!session?.busy ||
        !!session?.dirty
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
      !!session?.busy ||
      !!session?.conflict ||
      (!!session?.dirty && !document.draftPath) ||
      !!document.recovery ||
      !!session?.publicationOutcome
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
      ).disabled = blocked || !session?.history[direction]
    for (const label of ['Save text', 'Keep text draft']) {
      const button = this.buttons.get(label)
      button.hidden = !active
      button.disabled = this.composing || this.waiting
    }
    this.panel.hidden = !active
    const retry = this.buttons.get('Retry save'),
      discard = this.buttons.get('Discard local draft')
    // A live gesture is a preview, not retained work to retry/discard. On a narrow screen
    // these extra buttons wrap and move the stage underneath the captured pointer.
    retry.hidden =
      !!this.geometry ||
      !session?.dirty ||
      active ||
      !!document?.recovery ||
      !!session?.publicationOutcome
    retry.disabled =
      this.waiting ||
      !!session?.busy ||
      !!session?.conflict ||
      !!document?.error ||
      !!document?.state.native ||
      !document?.draftPath ||
      document.draftPath !== document.file.path
    discard.hidden =
      !!this.geometry || !session?.dirty || !!document?.recovery || !!session?.publicationOutcome
    discard.disabled =
      this.waiting || this.composing || (!!session?.busy && this.ownedDraft !== document)
    const penHint =
      'Draw on a card to attach ink; start on the background for free ink. Two fingers navigate.'
    this.status.textContent = this.geometry
      ? this.tool === 'pen' || this.tool === 'marker'
        ? penHint
        : 'Canvas gesture in progress…'
      : session?.dirty
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
              ? `Selected ${node?.type ?? 'connection'}`
              : `${this.selected.size} cards selected`
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
    if (this.destroyed) return
    this.inputAdapter.destroy()
    // Closing is not publication. Let the registry retain the now-inactive draft for reopening.
    if (this.ownedDraft === this.ports.document() && this.ownedDraft?.session.draft?.active)
      this.ownedDraft.finishDraft()
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
  }
}
