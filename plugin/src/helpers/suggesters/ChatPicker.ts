import { App, FuzzySuggestModal, TFile } from 'obsidian'
import { ChatStorage } from '@/ai/ChatStorage'
import type { AiChatHistoryEntry } from '@/ai/types'

/**
 * Picks one of the agent chats in the history, to attach to another.
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
    private readonly exclude: string | undefined
  ) {
    super(app)
    this.setPlaceholder('Search for a chat...')
  }

  getItems(): AiChatHistoryEntry[] {
    return ChatStorage.getInstance()
      .getHistory()
      .filter((entry) => entry.path !== this.exclude)
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

/** @param exclude the chat doing the attaching, which has no use for itself */
export function pickChat(app: App, exclude?: string): Promise<TFile | null> {
  return new ChatModal(app, exclude).pick()
}
