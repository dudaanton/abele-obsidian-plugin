import {
  FileView,
  Menu,
  Notice,
  Scope,
  TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian'
import { cameraFrom } from '../drawing/camera'
import { hostCanvasViewer } from './adapter'
import { CANVAS_VIEW_TYPE, nativeCanvas } from './opening'
import { emptyCanvas } from './core/model'
import { ObsidianCanvasStore } from './obsidianStore'
import {
  CanvasPublicationReviewModal,
  canvasPublicationStatus,
} from './CanvasPublicationReviewModal'
import type { CanvasDocument, CanvasDocumentLease } from './documentRegistry'
import { stepsOf } from './core/steps'
import { canvasPicture } from './pictureAdapter'
import type { CanvasViewer } from './Viewer'
import type { CanvasEditor } from './Editor'
import { hostCanvasEditor } from './editorControls'

/** Shared human editor; no view save hook ever publishes a transient preview. */
export class CanvasView extends FileView {
  viewer: CanvasViewer | null = null
  editor: CanvasEditor | null = null
  private refreshToken = 0
  private loaded = false
  private renderedGeneration: number | null = null
  private documentLease: CanvasDocumentLease | null = null
  private requestedFile: TFile | null = null
  private closed = false
  private publicationReviewModal: CanvasPublicationReviewModal | null = null
  private reviewRequest = 0
  private attachmentError: string | null = null
  private pending: Record<string, unknown> | null = null
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.scope = new Scope(this.app.scope)
    for (const key of [
      'ArrowRight',
      'ArrowLeft',
      'PageDown',
      'PageUp',
      'Home',
      'End',
      ' ',
      'Escape',
    ])
      this.scope.register([], key, (event) => {
        this.viewer?.handleKey(event)
        return event.defaultPrevented ? false : undefined
      })
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (
          file instanceof TFile &&
          file === this.requestedFile &&
          !this.documentLease &&
          !this.closed
        ) {
          void this.attachDocument(file)
        } else if (
          file.path !== this.file?.path &&
          file instanceof TFile &&
          this.viewer?.graph.nodes.some((n) => n.file === file.path || n.background === file.path)
        ) {
          this.viewer.load(this.viewer.graph)
        }
      })
    )
    // A canvas move can leave bytes/generation unchanged but change relative Markdown and assets.
    // Native reference rewriting may arrive later; cancel stale picture loads immediately.
    this.registerEvent(
      this.app.vault.on('rename', () => {
        if (!this.closed && this.viewer) this.viewer.load(this.viewer.graph)
      })
    )
    this.registerEvent(this.app.workspace.on('css-change', () => this.viewer?.draw()))
  }
  getViewType(): string {
    return CANVAS_VIEW_TYPE
  }
  getDisplayText(): string {
    return this.file?.basename ?? 'Diagram'
  }
  getIcon(): string {
    return 'workflow'
  }
  canAcceptExtension(extension: string): boolean {
    return extension === 'canvas'
  }
  async onOpen(): Promise<void> {
    this.closed = false
    this.contentEl.empty()
    this.contentEl.addClass('abele-canvas-view')
    this.viewer = hostCanvasViewer(this.app, this.contentEl, () => this.file?.path ?? '')
    this.addAction('panel-top', 'Open in Obsidian Canvas', () => {
      void this.openNative()
    })
    this.addAction('image-down', 'Export diagram picture', (e) => this.exportMenu(e))
    this.addAction('rotate-ccw', 'Recover failed canvas change', (e) => void this.recoveryMenu(e))
    if (this.documentLease) {
      this.attachEditor()
      this.renderDocument(this.documentLease.document)
    } else if (this.attachmentError) this.viewer.status.setText(this.attachmentError)
  }
  async onLoadFile(file: TFile): Promise<void> {
    if (this.closed) return
    this.releaseDocument()
    this.file = file
    this.requestedFile = file
    this.loaded = false
    this.attachmentError = null
    await this.attachDocument(file)
  }
  private async attachDocument(file: TFile): Promise<void> {
    if (this.closed || this.requestedFile !== file) return
    const token = ++this.refreshToken
    try {
      const lease = await new ObsidianCanvasStore(this.app).open(file, this, (document) => {
        if (token === this.refreshToken) this.renderDocument(document)
      })
      if (token !== this.refreshToken || this.closed || this.requestedFile !== file) lease.release()
      else {
        this.documentLease = lease
        this.attachmentError = null
        this.attachEditor()
        this.renderDocument(lease.document)
      }
    } catch (error) {
      if (token === this.refreshToken && !this.closed && this.requestedFile === file) {
        this.attachmentError = `Diagram could not be read: ${String(error)}`
        this.viewer?.status.setText(this.attachmentError)
      }
    }
  }
  async onUnloadFile(file: TFile): Promise<void> {
    this.requestedFile = null
    this.refreshToken++
    this.releaseDocument()
    this.loaded = false
    this.viewer?.load(emptyCanvas(), true)
    await super.onUnloadFile(file)
  }
  async onClose(): Promise<void> {
    this.closed = true
    this.requestedFile = null
    this.refreshToken++
    this.releaseDocument()
    this.viewer?.destroy()
    this.viewer = null
    await super.onClose()
  }
  private attachEditor(): void {
    if (this.viewer && !this.editor)
      this.editor = hostCanvasEditor(
        this.app,
        this.viewer,
        () => this.documentLease?.document ?? null
      )
  }
  private async openNative(): Promise<void> {
    const file = this.file,
      epoch = this.refreshToken
    try {
      if (this.editor && !(await this.editor.prepareNative())) return
      if (file && this.file === file && epoch === this.refreshToken && !this.closed)
        await nativeCanvas(this.leaf, file)
    } catch (error) {
      new Notice(`Native Canvas handoff did not complete: ${String(error)}`)
    }
  }
  private releaseDocument(): void {
    this.editor?.destroy()
    this.editor = null
    this.reviewRequest++
    this.publicationReviewModal?.close()
    this.publicationReviewModal = null
    const lease = this.documentLease
    this.documentLease = null
    if (lease?.document.recovery)
      new Notice('Failed canvas change retained; reopen and use the recovery action')
    else if (lease?.document.session.dirty)
      new Notice('Unsaved diagram work is retained in this running session')
    lease?.release()
  }
  private renderDocument(document: CanvasDocument): void {
    if (!this.viewer || document.file !== this.file) return
    if (!this.loaded || this.renderedGeneration !== document.session.generation) {
      this.viewer.load(document.session.graph, !this.loaded)
      this.loaded = true
      this.renderedGeneration = document.session.generation
    }
    this.editor?.refresh()
    this.place()
    const state = document.state
    if (document.session.publicationOutcome)
      this.viewer.status.setText(
        canvasPublicationStatus(document.session.publicationOutcome) +
          (state.error ? ` Persisted source could not be read: ${state.error}` : '')
      )
    else if (state.error) this.viewer.status.setText(`Diagram could not be read: ${state.error}`)
    else if (state.conflict)
      this.viewer.status.setText('Diagram changed outside this session; pending work is retained')
    else if (state.dirty)
      this.viewer.status.setText('Diagram has pending session work; it has not been saved')
  }
  private place(): void {
    const state = this.pending,
      viewer = this.viewer
    if (!state || !viewer || !this.loaded) return
    this.pending = null
    let byId = 0
    if (typeof state.stepId === 'string') {
      try {
        byId = stepsOf(viewer.graph).findIndex((s) => s.id === state.stepId) + 1
      } catch (error) {
        viewer.status.setText(`Walkthrough steps unavailable: ${String(error)}`)
      }
    }
    const playback = byId || typeof state.step === 'number' || state.play === true
    if (playback) viewer.go(byId || (typeof state.step === 'number' ? state.step : 1), false)
    // A node subpath frames Open; it must not cancel the explicitly requested walkthrough.
    if (typeof state.node === 'string' && !playback) {
      const node = viewer.graph.nodes.find((n) => n.id === state.node)
      if (node) {
        viewer.go(null, false)
        // Fit the named card without changing stored diagram geometry.
        viewer.focusRegion(node)
      }
    }
    const camera = cameraFrom(state.camera)
    if (camera) viewer.setCamera(camera)
  }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.pending = (state ?? {}) as Record<string, unknown>
    await super.setState(state, result)
    this.place()
  }
  getState(): Record<string, unknown> {
    const state = super.getState(),
      viewer = this.viewer
    if (viewer) {
      state.camera = { ...viewer.camera }
      if (viewer.step !== null) {
        state.step = viewer.step
        state.stepId = stepsOf(viewer.graph)[viewer.step - 1]?.id
      }
    }
    return state
  }
  private async recoveryMenu(e: MouseEvent): Promise<void> {
    const document = this.documentLease?.document,
      file = this.requestedFile
    if (!document || !file || this.closed) {
      new Notice('No failed canvas change to recover')
      return
    }
    const store = new ObsidianCanvasStore(this.app),
      epoch = this.refreshToken,
      request = ++this.reviewRequest,
      isCurrent = () =>
        !this.closed &&
        this.requestedFile === file &&
        this.file === file &&
        this.refreshToken === epoch &&
        this.reviewRequest === request &&
        this.documentLease?.document === document
    try {
      if (document.session.publicationOutcome) {
        this.publicationReviewModal?.close()
        const review = await store.reviewPublication(file, this, isCurrent)
        if (!isCurrent()) {
          store.keepPublicationReview(review)
          return
        }
        const modal = new CanvasPublicationReviewModal(
          this.app,
          review,
          () => {
            store.keepPublicationReview(review)
            if (this.publicationReviewModal === modal) this.publicationReviewModal = null
          },
          () => store.discardPublicationReview(review)
        )
        this.publicationReviewModal = modal
        modal.open()
        return
      }
      const snapshot = await store.snapshotFile(file),
        recovery = snapshot.state?.recovery
      if (!recovery) {
        new Notice('No failed agent proposal; human work has not been changed')
        return
      }
      const menu = new Menu()
      const labels = {
        retry: 'Retry failed change',
        reapply: 'Reapply failed change to current diagram',
        discard: 'Discard failed change',
      }
      for (const action of recovery.actions)
        menu.addItem((item) =>
          item.setTitle(labels[action]).onClick(async () => {
            if (
              this.closed ||
              this.requestedFile !== file ||
              this.documentLease?.document !== document
            )
              return
            try {
              await store.recoverFile(file, snapshot.revision, recovery.proposal, action)
            } catch (error) {
              new Notice(`Canvas recovery did not complete: ${String(error)}`)
            }
          })
        )
      if (!this.closed && this.requestedFile === file && this.documentLease?.document === document)
        menu.showAtMouseEvent(e)
    } catch (error) {
      new Notice(`Canvas recovery unavailable: ${String(error)}`)
    }
  }
  private exportMenu(e: MouseEvent): void {
    const menu = new Menu()
    for (const format of ['png', 'svg'] as const) {
      menu.addItem((item) =>
        item
          .setTitle(`Export current view as ${format.toUpperCase()}`)
          .onClick(() => void this.exportPicture(format, false))
      )
      menu.addItem((item) =>
        item
          .setTitle(`Export each step as ${format.toUpperCase()}`)
          .onClick(() => void this.exportPicture(format, true))
      )
    }
    menu.showAtMouseEvent(e)
  }
  /** SVG is a self-contained image document, not a second editable canvas format. */
  async exportPicture(format: 'png' | 'svg', each: boolean): Promise<TFile[]> {
    const file = this.file,
      viewer = this.viewer
    if (!file || !viewer) return []
    const graph = viewer.graph,
      steps = each ? stepsOf(graph) : []
    if (each && !steps.length) {
      new Notice('This diagram has no walkthrough steps')
      return []
    }
    const saved: TFile[] = []
    try {
      for (const number of each ? steps.map((_, i) => i + 1) : [null]) {
        const picture = await canvasPicture(
          this.app,
          graph,
          file.path,
          number === null
            ? { step: viewer.step ?? undefined, region: viewer.visible() }
            : { step: number },
          () => true
        )
        const name = `${file.basename}${number === null ? '' : ` step ${number}`}.${format}`
        const path = await this.app.fileManager.getAvailablePathForAttachment(name, file.path)
        if (format === 'png') {
          const blob = await new Promise<Blob>((resolve, reject) =>
            picture.canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('PNG unavailable'))),
              'image/png'
            )
          )
          saved.push(await this.app.vault.createBinary(path, await blob.arrayBuffer()))
        } else {
          const url = picture.canvas.toDataURL('image/png')
          saved.push(
            await this.app.vault.create(
              path,
              `<svg xmlns="http://www.w3.org/2000/svg" width="${picture.canvas.width}" height="${picture.canvas.height}" viewBox="0 0 ${picture.canvas.width} ${picture.canvas.height}"><image width="100%" height="100%" href="${url}"/></svg>\n`
            )
          )
        }
      }
      new Notice(`Saved ${saved.length} diagram picture${saved.length === 1 ? '' : 's'}`)
    } catch (error) {
      new Notice(`Diagram export stopped after ${saved.length} pictures: ${String(error)}`)
    }
    return saved
  }
}
