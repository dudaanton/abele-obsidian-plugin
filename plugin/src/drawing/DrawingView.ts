/**
 * A drawing in a tab of its own: the bar over it, the surface under it, and the file behind it.
 *
 * The file is an SVG (`drawingFile.ts`), read and written through Obsidian's own text file view,
 * so saving waits for a pause, a change from another device is read in as it arrives, and closing
 * the tab writes what was waiting. Where the drawing was looked at from is kept with the tab.
 */
import {
  Menu,
  Notice,
  Scope,
  TextFileView,
  type TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian'
import { createApp, reactive, type App as VueApp } from 'vue'
import DrawingBar from '@/components/drawing/DrawingBar.vue'
import { drawingSvg, parseDrawingSvg } from './drawingFile'
import { cameraFrom, type Camera } from './camera'
import { DrawingSession } from './DrawingSession'
import { THICKNESSES, emptyDrawingModel, type DrawingModel } from './model'
import { DRAWING_VIEW_TYPE } from './viewType'
import { copyEmbed } from './files'
import { visibleRect } from './camera'
import { drawingPng, withMargin } from './rasterize'
import { askAboutDrawing } from './askAgent'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SHAPE_KINDS, type Rect, type ShapeKind } from './items'

export { DRAWING_VIEW_TYPE }

export class DrawingView extends TextFileView {
  readonly model: DrawingModel = reactive(emptyDrawingModel())
  session: DrawingSession | null = null
  private vue: VueApp | null = null
  /** What was last read or written, so the vault's news of our own write is not a change. */
  private known = ''
  /** A camera from the tab's saved state, waiting for the drawing to be read. */
  private pendingCamera: Camera | null = null
  /** Drawing asked for before the drawing was read: a new drawing opens ready to draw on. */
  private pendingDraw = false
  /** A part of the drawing to show once it is read: an embed's place, opened to draw on. */
  private pendingArea: Rect | null = null
  private placed = false

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.scope = new Scope(this.app.scope)
    // While text is typed on the drawing, its keys are the field's: Esc closes it (the field's
    // own handler), and undo and delete work in the text.
    const typing = () => !!this.session?.pick.typing
    this.scope.register([], 'Escape', () => {
      if (typing() || !this.model.on) return true
      if (this.model.picked) this.session?.pick.set([])
      else this.session?.stop()
      return false
    })
    this.scope.register(['Mod'], 'z', () => {
      if (typing()) return true
      this.session?.undo()
      return false
    })
    this.scope.register(['Mod', 'Shift'], 'z', () => {
      if (typing()) return true
      this.session?.redo()
      return false
    })
    for (const key of ['Delete', 'Backspace'])
      this.scope.register([], key, () => {
        if (typing() || !this.model.picked) return true
        this.session?.deletePicked()
        return false
      })
  }

  getViewType(): string {
    return DRAWING_VIEW_TYPE
  }

  getIcon(): string {
    return 'pen-line'
  }

  getDisplayText(): string {
    return this.file?.basename ?? 'Drawing'
  }

  canAcceptExtension(extension: string): boolean {
    return extension === 'svg'
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty()
    this.contentEl.addClass('abele-drawing-view')
    const bar = this.contentEl.createDiv({ cls: 'abele-drawing-view__bar' })
    const stage = this.contentEl.createDiv({ cls: 'abele-drawing-view__stage' })
    this.session = new DrawingSession(stage, this.model, {
      changed: () => this.requestSave(),
      stopped: () => void this.save(),
    })
    this.vue = createApp(DrawingBar, {
      model: this.model,
      onToggle: () => this.session?.toggle(),
      onTool: (tool: DrawingModel['tool']) => this.session?.setTool(tool),
      onShape: (e: MouseEvent) => this.shapeMenu(e),
      onDelete: () => this.session?.deletePicked(),
      onColor: (color: DrawingModel['penColor']) => this.session?.setColor(color),
      onThickness: (e: MouseEvent) => this.thicknessMenu(e),
      onFinger: (on: boolean) => this.session?.setFinger(on),
      onUndo: () => this.session?.undo(),
      onRedo: () => this.session?.redo(),
      onZoom: (e: MouseEvent) => this.zoomMenu(e),
      onMore: (e: MouseEvent) => this.moreMenu(e),
    })
    this.vue.mount(bar)
  }

  async onClose(): Promise<void> {
    this.vue?.unmount()
    this.vue = null
    this.session?.destroy()
    this.session = null
  }

  getViewData(): string {
    const text = drawingSvg({ items: [...(this.session?.items.items ?? [])] })
    this.known = text
    return text
  }

  setViewData(data: string, clear: boolean): void {
    const session = this.session
    if (!session) return
    if (!clear && data === this.known) return
    this.known = data
    const parsed = parseDrawingSvg(data)
    session.load(parsed?.items ?? [])
    if (clear || !this.placed) this.place()
  }

  clear(): void {
    this.placed = false
    this.session?.stop()
    this.session?.load([])
  }

  /** Where the drawing is looked at from when it opens: as it was left, or all of it. */
  private place(): void {
    const session = this.session
    if (!session) return
    // A tab just made has no size yet; the camera waits for one.
    if (!session.surface.width) {
      window.requestAnimationFrame(() => this.place())
      return
    }
    this.placed = true
    if (this.pendingArea) session.show(this.pendingArea)
    else if (this.pendingCamera) session.setCamera(this.pendingCamera)
    else session.fit()
    this.pendingArea = null
    this.pendingCamera = null
    if (this.pendingDraw) session.start()
    this.pendingDraw = false
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state ?? {}) as { camera?: unknown; draw?: unknown; area?: unknown }
    this.pendingCamera = cameraFrom(s.camera)
    if (s.draw === true) this.pendingDraw = true
    const area = s.area as Rect | undefined
    if (area && [area.x, area.y, area.w, area.h].every(Number.isFinite) && area.w > 0 && area.h > 0)
      this.pendingArea = { x: area.x, y: area.y, w: area.w, h: area.h }
    await super.setState(state, result)
    // The same file again, with a place or drawing asked for: nothing is read, so act now.
    if (this.placed && (this.pendingArea || this.pendingDraw)) this.place()
  }

  getState(): Record<string, unknown> {
    const state = super.getState()
    if (this.session) state.camera = { ...this.session.camera }
    return state
  }

  // ————— Menus —————

  private thicknessMenu(e: MouseEvent): void {
    const menu = new Menu()
    for (const t of THICKNESSES)
      menu.addItem((item) =>
        item
          .setTitle(t[0].toUpperCase() + t.slice(1))
          .setChecked(this.model.thickness === t)
          .onClick(() => this.session?.setThickness(t))
      )
    menu.showAtMouseEvent(e)
  }

  /** The shape tool: taken up, or — when it is in hand already — which shape it draws. */
  private shapeMenu(e: MouseEvent): void {
    if (this.model.tool !== 'shape') {
      this.session?.setTool('shape')
      return
    }
    const menu = new Menu()
    const names: Record<ShapeKind, [string, string]> = {
      rect: ['Box', 'square'],
      ellipse: ['Ellipse', 'circle'],
      line: ['Line', 'minus'],
      arrow: ['Arrow', 'move-up-right'],
    }
    for (const kind of SHAPE_KINDS)
      menu.addItem((item) =>
        item
          .setTitle(names[kind][0])
          .setIcon(names[kind][1])
          .setChecked(this.model.shape === kind)
          .onClick(() => this.session?.setShape(kind))
      )
    menu.showAtMouseEvent(e)
  }

  private zoomMenu(e: MouseEvent): void {
    const menu = new Menu()
    menu.addItem((item) =>
      item
        .setTitle('Zoom in')
        .setIcon('zoom-in')
        .onClick(() => this.session?.zoomBy(1.25))
    )
    menu.addItem((item) =>
      item
        .setTitle('Zoom out')
        .setIcon('zoom-out')
        .onClick(() => this.session?.zoomBy(0.8))
    )
    menu.addItem((item) =>
      item
        .setTitle('Actual size')
        .setIcon('scan')
        .onClick(() => this.session?.actualSize())
    )
    menu.addItem((item) =>
      item
        .setTitle('Show the whole drawing')
        .setIcon('maximize')
        .onClick(() => this.session?.fit())
    )
    menu.showAtMouseEvent(e)
  }

  /** What else can be done with the drawing; later stages add to it. */
  protected moreMenu(e: MouseEvent): void {
    const menu = new Menu()
    const file = this.file
    const session = this.session
    if (file && session) {
      menu.addItem((item) =>
        item
          .setTitle('Copy embed of what shows')
          .setIcon('clipboard-copy')
          .onClick(() => {
            const { width, height } = session.surface
            void copyEmbed(`![[${file.path}]]`, visibleRect(session.camera, width, height))
          })
      )
      // What is picked, when something is; else the whole drawing.
      const box = session.pick.box()
      const area = box ? withMargin(box) : null
      const what = area ? 'what is picked' : 'the drawing'
      menu.addItem((item) =>
        item
          .setTitle(`Export ${what} as PNG`)
          .setIcon('image-down')
          .onClick(() => void this.exportPng(area))
      )
      menu.addItem((item) =>
        item
          .setTitle(`Copy ${what} as a picture`)
          .setIcon('copy')
          .onClick(() => void this.copyPicture(area))
      )
      if (AbeleConfig.getInstance().ai.enabled) {
        const link = `[[${file.path}]]`
        menu.addItem((item) =>
          item
            .setTitle(`Ask the agent about ${what}`)
            .setIcon('message-circle-question')
            .onClick(() => void askAboutDrawing(file, link, area, 'ask'))
        )
        menu.addItem((item) =>
          item
            .setTitle(`Transcribe the handwriting in ${what}`)
            .setIcon('text-cursor-input')
            .onClick(() => void askAboutDrawing(file, link, area, 'transcribe'))
        )
      }
    }
    this.app.workspace.trigger('file-menu', menu, this.file, 'more-options', this.leaf)
    menu.showAtMouseEvent(e)
  }

  /** A PNG of the drawing, or of a part, beside the drawing; says where. */
  async exportPng(area: Rect | null): Promise<TFile | null> {
    const file = this.file
    const session = this.session
    if (!file || !session) return null
    try {
      const blob = await drawingPng(this.contentEl.ownerDocument, session.items.items, area)
      const dir = file.parent && file.parent.path !== '/' ? `${file.parent.path}/` : ''
      let path = `${dir}${file.basename}.png`
      for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++)
        path = `${dir}${file.basename} ${n}.png`
      const png = await this.app.vault.createBinary(path, await blob.arrayBuffer())
      new Notice(`Saved as ${png.path}`)
      return png
    } catch (e) {
      new Notice(`The picture could not be saved: ${String(e)}`)
      return null
    }
  }

  private async copyPicture(area: Rect | null): Promise<void> {
    const session = this.session
    if (!session) return
    try {
      const blob = await drawingPng(this.contentEl.ownerDocument, session.items.items, area)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      new Notice('Copied as a picture')
    } catch (e) {
      new Notice(`The picture could not be copied: ${String(e)}`)
    }
  }
}
