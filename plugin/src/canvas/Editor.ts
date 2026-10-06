/** Human interaction over the existing shared document; no storage or replay machinery. */
import { nanoid } from 'nanoid'
import { editCanvas, type CanvasOperation, type NodeInput } from './core/edit'
import { canvasFingerprint } from './core/model'
import type { CanvasSession, GraphTransform } from './core/session'
import type { CanvasViewer } from './Viewer'

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
  private selected: string | null = null
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
    this.button('Add text card', 'Text', () => this.addText())
    this.button('Add note or attachment', 'File', () => this.pick('file'))
    this.button('Add link', 'Link', () => this.pick('link'))
    this.button('Edit card text', 'Edit text', () => this.editText())
    this.button('Open selected card', 'Open', () => {
      const node = this.node()
      if (node) viewer.openNode(node)
    })
    this.button('Delete selected card', 'Delete', () => this.remove())
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
    viewer.onSelect = (node) => {
      if (this.editing || this.waiting) return
      this.selected = node?.id ?? null
      this.refresh()
    }
    viewer.onEditorKey = (event) => this.key(event)
    this.refresh()
  }
  private listen(el: HTMLElement, type: string, fn: EventListener): void {
    el.addEventListener(type, fn)
    this.off.push(() => el.removeEventListener(type, fn))
  }
  private button(label: string, text: string, action: () => unknown): void {
    const button = this.bar.ownerDocument.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'button'
    ) as HTMLButtonElement
    button.type = 'button'
    button.textContent = text
    button.setAttribute('aria-label', label)
    button.title = label
    this.bar.append(button)
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
    return this.ports.document()?.session.graph.nodes.find((node) => node.id === this.selected)
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
  private addText(): void {
    const document = this.ready(),
      id = nanoid()
    document.beginDraft()
    this.ownedDraft = document
    this.update(document, [
      { op: 'add_node', node: { id, kind: 'text', label: '', ...this.location() } },
    ])
    this.selected = id
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
      this.selected = node.id
      await this.ports.publish()
    })
  }
  private async remove(): Promise<void> {
    const document = this.ready(),
      node = this.node()
    if (!node) return
    document.beginDraft()
    this.update(document, [{ op: 'remove', id: node.id }])
    document.finishDraft()
    this.selected = null
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
    const document = this.ports.document(),
      session = document?.session,
      node = this.node()
    if (this.selected && !node) this.selected = null
    this.viewer.selection = new Set(this.selected ? [this.selected] : [])
    this.viewer.draw()
    const active = !!this.editing,
      blocked =
        !document ||
        this.waiting ||
        !!document.error ||
        document.state.native ||
        !!session?.busy ||
        !!session?.dirty
    for (const label of ['Add text card', 'Add note or attachment', 'Add link'])
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
    this.buttons.get('Delete selected card').disabled = blocked || !node
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
    retry.hidden =
      !session?.dirty || active || !!document?.recovery || !!session?.publicationOutcome
    retry.disabled =
      this.waiting ||
      !!session?.busy ||
      !!session?.conflict ||
      !!document?.error ||
      !!document?.state.native ||
      !document?.draftPath ||
      document.draftPath !== document.file.path
    discard.hidden = !session?.dirty || !!document?.recovery || !!session?.publicationOutcome
    discard.disabled =
      this.waiting || this.composing || (!!session?.busy && this.ownedDraft !== document)
    this.status.textContent = session?.dirty
      ? 'Unsaved canvas work — retained in memory only; not saved. Reloading or crashing can lose it.' +
        (session.conflict || (document.draftPath && document.draftPath !== document.file.path)
          ? ' The source changed; retry is blocked. Keep or explicitly discard this local draft.'
          : '') +
        (!document.draftPath && !document.recovery && !session.publicationOutcome
          ? ' Discard this local history preview before trying Undo or Redo again.'
          : '')
      : this.waiting
        ? 'Canvas operation in progress…'
        : this.selected
          ? `Selected ${node?.type ?? 'card'}`
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
  }
}
