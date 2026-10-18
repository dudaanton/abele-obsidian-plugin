import { ItemView, TFile, type ViewStateResult } from 'obsidian'
import { t } from '@/i18n'
import GalleryViewer from '@/components/GalleryViewer.vue'
import { mountKit, type KitMount } from '@/components/obsidian/mount'
import { canvasPicture } from './pictureAdapter'
import { parseCanvas } from './core/model'
import { CANVAS_IMAGE_VIEW_TYPE } from './imageOpening'
import { openCanvas } from './opening'

/** A rendered picture, never a writable image file; history keeps the source and crop. */
export class CanvasImageView extends ItemView {
  navigation = true
  private state: Record<string, unknown> = {}
  private mounted: KitMount | null = null
  private abort: AbortController | null = null
  private sourcePath(): string {
    return typeof this.state.file === 'string' ? this.state.file : ''
  }
  getViewType(): string {
    return CANVAS_IMAGE_VIEW_TYPE
  }
  getIcon(): string {
    return 'image'
  }
  getDisplayText(): string {
    return this.sourcePath().split('/').pop() || 'Canvas'
  }
  async onOpen(): Promise<void> {
    this.contentEl.addClass('abele-canvas-image-view')
    this.addAction('pencil', t('streamB.edit.464c4f'), () => {
      const file = this.app.vault.getAbstractFileByPath(this.sourcePath())
      if (file instanceof TFile)
        void openCanvas(this.app, file, { ...this.state, play: false }, this.leaf)
    })
  }
  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    const changed = JSON.stringify(state) !== JSON.stringify(this.state)
    this.state = { ...state }
    await super.setState(state, result)
    ;(this as unknown as { titleEl?: HTMLElement }).titleEl?.setText(this.getDisplayText())
    if (changed) result.history = true
    this.abort?.abort()
    const abort = (this.abort = new AbortController())
    const file = this.app.vault.getAbstractFileByPath(this.sourcePath())
    if (!(file instanceof TFile)) return
    try {
      const picture = await canvasPicture(
        this.app,
        parseCanvas(await this.app.vault.read(file)),
        file.path,
        { ...state, maxSide: 3200 },
        () => true,
        abort.signal
      )
      if (abort.signal.aborted) return
      this.mounted?.unmount()
      this.contentEl.empty()
      this.mounted = mountKit(this.contentEl, GalleryViewer, {
        images: [
          {
            url: picture.canvas.toDataURL('image/png'),
            alt: file.basename,
            type: 'local',
            path: file.path,
            description: picture.say,
          },
        ],
        startIndex: 0,
        galleryFilePath: file.path,
        embedded: true,
        snapshot: true,
        onClose: () => {
          // The gallery's Escape and swipe-to-close follow the leaf's native Back path.
          void (this.leaf as unknown as { history: { back(): Promise<void> } }).history.back()
        },
      })
    } catch (error) {
      if (!abort.signal.aborted) this.contentEl.setText(String(error))
    }
  }
  getState(): Record<string, unknown> {
    return { ...this.state }
  }
  async onClose(): Promise<void> {
    this.abort?.abort()
    this.mounted?.unmount()
    this.mounted = null
  }
}
