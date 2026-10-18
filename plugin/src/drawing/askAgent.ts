import { t } from '@/i18n'
/**
 * Canvas content attached to the chat in front as a picture: a PNG saved with the vault's attachments,
 * put into what is being written there — models take pictures, not the drawing's SVG.
 */
import { Notice, type App, type TFile } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
/** The name of the PNG a drawing goes to a chat as. */
export function drawingAttachmentName(basename: string, part: boolean): string {
  return `${basename}${part ? ' (part)' : ''}.png`
}

type Chats = Pick<ChatService, 'activeSession' | 'openBlankChat' | 'pendingInput' | 'revealSidebar'>

/**
 * The drawing as a PNG — `png` paints it, all of it or the part — saved where the vault keeps a
 * note's attachments, and attached to what is being written in the chat in front, or in a new
 * chat when none is. Says the file it made; null, with the chat left alone, when there was no
 * picture to make.
 */
export async function attachDrawingToChat(
  app: App,
  file: TFile,
  part: boolean,
  png: () => Promise<Blob>,
  chats: Chats = ChatService.getInstance()
): Promise<TFile | null> {
  let made: TFile
  try {
    const blob = await png()
    const name = drawingAttachmentName(file.basename, part)
    const path = await app.fileManager.getAvailablePathForAttachment(name, file.path)
    made = await app.vault.createBinary(path, await blob.arrayBuffer())
  } catch (e) {
    console.error('[Abele] Attaching a drawing to the chat failed:', e)
    new Notice(
      t('streamC.5f081782590e50ea', { v1: String(e instanceof Error ? e.message : String(e)) })
    )
    return null
  }
  const session = chats.activeSession.value ?? (await chats.openBlankChat())
  if (!session) return made
  chats.pendingInput.value = { text: '', attachments: [made.path], tabId: session.id, focus: true }
  await chats.revealSidebar()
  return made
}
