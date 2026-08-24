import { App, FuzzySuggestModal, TFile } from 'obsidian'
import { isAllowedAttachment } from '@/ai/attachments'

class VaultFileModal extends FuzzySuggestModal<TFile> {
  private resolve: (file: TFile | null) => void = () => {}
  private picked = false

  constructor(app: App) {
    super(app)
    this.setPlaceholder('Search for a file...')
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => isAllowedAttachment(f.path))
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

export function pickVaultFile(app: App): Promise<TFile | null> {
  return new VaultFileModal(app).pick()
}
