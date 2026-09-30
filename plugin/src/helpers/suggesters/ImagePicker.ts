import { App, FuzzySuggestModal, Notice, TFile } from 'obsidian'
import { imageFileForImport } from '@/media/importImageFile'

const MEDIA_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'heic',
  'heif',
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

export async function pickImageFile(app: App): Promise<TFile | null> {
  const file = await new ImagePickerModal(app).pick()
  if (!file) return null
  try {
    return await imageFileForImport(app, file)
  } catch (error) {
    new Notice(`Failed to import ${file.name}: ${error instanceof Error ? error.message : error}`)
    return null
  }
}
