import { App, FuzzySuggestModal, TFile } from 'obsidian'

const MEDIA_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'mp4',
  'webm',
  'mov',
  'mkv',
  'avi',
  'ogv',
]

class ImagePickerModal extends FuzzySuggestModal<TFile> {
  private resolve: (file: TFile | null) => void = () => {}
  private picked = false

  constructor(app: App) {
    super(app)
    this.setPlaceholder('Search for an image or video...')
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((f) => MEDIA_EXTENSIONS.includes(f.extension.toLowerCase()))
  }

  getItemText(file: TFile): string {
    return file.path
  }

  onChooseItem(file: TFile): void {
    this.picked = true
    this.resolve(file)
  }

  onClose(): void {
    window.setTimeout(() => {
      if (!this.picked) this.resolve(null)
    }, 0)
  }

  pick(): Promise<TFile | null> {
    return new Promise((resolve) => {
      this.resolve = resolve
      this.open()
    })
  }
}

export function pickImageFile(app: App): Promise<TFile | null> {
  return new ImagePickerModal(app).pick()
}
