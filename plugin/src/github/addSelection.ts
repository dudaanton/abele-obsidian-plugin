import { ChatService } from '@/ai/ChatService'
import { Notice } from 'obsidian'
import { githubChatText, type Quote } from './chatAbout'
import type { GithubLink } from './permalinks'

export async function addGithubSelection(link: Promise<GithubLink>, quote: Quote): Promise<void> {
  try {
    const chats = ChatService.getInstance()
    const session = chats.activeSession.value
    const version = session?.conversationVersion.value
    const text = githubChatText(await link, quote)
    if (!session) {
      new Notice('Open a chat to add this code')
      return
    }
    chats.pendingInput.value = {
      text,
      append: true,
      focus: true,
      tabId: session.id,
      conversationVersion: version,
    }
    await chats.revealSidebar()
  } catch (error) {
    new Notice(
      `Could not add selected code: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
