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
import { exportCanvas } from './exportAdapter'
import { canvasMenu } from './menu'
import type { CanvasExportFormat } from './core/export'
import { pickAnyFile } from '../helpers/suggesters/VaultFilePicker'
import { isChatLog } from '../ai/chatText'
import { mountCanvasChrome } from './chrome'
import { canvasHostActions, type CanvasHostActions } from './pickedActions'
import { paneEntries } from '../components/canvas/chromeMenus'
import { CanvasPlaceModal, canvasContents, type CanvasPlace } from './canvasFind'
import { promptDialog } from '@/components/obsidian/dialogs'

/** Shared human editor; no view save hook ever publishes a transient preview. */
export class CanvasView extends FileView {
  viewer: CanvasViewer | null = null
  editor: CanvasEditor | null = null
  private refreshToken = 0
  private loaded = false
  private documentStatus = ''
  private renderedGeneration: number | null = null
  private documentLease: CanvasDocumentLease | null = null
  private requestedFile: TFile | null = null
  private closed = false
  private publicationReviewModal: CanvasPublicationReviewModal | null = null
  private reviewRequest = 0
  private attachmentError: string | null = null
  private pending: Record<string, unknown> | null = null
  private exportController: AbortController | null = null
  private lastExport: TFile | null = null
  private chromeOff: (() => void) | null = null
  /** What the canvas's menus do outside it: pictures, embeds, the chat and notes. */
  readonly host: CanvasHostActions = canvasHostActions(
    this.app,
    () => this.file,
    () => this.viewer?.graph ?? emptyCanvas(),
    (title, value) => promptDialog({ title, placeholder: value })
  )
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
    // Quitting writes what is still only in memory before the app goes away.
    this.registerEvent(
      this.app.workspace.on('quit', (tasks) => {
        const editor = this.editor
        if (editor) tasks.add(() => editor.flush())
      })
    )
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
    this.addAction(
      'paperclip',
      'Attach to the chat as a picture',
      () => void this.host.attach(null)
    )
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
    if (this.viewer && !this.editor) {
      this.editor = hostCanvasEditor(
        this.app,
        this.viewer,
        () => this.documentLease?.document ?? null
      )
      this.chromeOff = mountCanvasChrome(this.viewer, this.editor, this.host)
    }
  }
  /** The canvas tab's own items at the top of its "more" menu, over Obsidian's. */
  onPaneMenu(menu: Menu, source: string): void {
    const editor = this.editor
    for (const entry of paneEntries({
      find: () => this.find(),
      contents: () => this.contents(),
      exportCanvas: () => this.exportMenu(this.headerEvent('Export diagram picture')),
      copyEmbed: () => {
        const r = this.viewer?.visible()
        if (r)
          void this.host.copyEmbed({
            region: {
              x: Math.round(r.x),
              y: Math.round(r.y),
              width: Math.round(r.width),
              height: Math.round(r.height),
            },
          })
      },
      openNative: () => void this.openNative(),
      ...(editor
        ? {
            fingerDraws: {
              on: editor.controls.fingerDraws(),
              toggle: () => editor.controls.setFingerDraws(!editor.controls.fingerDraws()),
            },
          }
        : {}),
    }))
      menu.addItem((item) => {
        item
          .setTitle(entry.title)
          .setIcon(entry.icon)
          .setSection('pane')
          .onClick(() => void entry.run())
        if (entry.checked !== undefined) item.setChecked(entry.checked)
      })
    super.onPaneMenu(menu, source)
  }
  /** A click at one of the header's own glyphs, for a menu that opens under it. */
  private headerEvent(label: string): MouseEvent {
    const r = this.containerEl.querySelector(`[aria-label="${label}"]`)?.getBoundingClientRect()
    return new MouseEvent('click', { clientX: r?.left ?? 0, clientY: r?.bottom ?? 0 })
  }
  /** Shows a found place: a card or frame picked and framed, or a step gone to. */
  private show(place: CanvasPlace): void {
    const viewer = this.viewer
    if (!viewer) return
    if (place.step) return viewer.go(place.step)
    if (!place.node) return
    viewer.go(null, false)
    viewer.focusRegion(place.node, true)
    viewer.onSelect?.(place.node)
  }
  /** Obsidian's own find bar over the canvas, as Cmd+F opens it. */
  find(): void {
    this.editor?.controls.setFinding(true)
  }
  contents(): void {
    if (this.viewer)
      new CanvasPlaceModal(
        this.app,
        canvasContents(this.viewer.graph),
        'Frames and steps of the canvas',
        (p) => this.show(p)
      ).open()
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
    this.exportController?.abort()
    this.exportController = null
    this.lastExport = null
    this.chromeOff?.()
    this.chromeOff = null
    // Closing writes the unwritten changes; only work that could not be written stays in memory.
    const written = this.editor?.close() ?? Promise.resolve(true)
    this.editor = null
    this.reviewRequest++
    this.publicationReviewModal?.close()
    this.publicationReviewModal = null
    const lease = this.documentLease
    this.documentLease = null
    if (lease?.document.recovery)
      new Notice('Failed canvas change retained; reopen and use the recovery action')
    else if (lease?.document.session.dirty) {
      const document = lease.document
      void written.then((ok) => {
        if (!ok || document.session.dirty)
          new Notice('Unsaved diagram work is retained in this running session')
      })
    }
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
    // Where it is edited, unwritten work is written by itself (a failed write shows Retry in the
    // editor), so it is not called unsaved there. A leaf without an editor still says so.
    const status = document.session.publicationOutcome
      ? canvasPublicationStatus(document.session.publicationOutcome) +
        (state.error ? ` Persisted source could not be read: ${state.error}` : '')
      : state.error
        ? `Diagram could not be read: ${state.error}`
        : state.conflict
          ? 'Diagram changed outside this session; pending work is retained'
          : state.dirty
            ? this.editor && !this.editor.writeFailing
              ? 'Changes pending; saving automatically'
              : 'Diagram has pending session work; it has not been saved'
            : ''
    if (status) this.viewer.status.setText(status)
    // A settled state clears its own message, never someone else's (walkthrough steps).
    else if (this.documentStatus && this.viewer.status.textContent === this.documentStatus)
      this.viewer.status.setText('')
    this.documentStatus = status
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
    // An embed of a part of the canvas opens on that part.
    const region = state.region as Record<string, unknown> | undefined
    if (
      region &&
      !playback &&
      [region.x, region.y, region.width, region.height].every(Number.isFinite) &&
      (region.width as number) > 0 &&
      (region.height as number) > 0
    ) {
      viewer.go(null, false)
      viewer.focusRegion({
        x: region.x as number,
        y: region.y as number,
        width: region.width as number,
        height: region.height as number,
      })
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
      const menu = canvasMenu()
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
    const menu = canvasMenu()
    if (this.exportController)
      menu.addItem((item) =>
        item.setTitle('Cancel whole-canvas export').onClick(() => this.exportController?.abort())
      )
    for (const format of ['png', 'svg', 'pdf'] as const)
      menu.addItem((item) =>
        item
          .setTitle(`Export whole canvas as ${format.toUpperCase()}`)
          .setDisabled(!!this.exportController)
          .onClick(() => void this.exportWhole(format))
      )
    if (this.lastExport)
      menu.addItem((item) =>
        item.setTitle('Insert exported file into note…').onClick(() => void this.insertExport())
      )
    menu.addSeparator()
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
  async exportWhole(format: CanvasExportFormat): Promise<TFile | null> {
    const file = this.file,
      epoch = this.refreshToken
    if (!file || this.closed || this.exportController) return null
    const controller = new AbortController()
    this.exportController = controller
    try {
      const output = await this.app.fileManager.getAvailablePathForAttachment(
        `${file.basename} whole.${format}`,
        file.path
      )
      controller.signal.throwIfAborted()
      const result = await exportCanvas(this.app, {
        path: file.path,
        output,
        format,
        inScope: () => true,
        signal: controller.signal,
      })
      if (!this.closed && this.file === file && epoch === this.refreshToken)
        this.lastExport = result.file
      new Notice(
        `Saved whole canvas: ${result.file.path}${result.warnings.length ? ` (${result.warnings.length} warnings; ${result.warnings.map((w) => w.message).join('; ')})` : ''}`
      )
      return result.file
    } catch (error) {
      new Notice(
        controller.signal.aborted
          ? 'Whole-canvas export cancelled'
          : `Whole-canvas export failed: ${String(error)}`
      )
      return null
    } finally {
      if (this.exportController === controller) this.exportController = null
    }
  }
  /** Append an ordinary attachment embed; process preserves edits made while the picker was open. */
  async insertExport(): Promise<void> {
    const attachment = this.lastExport
    if (!attachment) return
    try {
      const note = await pickAnyFile(
        this.app,
        (file) => file.extension === 'md' && !isChatLog(file.path)
      )
      if (!note || this.closed || this.lastExport !== attachment) return
      if (this.app.vault.getAbstractFileByPath(attachment.path) !== attachment)
        throw new Error('Exported attachment is no longer available')
      const link = this.app.fileManager.generateMarkdownLink(attachment, note.path)
      await this.app.vault.process(
        note,
        (text) => `${text}${text.endsWith('\n') ? '\n' : '\n\n'}!${link}\n`
      )
      new Notice('Export inserted at the end of the note')
    } catch (error) {
      new Notice(`Export could not be inserted: ${String(error)}`)
    }
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
