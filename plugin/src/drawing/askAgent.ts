/**
 * A drawing handed to the agent from its tab: a new chat, let see this drawing whatever its
 * scope, with the question begun in its input — about all of the drawing or the part picked, or
 * asking for the handwriting as text. Nothing is sent; the person finishes the question first.
 * The agent looks with `look_at_drawing`.
 */
import { Notice, type TFile } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import { grantNote } from '@/commands/chatAboutNote'
import { formatView } from './embedFormat'
import type { Rect } from './items'

export type DrawingQuestion = 'ask' | 'transcribe'

/** What goes into the chat's input. */
export function drawingQuestion(link: string, area: Rect | null, kind: DrawingQuestion): string {
  const where = area ? `the part of ${link} at ${formatView(area)} (picked)` : link
  return kind === 'transcribe'
    ? `Transcribe the handwriting in ${where} as text, keeping its lines and lists.`
    : `Look at ${where}: `
}

export async function askAboutDrawing(
  file: TFile,
  link: string,
  area: Rect | null,
  kind: DrawingQuestion
): Promise<boolean> {
  try {
    const chatService = ChatService.getInstance()
    const session = await chatService.openBlankChat()
    if (!session) return false
    grantNote(session.scopeResolver, file.path)
    chatService.pendingInput.value = {
      text: drawingQuestion(link, area, kind),
      tabId: session.id,
      focus: true,
    }
    await chatService.revealSidebar()
    return true
  } catch (e) {
    console.error('[Abele] Asking about a drawing failed:', e)
    new Notice(`Could not open a chat: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}
