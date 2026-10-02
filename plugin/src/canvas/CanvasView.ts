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
import { emptyCanvas, parseCanvas } from './core/model'
import { stepsOf } from './core/steps'
import { canvasPicture } from './pictureAdapter'
import type { CanvasViewer } from './Viewer'

/** Read-only FileView: external/native/agent writes reload; no save hook ever publishes a preview. */
export class CanvasView extends FileView {
  viewer: CanvasViewer | null = null
  private refreshToken = 0
  private bytes = ''
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
        if (file.path === this.file?.path) void this.refresh()
        else if (
          file instanceof TFile &&
          this.viewer?.graph.nodes.some((n) => n.file === file.path)
        ) {
          this.viewer.load(this.viewer.graph)
        }
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
    this.contentEl.empty()
    this.contentEl.addClass('abele-canvas-view')
    this.viewer = hostCanvasViewer(this.app, this.contentEl, () => this.file?.path ?? '')
    this.addAction('panel-top', 'Open in Obsidian Canvas', () => {
      if (this.file) void nativeCanvas(this.leaf, this.file)
    })
    this.addAction('image-down', 'Export diagram picture', (e) => this.exportMenu(e))
  }
  async onLoadFile(file: TFile): Promise<void> {
    this.file = file
    this.bytes = ''
    await this.refresh()
  }
  async onUnloadFile(file: TFile): Promise<void> {
    this.refreshToken++
    this.bytes = ''
    this.viewer?.load(emptyCanvas(), true)
    await super.onUnloadFile(file)
  }
  async onClose(): Promise<void> {
    this.refreshToken++
    this.viewer?.destroy()
    this.viewer = null
    await super.onClose()
  }
  private async refresh(): Promise<void> {
    const file = this.file,
      token = ++this.refreshToken
    if (!file || !this.viewer) return
    try {
      const bytes = await this.app.vault.read(file)
      if (token !== this.refreshToken || !this.viewer) return
      if (bytes !== this.bytes) {
        const graph = parseCanvas(bytes),
          initial = !this.bytes
        this.bytes = bytes
        this.viewer.load(graph, initial)
      }
      this.place()
    } catch (error) {
      if (token === this.refreshToken && this.viewer)
        this.viewer.status.setText(`Diagram could not be read: ${String(error)}`)
    }
  }
  private place(): void {
    const state = this.pending,
      viewer = this.viewer
    if (!state || !viewer || !this.bytes) return
    this.pending = null
    const steps = stepsOf(viewer.graph)
    const byId =
      typeof state.stepId === 'string' ? steps.findIndex((s) => s.id === state.stepId) + 1 : 0
    if (byId || typeof state.step === 'number' || state.play === true)
      viewer.go(byId || (typeof state.step === 'number' ? state.step : 1), false)
    if (typeof state.node === 'string') {
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
