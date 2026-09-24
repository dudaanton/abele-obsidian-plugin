import { Notice, TFile, type PaneType } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatService } from './ChatService'
import { CommentService } from './CommentService'
import { isChatLog } from './chatText'
import type { CommentAnchor } from './types'
import { openNoteAtLines, resolveLineLink } from '@/lineLinks/open'

/**
 * Opens a chat file the way opening it anywhere else does: a comment as a comment, any other
 * chat as a tab in the sidebar.
 *
 * Never in a leaf. A chat file that lands in one is taken straight out of it for the sidebar
 * (`main.ts`, on active-leaf-change) and the leaf is detached — so a chat opened in the leaf
 * that held a note closes that note. Everything that can open a chat comes through here.
 */
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

/** A file named in a chat — an attachment, a tool's target: a chat to the sidebar, the rest to the editor. */
export async function openVaultFile(path: string): Promise<void> {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return
  if (isChatLog(file.path)) {
    await openChat(file)
    return
  }
  await app.workspace.getLeaf(false).openFile(file)
}

/**
 * An internal link clicked in rendered text: `openLinkText`, unless it leads to a chat — or to
 * lines of a note (`[[Note#L10-L12]]`), which open with those lines selected. `pane` is what
 * the click asked for (`Keymap.isModEvent`): false for the leaf a plain click reuses.
 */
export async function openLink(
  href: string,
  sourcePath: string,
  pane: PaneType | false = false
): Promise<void> {
  const { app } = GlobalStore.getInstance()
  const atLines = resolveLineLink(app, href, sourcePath)
  if (atLines) {
    await openNoteAtLines(app, atLines.file, atLines.lines, pane)
    return
  }
  const linkpath = href.split('#')[0]
  const target = linkpath ? app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath) : null
  if (target && isChatLog(target.path)) {
    await openChat(target)
    return
  }
  await app.workspace.openLinkText(href, sourcePath, pane)
}

/**
 * Back from a comment on an answer to the answer: its chat in front, the answer brought into
 * view and flashed there — on its branch, switched to when another is showing. False, and the
 * person told, when the chat has been deleted since.
 */
export async function revealAnswer(anchor: CommentAnchor): Promise<boolean> {
  const { app } = GlobalStore.getInstance()
  const chat = app.vault.getAbstractFileByPath(anchor.note)
  if (!anchor.message || !(chat instanceof TFile)) {
    new Notice('The chat this was asked in has been deleted')
    return false
  }
  await openChat(chat)
  ChatService.getInstance().pendingReveal.value = anchor.message
  return true
}
