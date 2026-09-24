/**
 * "Ask here" on words selected in a book: a new chat whose input holds a link to the words and
 * the words quoted under it. Nothing is sent; the person says what they want first. The chat is
 * let read this one book when its scope would not already — the same grant "Chat about this"
 * gives a note — so the book tools can read around the words.
 */
import { Notice, type TFile } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import { grantNote } from '@/commands/chatAboutNote'

/** Markdown's blockquote of `text`: every line marked, a blank one too, so it stays one quote. */
const blockquote = (text: string) =>
  text
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n')

/** What goes into the chat's input: the link, and the words quoted under it. */
export function bookChatText(link: string, text?: string): string {
  const words = (text ?? '').trim()
  return words ? `${link}\n${blockquote(words)}\n\n` : `${link} `
}

export async function askAboutBook(book: TFile, link: string, text?: string): Promise<boolean> {
  try {
    const chatService = ChatService.getInstance()
    const session = await chatService.openBlankChat()
    if (!session) return false
    grantNote(session.scopeResolver, book.path)
    chatService.pendingInput.value = {
      text: bookChatText(link, text),
      tabId: session.id,
      focus: true,
    }
    await chatService.revealSidebar()
    return true
  } catch (e) {
    console.error('[Abele] Asking about a book failed:', e)
    new Notice(`Could not open a chat: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}
