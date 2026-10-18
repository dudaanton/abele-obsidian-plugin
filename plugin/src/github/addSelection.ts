import { presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
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
      new Notice(t('streamB.openAChatToAddThisCode.40a65f'))
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
      t('streamB.couldNotAddSelectedCode.682609', {
        v0: String(error instanceof Error ? presentUiError(error) : String(error)),
      })
    )
  }
}
