/**
 * "Chat about this" and "Ask here" from a GitHub tab: a new chat whose input already holds a link
 * to what the person is looking at — the item, the lines they selected with their code quoted
 * under it, or the words they selected in a comment, quoted under the comment's link. Nothing is
 * sent; the person says what they want first, as with a note.
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

/** Words selected in a comment, a description or a rendered file, quoted as a blockquote. */
export interface ProseQuote {
  text: string
  /** A line before the quote: which comments it runs across. */
  note?: string
}

export type ChatQuote = Quote | ProseQuote

const isProse = (quote: ChatQuote): quote is ProseQuote => !('code' in quote)

/** Markdown's blockquote of `text`: every line marked, a blank one too, so it stays one quote. */
export function blockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n')
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

/**
 * What goes into the chat's input: the link, and the quoted code or words under it when there are
 * some. Words end with a blank line, so what the person writes next is not part of the quote.
 */
export function githubChatText(link: GithubLink, quote?: ChatQuote): string {
  const head = markdownLink(link)
  if (!quote) return `${head} `
  if (isProse(quote)) {
    if (!quote.text) return `${head} `
    const note = quote.note ? `${quote.note}\n` : ''
    return `${head}\n${note}${blockquote(quote.text)}\n\n`
  }
  if (!quote.code) return `${head} `
  const fence = fenceFor(quote.code)
  return `${head}\n${fence}${languageOf(quote)}\n${quote.code}\n${fence}\n`
}

/** Opens the chat. Answers whether one was opened — a full tab bar refuses. */
export async function chatAboutGithub(link: GithubLink, quote?: ChatQuote): Promise<boolean> {
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
  quote?: ChatQuote
): Promise<void> {
  try {
    await chatAboutGithub(await link, quote)
  } catch (e) {
    console.error('[Abele] Chat about a GitHub item failed:', e)
    new Notice(`Could not open a chat: ${e instanceof Error ? e.message : String(e)}`)
  }
}
