import { App, FuzzySuggestModal, TFile } from 'obsidian'
import { isAllowedAttachment } from '@/ai/attachments'

class VaultFileModal extends FuzzySuggestModal<TFile> {
  private resolve: (file: TFile | null) => void = () => {}
  private picked = false

  constructor(
    app: App,
    private readonly accepts: (file: TFile) => boolean = (f) => isAllowedAttachment(f.path)
  ) {
    super(app)
    this.setPlaceholder('Search for a file...')
    // Said in place of Obsidian's bare "No results found.", naming what was looked for.
    this.emptyStateText = 'No file has that in its name.'
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter(this.accepts)
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

/** Any file of the vault that `accepts` lets through — every file when it is left out. */
export function pickAnyFile(app: App, accepts: (file: TFile) => boolean = () => true) {
  return new VaultFileModal(app, accepts).pick()
}
