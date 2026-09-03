import dayjs from 'dayjs'
import { TFile } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { GlobalStore } from '@/stores/GlobalStore'
import type { AiChatHistoryEntry } from '@/ai/types'

/**
 * One card's worth of a chat that changed a note.
 *
 * Built entirely from the chat's index entry — never from its file. A footer under a note with
 * a hundred linked chats would otherwise read a hundred files to draw itself, which is exactly
 * what mirroring `touched` into the index is for.
 */
export class ChatLink {
  readonly path: string
  readonly title: string
  readonly recap: string
  /** When this chat last wrote *this* note, not when it last wrote anything. */
  readonly touchedAt: dayjs.Dayjs | null
  private readonly agentId: string

  constructor(entry: AiChatHistoryEntry, notePath: string) {
    this.path = entry.path
    this.title = entry.title || 'Chat'
    this.recap = entry.recap || ''
    this.agentId = entry.agentId || ''
    const touch = entry.notes?.find((note) => note.path === notePath)
    const parsed = touch ? dayjs(touch.at) : null
    this.touchedAt = parsed?.isValid() ? parsed : null
  }

  /** The agent's name, for the badge. Empty when the agent has since been deleted. */
  get agentName(): string {
    if (!this.agentId) return ''
    return AgentRegistry.getInstance().get(this.agentId)?.name ?? ''
  }

  /** Opens the chat in the sidebar. Does nothing when the file is gone. */
  async open(): Promise<void> {
    const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(this.path)
    if (!(file instanceof TFile)) return

    const service = ChatService.getInstance()
    await service.openChatFile(file)
    await service.revealSidebar()
  }
}
