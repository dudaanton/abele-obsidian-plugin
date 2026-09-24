import { MarkdownRenderChild, MarkdownView, Notice, TFile } from 'obsidian'
import type { MarkdownPostProcessorContext } from 'obsidian'
import { createApp, h } from 'vue'
import Card from '@/components/obsidian/Card.vue'
import Markdown from '@/components/obsidian/Markdown.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { insertOnOwnLine } from '@/helpers/editorHelpers'
import { ChatService } from './ChatService'
import { CommentService } from './CommentService'
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
 *     ---
 *     The message, as it was written.
 *     ```
 *
 * The message is named by its id, which the chat file keeps for good — branches are built on
 * it. The chat is named by its path, which is not for good: a chat is renamed after its title,
 * and a comment moves when it is opened as a full chat. A path that has gone is looked for by the
 * message id among every chat file, and the block is corrected once the chat is found.
 */
export const MESSAGE_BLOCK = 'abele-message'

export interface MessageBlock {
  chat: string
  message: string
  text: string
}

/** The block for a message. The fence outgrows any run of backticks in the text itself. */
export function formatMessageBlock(block: MessageBlock): string {
  const longest = Math.max(0, ...(block.text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return [
    `${fence}${MESSAGE_BLOCK}`,
    `chat: ${block.chat}`,
    `message: ${block.message}`,
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
 * never cut in two, and with a blank line either side so the block stays a block.
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

  const block = formatMessageBlock({ chat, message: messageId, text: message.content })
  insertOnOwnLine(view.editor, `${block}\n`, true)
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

/** Opens a chat file the way opening it anywhere else does: a comment as a comment. */
export async function openChat(file: TFile): Promise<void> {
  const comments = CommentService.getInstance()
  if (comments.isCommentFile(file)) {
    // In the sidebar, as its marker would open it — not turned into a full chat.
    if (await comments.showInSidebar(file.basename)) return
    await comments.openFile(file)
    return
  }
  const chatService = ChatService.getInstance()
  await chatService.openChatFile(file)
  await chatService.revealSidebar()
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
    const title =
      block.chat
        .split('/')
        .pop()
        ?.replace(/\.abchat$/, '') ?? block.chat
    const host = el.createDiv({ cls: 'abele-message-card' })
    const app = createApp({
      render: () =>
        h(
          Card,
          { title, clickable: true, onClick: () => void openMessage(block, ctx.sourcePath) },
          () => h(Markdown, { text: block.text, filePath: ctx.sourcePath })
        ),
    })
    app.mount(host)
    ctx.addChild(new MessageCardChild(host, () => app.unmount()))
  })
}
