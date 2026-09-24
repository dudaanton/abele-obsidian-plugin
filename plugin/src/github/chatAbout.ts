/**
 * "Chat about this" and "Ask here" from a GitHub tab: a new chat whose input already holds a link
 * to what the person is looking at — the item, or the lines they selected with their code quoted
 * under it. Nothing is sent; the person says what they want first, as with a note.
 *
 * The chat reaches the item through the GitHub tools (`github_read`, `github_file`, …), which
 * need nothing granted: they read GitHub, not the vault.
 */
import { Notice } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import { markdownLink, type GithubLink } from './permalinks'

export interface Quote {
  code: string
  /** The file the code is from, which names the fence's language. */
  path: string
  /** A diff's lines, with their `+`/`-` signs. */
  diff?: boolean
}

/** A fence long enough that no run of backticks in the code closes it early. */
function fenceFor(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

function languageOf(quote: Quote): string {
  if (quote.diff) return 'diff'
  const name = quote.path.split('/').pop() ?? ''
  return name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
}

/** What goes into the chat's input: the link, and the quoted code under it when there is some. */
export function githubChatText(link: GithubLink, quote?: Quote): string {
  const head = markdownLink(link)
  if (!quote?.code) return `${head} `
  const fence = fenceFor(quote.code)
  return `${head}\n${fence}${languageOf(quote)}\n${quote.code}\n${fence}\n`
}

/** Opens the chat. Answers whether one was opened — a full tab bar refuses. */
export async function chatAboutGithub(link: GithubLink, quote?: Quote): Promise<boolean> {
  const chatService = ChatService.getInstance()
  const session = await chatService.openBlankChat()
  if (!session) return false
  chatService.pendingInput.value = {
    text: githubChatText(link, quote),
    tabId: session.id,
    focus: true,
  }
  await chatService.revealSidebar()
  return true
}

/** The same, for a button: waits for a link still being made and says what went wrong. */
export async function askAboutGithub(
  link: GithubLink | Promise<GithubLink>,
  quote?: Quote
): Promise<void> {
  try {
    await chatAboutGithub(await link, quote)
  } catch (e) {
    console.error('[Abele] Chat about a GitHub item failed:', e)
    new Notice(`Could not open a chat: ${e instanceof Error ? e.message : String(e)}`)
  }
}
