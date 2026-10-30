import type { ChatSession } from './ChatSession'
import { GlobalStore } from '@/stores/GlobalStore'

/** Owner UI only. File tools always project a chat through chatForAgent instead. */
export async function copyFullChatLog(
  session: ChatSession,
  clipboard: Pick<Clipboard, 'writeText'> = navigator.clipboard
): Promise<void> {
  const file = session.currentChatFile.value
  if (!file) throw new Error('No saved chat to export')
  await session.saveForRelease()
  if (session.currentChatFile.value !== file) throw new Error('Chat changed while saving')
  const content = await GlobalStore.getInstance().app.vault.read(file)
  await clipboard.writeText(content)
}
