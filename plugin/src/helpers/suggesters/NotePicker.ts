import { App, FuzzySuggestModal, TFile } from 'obsidian'

export interface NotePickerOptions {
  /** Offered first — the note in front, which is the one a person usually means. */
  first?: string
  /** Notes not to offer: the ones the chat is already attached to. */
  exclude?: ReadonlySet<string>
  placeholder?: string
}

/**
 * Picks one note of the vault, to attach a chat to.
 *
 * Before anything is typed the list is in the order a person would look: the note in front,
 * then the ones opened lately, then the rest. Obsidian's fuzzy match takes over from the first
 * letter. Only notes — a chat links to what has a footer to show it under.
 */
class NoteModal extends FuzzySuggestModal<TFile> {
  private resolve: (file: TFile | null) => void = () => {}
  private picked = false

  constructor(
    app: App,
    private readonly options: NotePickerOptions
  ) {
    super(app)
    this.setPlaceholder(options.placeholder ?? 'Search for a note...')
  }

  getItems(): TFile[] {
    const exclude = this.options.exclude ?? new Set<string>()
    const notes = this.app.vault.getMarkdownFiles().filter((f) => !exclude.has(f.path))
    const byPath = new Map(notes.map((f) => [f.path, f]))
    const ordered: TFile[] = []
    const take = (path: string | undefined) => {
      if (!path) return
      const file = byPath.get(path)
      if (!file) return
      ordered.push(file)
      byPath.delete(path)
    }
    take(this.options.first)
    for (const path of this.app.workspace?.getLastOpenFiles?.() ?? []) take(path)
    return [...ordered, ...byPath.values()]
  }

  getItemText(file: TFile): string {
    return file.path.replace(/\.md$/, '')
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

export function pickNote(app: App, options: NotePickerOptions = {}): Promise<TFile | null> {
  return new NoteModal(app, options).pick()
}
