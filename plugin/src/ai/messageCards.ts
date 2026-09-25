import { MarkdownRenderChild, MarkdownView, Notice, TFile } from 'obsidian'
import type { MarkdownPostProcessorContext } from 'obsidian'
import { createApp, h } from 'vue'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import Card from '@/components/obsidian/Card.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Markdown from '@/components/obsidian/Markdown.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { insertBlockOnOwnLine } from '@/helpers/editorHelpers'
import { ChatService } from './ChatService'
import { openChat } from './openChat'
import type { ChatSession } from './ChatSession'
import type { ChatMessage } from './types'

/**
 * A message from a chat, kept in a note as a card that leads back to it.
 *
 * Written as a fenced block so that Obsidian leaves its text alone and draws it in reading mode
 * and live preview alike:
 *
 *     ```abele-message
 *     chat: AI/Chats/Planning the trip.abchat
 *     message: V1StGXR8_Z5jdHi6B-myT
 *     title: Planning the trip
 *     date: 2026-09-23 14:05
 *     ---
 *     The message, as it was written.
 *     ```
 *
 * The message is named by its id, which the chat file keeps for good — branches are built on
 * it. The chat is named by its path, which is not for good: a chat is renamed after its title,
 * and a comment moves when it is opened as a full chat. A path that has gone is looked for by the
 * message id among every chat file, and the block is corrected once the chat is found.
 *
 * `title` and `date` are what the card shows: the chat's title when the card was made, and when
 * the message was written. Both are optional — a card from before them shows the file name — and
 * they come after `chat` and `message`, whose two adjacent lines are what a moved chat is
 * corrected by.
 */
export const MESSAGE_BLOCK = 'abele-message'

dayjs.extend(customParseFormat)

export interface MessageBlock {
  chat: string
  message: string
  title?: string
  /** Local time, `YYYY-MM-DD HH:mm`. */
  date?: string
  text: string
}

const DATE_FORMAT = 'YYYY-MM-DD HH:mm'

/** The block for a message. The fence outgrows any run of backticks in the text itself. */
export function formatMessageBlock(block: MessageBlock): string {
  const longest = Math.max(0, ...(block.text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return [
    `${fence}${MESSAGE_BLOCK}`,
    `chat: ${block.chat}`,
    `message: ${block.message}`,
    // One line each: a title holding a line break would end the field and start the text.
    ...(block.title ? [`title: ${block.title.replace(/\s+/g, ' ').trim()}`] : []),
    ...(block.date ? [`date: ${block.date}`] : []),
    '---',
    block.text.trimEnd(),
    fence,
  ].join('\n')
}

/** Reads what is between the fences. Null for a block that names no chat or no message. */
export function parseMessageBlock(source: string): MessageBlock | null {
  const lines = source.split('\n')
  const fields: Record<string, string> = {}
  let i = 0
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '---') break
    const match = /^(\w+):\s*(.*)$/.exec(line)
    if (match) fields[match[1]] = match[2].trim()
  }
  if (!fields.chat || !fields.message) return null
  return {
    chat: fields.chat,
    message: fields.message,
    ...(fields.title ? { title: fields.title } : {}),
    ...(fields.date ? { date: fields.date } : {}),
    text: lines
      .slice(i + 1)
      .join('\n')
      .trim(),
  }
}

/**
 * The note the card goes into, and where in it.
 *
 * A comment's own note when one is open, because a comment is a conversation about that note;
 * otherwise the note the person was last in. The sidebar holding the chat is the active leaf
 * while its button is pressed, so "last in" is the most recent leaf of the main area.
 */
function targetView(session: ChatSession): MarkdownView | null {
  const { workspace } = GlobalStore.getInstance().app
  const note = session.anchor.value?.note
  if (note) {
    const views = workspace
      .getLeavesOfType('markdown')
      .map((leaf) => leaf.view)
      .filter((view): view is MarkdownView => view instanceof MarkdownView)
    const own = views.find((view) => view.file?.path === note)
    if (own) return own
  }
  const recent = workspace.getMostRecentLeaf(workspace.rootSplit)?.view
  return recent instanceof MarkdownView && recent.file ? recent : null
}

/**
 * Puts a card for one message at the cursor of the note being worked in.
 *
 * On a line of its own: after the cursor's line when that line has text, so a paragraph is
 * never cut in two, with a blank line before it and exactly one after.
 */
export async function insertMessageCard(session: ChatSession, messageId: string): Promise<boolean> {
  const message = session.allMessages.value.find((m: ChatMessage) => m.id === messageId)
  if (!message) return false

  const view = targetView(session)
  if (!view) {
    new Notice('Open a note to put the message in')
    return false
  }

  // A chat nobody has written to yet has no file, and a card needs one to lead back to.
  if (!session.currentChatFile.value) await session.save()
  const chat = session.currentChatFile.value?.path
  if (!chat) {
    new Notice('The chat has not been saved yet')
    return false
  }

  const block = formatMessageBlock({
    chat,
    message: messageId,
    title: session.chatTitle.value || undefined,
    date: dayjs(message.timestamp).format(DATE_FORMAT),
    text: message.content,
  })
  insertBlockOnOwnLine(view.editor, block)
  new Notice(`Added to ${view.file?.basename ?? 'the note'}`)
  return true
}

/** Every chat file in the vault that holds this message: comments, chats and history alike. */
async function findChatByMessage(messageId: string): Promise<TFile | null> {
  const { vault } = GlobalStore.getInstance().app
  const needle = JSON.stringify(messageId)
  for (const file of vault.getFiles()) {
    if (file.extension !== 'abchat') continue
    if ((await vault.cachedRead(file)).includes(needle)) return file
  }
  return null
}

/**
 * Opens the chat a card came from and shows its message.
 *
 * A chat that has moved since is found by the message, and the card's note is corrected to
 * point at where it went, so the search happens once.
 */
export async function openMessage(block: MessageBlock, notePath?: string): Promise<void> {
  const { vault } = GlobalStore.getInstance().app
  let file = vault.getFileByPath(block.chat)
  if (!file) {
    file = await findChatByMessage(block.message)
    if (!file) {
      new Notice('The chat this message came from is gone')
      return
    }
    const note = notePath ? vault.getFileByPath(notePath) : null
    const moved = file.path
    if (note) {
      await vault.process(note, (text) =>
        text
          .split(`chat: ${block.chat}\nmessage: ${block.message}`)
          .join(`chat: ${moved}\nmessage: ${block.message}`)
      )
    }
  }
  await openChat(file)
  ChatService.getInstance().pendingReveal.value = block.message
}

/**
 * The note without the card for this message, and without one of the blank lines around it, so
 * the text on either side closes up as it was before the card came.
 *
 * Found by its message rather than taken on trust from the line it was drawn at: the note may
 * have been edited since. `near` — that line — picks between two cards of the same message.
 */
export function removeMessageBlock(text: string, messageId: string, near?: number): string {
  const lines = text.split('\n')
  const opening = new RegExp(`^(\`{3,})${MESSAGE_BLOCK}$`)
  const found: { start: number; end: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = opening.exec(lines[i].trim())
    if (!open) continue
    let end = i + 1
    while (end < lines.length && lines[end].trim() !== open[1]) end++
    if (end >= lines.length) break
    if (parseMessageBlock(lines.slice(i + 1, end).join('\n'))?.message === messageId) {
      found.push({ start: i, end })
    }
    i = end
  }
  if (!found.length) return text

  const { start, end } =
    near === undefined
      ? found[0]
      : found.reduce((best, b) =>
          Math.abs(b.start - near) < Math.abs(best.start - near) ? b : best
        )
  lines.splice(start, end - start + 1)
  const blank = (n: number) => n >= 0 && n < lines.length && lines[n].trim() === ''
  if (blank(start) && (start === 0 || blank(start - 1))) lines.splice(start, 1)
  else if (start === lines.length && blank(start - 1)) lines.splice(start - 1, 1)
  return lines.join('\n')
}

/** Takes a card out of the note it is in. */
async function removeCard(block: MessageBlock, notePath: string, near?: number): Promise<void> {
  const { vault } = GlobalStore.getInstance().app
  const note = vault.getFileByPath(notePath)
  if (!note) return
  await vault.process(note, (text) => removeMessageBlock(text, block.message, near))
}

/**
 * What the card is called: the title the chat history has for the chat now, since a chat is
 * retitled after the card was made; else the one written into the card; else the file's name.
 */
function cardTitle(block: MessageBlock): string {
  const history = AbeleConfig.getInstance().ai?.chatHistory ?? []
  const current = history.find((entry) => entry.path === block.chat)?.title
  const name = block.chat
    .split('/')
    .pop()
    ?.replace(/\.abchat$/, '')
  return current || block.title || name || block.chat
}

/** When the message was written, in the form the chat history dates a chat. */
function cardMeta(block: MessageBlock): string[] | undefined {
  if (!block.date) return undefined
  const date = dayjs(block.date, DATE_FORMAT, true)
  return date.isValid() ? [date.format('D MMM YYYY, HH:mm')] : undefined
}

class MessageCardChild extends MarkdownRenderChild {
  constructor(
    el: HTMLElement,
    private readonly dispose: () => void
  ) {
    super(el)
  }

  onunload(): void {
    this.dispose()
  }
}

/** The card, built from the kit's own `Card` and `Markdown`: nothing drawn here is new. */
export function registerMessageCardBlock(
  register: (
    language: string,
    handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void
  ) => void
): void {
  register(MESSAGE_BLOCK, (source, el, ctx) => {
    const block = parseMessageBlock(source)
    if (!block) {
      el.createDiv({ cls: 'abele-map-error', text: 'This message card names no chat' })
      return
    }
    const host = el.createDiv({ cls: 'abele-message-card' })
    const remove = (): void => void removeCard(block, ctx.sourcePath, ctx.getSectionInfo(el)?.lineStart)
    const app = createApp({
      render: () =>
        h(
          Card,
          {
            title: cardTitle(block),
            meta: cardMeta(block),
            clickable: true,
            onClick: () => void openMessage(block, ctx.sourcePath),
          },
          {
            // The delete icon a chat's own card has in the history, in the same place.
            actions: () => h(Icon, { icon: 'trash', tooltip: 'Remove card', onClick: remove }),
            default: () => h(Markdown, { text: block.text, filePath: ctx.sourcePath }),
          }
        ),
    })
    app.mount(host)
    ctx.addChild(new MessageCardChild(host, () => app.unmount()))
  })
}
