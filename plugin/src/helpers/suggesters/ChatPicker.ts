import { App, FuzzySuggestModal, TFile } from 'obsidian'
import { ChatStorage } from '@/ai/ChatStorage'
import type { AiChatHistoryEntry } from '@/ai/types'

/**
 * Picks one of the agent chats in the history — to attach to another, or to a note.
 *
 * The history rather than the vault's files: it is the list a person already knows their chats
 * by — titled, newest first — and it leaves out comments and delegated runs, which are logs
 * nobody opens as a conversation of their own.
 */
class ChatModal extends FuzzySuggestModal<AiChatHistoryEntry> {
  private resolve: (file: TFile | null) => void = () => {}
  private picked = false

  constructor(
    app: App,
    private readonly exclude: string | undefined,
    private readonly options: ChatPickerOptions
  ) {
    super(app)
    this.setPlaceholder(options.placeholder ?? 'Search for a chat...')
  }

  getItems(): AiChatHistoryEntry[] {
    const hide = this.options.hide
    return ChatStorage.getInstance()
      .getHistory()
      .filter((entry) => entry.path !== this.exclude)
      .filter((entry) => !hide?.(entry))
      .filter((entry) => this.app.vault.getAbstractFileByPath(entry.path) instanceof TFile)
  }

  getItemText(entry: AiChatHistoryEntry): string {
    return entry.title || entry.path
  }

  onChooseItem(entry: AiChatHistoryEntry): void {
    this.picked = true
    const file = this.app.vault.getAbstractFileByPath(entry.path)
    this.resolve(file instanceof TFile ? file : null)
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

export interface ChatPickerOptions {
  /** Chats not worth offering — the ones already attached to the note asking. */
  hide?: (entry: AiChatHistoryEntry) => boolean
  placeholder?: string
}

/** @param exclude the chat doing the attaching, which has no use for itself */
export function pickChat(
  app: App,
  exclude?: string,
  options: ChatPickerOptions = {}
): Promise<TFile | null> {
  return new ChatModal(app, exclude, options).pick()
}
