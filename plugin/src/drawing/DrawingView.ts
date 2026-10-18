/** Read-only compatibility for previously saved drawing tabs. */
import { TextFileView } from 'obsidian'
import { DRAWING_VIEW_TYPE } from './viewType'
import { vaultUrl } from '@/helpers/vaultUrl'
export { DRAWING_VIEW_TYPE }

export class DrawingView extends TextFileView {
  private source = ''
  getViewType(): string {
    return DRAWING_VIEW_TYPE
  }
  getDisplayText(): string {
    return this.file?.basename ?? 'SVG'
  }
  getIcon(): string {
    return 'image'
  }
  canAcceptExtension(extension: string): boolean {
    return extension === 'svg'
  }
  getViewData(): string {
    return this.source
  }
  setViewData(data: string, clear: boolean): void {
    if (clear) this.clear()
    this.source = data
    this.contentEl.empty()
    if (this.file) {
      const image = this.contentEl.createEl('img', { cls: 'abele-legacy-drawing' })
      image.src = vaultUrl(this.app, this.file)
      image.alt = this.file.basename
    }
  }
  clear(): void {
    this.source = ''
    this.contentEl.empty()
  }
}
