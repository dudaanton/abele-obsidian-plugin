import { Notice, TFile, type PaneType } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatService } from './ChatService'
import { CommentService } from './CommentService'
import { isChatLog } from './chatText'
import type { CommentAnchor } from './types'
import { openNoteAtLines, resolveLineLink } from '@/lineLinks/open'
import { parseMarkers } from '@/editor/commentMarkers'
import { reliableScrollTo } from '@/helpers/scrollUtils'
import { nanoid } from 'nanoid'
import { captureChatSelection } from '@/selection/anchors'
import { parseAnchorLink, resolveAnchorPath } from '@/selection/anchorLinks'
import { prepareSelectionBacklink, resolveAnchorReturn } from './chatAnchorNavigation'
import { ChatStorage } from './ChatStorage'
import { inspectChat } from './chatCopy'
import { CHAT_TEXT_PROJECTION_VERSION } from './messageComments'
import { replyMarkdownText } from './replyMarkdown'
import type { ChatSession } from './ChatSession'
import { ShellModal } from '@/modal/ShellModal'

/** Every copy is an explicit choice, including the file at the link's path hint. */
export function chooseAnchorSource(paths: string[]): Promise<string | null> {
  const { app } = GlobalStore.getInstance()
  return new Promise((resolve) => {
    let chosen: string | null = null
    const modal = new (class extends ShellModal {
      onClose(): void {
        super.onClose()
        resolve(chosen)
      }
    })(app, { title: 'Choose selection source', footer: true })
    modal.bodyEl.createEl('p', {
      text: 'Several copies of this conversation have the same identity. Choose the source to open; none is selected automatically.',
    })
    for (const path of paths) {
      const button = modal.bodyEl.createEl('button', {
        text: path,
        cls: 'abele-anchor-source__choice',
      })
      button.addEventListener('click', () => {
        chosen = path
        modal.close()
      })
      modal.bodyEl.createEl('p')
    }
    modal.addButton('Cancel', () => modal.close())
    modal.open()
  })
}

/** Validation conflicts are distinct from transport/storage errors. */
export class SelectionCaptureConflict extends Error {}

/** Capture source evidence synchronously; no identity or revision write until invoked. */
export function captureSelectionSource(
  session: ChatSession,
  messageId: string,
  quote: string,
  start: number,
  renderedText: string
) {
  const captured = session.allMessages.value.find((message) => message.id === messageId)
  const file = session.currentChatFile.value
  const content = captured?.content
  const revisionId = captured?.selection?.revisionId
  const revisions = captured?.revisions
  const role = captured?.role ?? ''
  const title = session.chatTitle.value || file?.basename || ''
  const pathHint = file?.path ?? ''
  return async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const current = session.allMessages.value.find((message) => message.id === messageId)
    if (
      !file ||
      file !== session.currentChatFile.value ||
      !current ||
      current.content !== content ||
      current.role !== role ||
      current.draft ||
      current.selection?.revisionId !== revisionId ||
      current.revisions !== revisions
    )
      throw new SelectionCaptureConflict(
        'The captured selection changed. Select the passage again.'
      )
    if ((await replyMarkdownText(current.content)) !== renderedText)
      throw new SelectionCaptureConflict(
        'The rendered selection changed. Select the passage again.'
      )
    const checked = session.allMessages.value.find((message) => message.id === messageId)
    if (
      !checked ||
      checked.content !== content ||
      checked.selection?.revisionId !== revisionId ||
      checked.revisions !== revisions
    )
      throw new SelectionCaptureConflict(
        'The captured selection changed. Select the passage again.'
      )
    signal?.throwIfAborted()
    const revision = await session.ensureSelectionRevision(messageId, {
      nextId: nanoid,
      project: (source) => {
        if (source !== content)
          throw new SelectionCaptureConflict(
            'The captured selection changed. Select the passage again.'
          )
        return { version: CHAT_TEXT_PROJECTION_VERSION, text: renderedText }
      },
    })
    const snapshot = captureChatSelection({
      revision,
      range: { space: 'rendered', start, end: start + quote.length },
      role: role === 'user' ? 'user' : 'assistant',
      author: role,
      title,
      pathHint,
      sentence: renderedText,
    })
    if (snapshot.text !== quote)
      throw new SelectionCaptureConflict(
        'The captured selection changed. Select the passage again.'
      )
    return snapshot
  }
}

/** Captured synchronously when the menu/bar is prepared; later selection/tab changes cannot retarget it. */
export function captureSelectionLink(
  session: ChatSession,
  messageId: string,
  quote: string,
  start: number,
  renderedText: string
): () => Promise<string> {
  const source = captureSelectionSource(session, messageId, quote, start, renderedText)
  const file = session.currentChatFile.value
  return async () =>
    prepareSelectionBacklink(await source(), {
      ensureAnchor: (selection) => session.ensureChatAnchor(selection),
      path: () => file!.path,
    })
}

let selectionReturnGeneration = 0

/** Ordinary note links and rendered chat links use the same identity-first adapter. */
export async function openSelectionLink(href: string): Promise<void> {
  const generation = ++selectionReturnGeneration
  const service = ChatService.getInstance()
  service.openingSelection.value = true
  try {
    const parsed = parseAnchorLink(href)
    if (!parsed) {
      new Notice('This selection link is invalid')
      return
    }
    const { app } = GlobalStore.getInstance()
    const index = await ChatStorage.getInstance().selectionIdentityIndex()
    if (generation !== selectionReturnGeneration) return
    const found = resolveAnchorPath(parsed.address.chatId, parsed.pathHint, index)
    if (found.status === 'missing') {
      new Notice('The selection source has been deleted or is unavailable')
      return
    }
    const path = found.status === 'found' ? found.path : await chooseAnchorSource(found.paths)
    if (!path || generation !== selectionReturnGeneration) return
    const file = app.vault.getAbstractFileByPath(path)
    // Validate again after a choice: a file can change while a dialog is open.
    if (
      !(file instanceof TFile) ||
      (await inspectChat(app, file)).metadata?.chatId !== parsed.address.chatId
    ) {
      new Notice('The selection source changed. Open the link again.')
      return
    }
    if (generation !== selectionReturnGeneration) return
    await openChat(file, () => generation === selectionReturnGeneration)
    const session = service.getSessionByFile(file.path)
    if (
      !session ||
      service.activeSession.value !== session ||
      generation !== selectionReturnGeneration
    )
      return
    const anchor = await session.getAnchor(parsed.address.chatId, parsed.address.anchorId)
    if (generation !== selectionReturnGeneration || service.activeSession.value !== session) return
    if (!anchor) {
      new Notice('This selection is no longer available. Reopen the chat and try again.')
      return
    }
    const target = resolveAnchorReturn(
      parsed.address.chatId,
      parsed.address.anchorId,
      session.allMessages.value,
      session.messages.value.map((message) => message.id)
    )
    if (target.status !== 'ready') {
      new Notice(
        target.status === 'missing'
          ? 'This selection is no longer available'
          : 'This selection has conflicting identities'
      )
      return
    }
    if (!session.messages.value.some((message) => message.id === target.messageId))
      session.switchBranch(target.leafId)
    if (!session.messages.value.some((message) => message.id === target.messageId)) {
      new Notice('Finish the current reply before returning to another branch')
      return
    }
    service.pendingAnchorReturn.value = { sessionId: session.id, target }
  } catch (error) {
    new Notice(error instanceof Error ? error.message : String(error))
  } finally {
    if (generation === selectionReturnGeneration) service.openingSelection.value = false
  }
}

/**
 * Opens a chat file the way opening it anywhere else does: a comment as a comment, any other
 * chat as a tab in the sidebar.
 *
 * Never in a leaf: a chat opened into the leaf that holds a note would replace the note. Obsidian's
 * own ways of opening a file are routed here by `keepChatFilesOutOfLeaves`; everything of ours
 * that can open a chat calls this directly.
 */
export async function openChat(file: TFile, selectionReturn?: () => boolean): Promise<void> {
  if (selectionReturn && !selectionReturn()) return
  // File links address this exact file. ChatService classifies committed metadata through
  // storage preparation and hands discussions to their owner; basename marker lookup is not
  // a file opener, including for same-basename copies already discovered outside the folder.
  const chatService = ChatService.getInstance()
  // One generation decision spans preparation, shared loading and contextual showing.
  // A late waiter or a second presentation stage must not manufacture a fresh release claim.
  const current = chatService.contextualOpenGuard(
    chatService.getSessionByFile(file.path) ?? CommentService.getInstance().getSessionByFile(file.path),
    selectionReturn
  )
  const opened = selectionReturn
    ? await chatService.openContextualChatFile(file, selectionReturn, current)
    : await chatService.openContextualChatFile(file, undefined, current)
  if (!opened || !current()) return
  const session = chatService.getSessionByFile(file.path)
  if (session?.kind === 'comment' && session.commentId) {
    // Preserve the single contextual discussion tab (including return from a child), but
    // address it by the identity prepared for this exact file, never the file's basename.
    const comments = CommentService.getInstance()
    await comments.showInSidebar(session.commentId, current)
    return
  }
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
  if (href.includes('#abele-selection=')) {
    await openSelectionLink(href)
    return
  }
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
export async function revealAnswer(anchor: CommentAnchor, commentId?: string): Promise<boolean> {
  const { app } = GlobalStore.getInstance()
  const chat = app.vault.getAbstractFileByPath(anchor.note)
  if (!anchor.message || !(chat instanceof TFile)) {
    new Notice('The chat this was asked in has been deleted')
    return false
  }
  await openChat(chat)
  const service = ChatService.getInstance()
  let start: number | undefined
  if (anchor.quote && commentId) {
    try {
      start = await CommentService.getInstance().replyCommentStart(anchor.note, commentId)
    } catch {
      /* Missing metadata still has a quote; navigation can use its nearest occurrence. */
    }
  }
  service.pendingPassage.value = anchor.quote
    ? { path: anchor.note, message: anchor.message, quote: anchor.quote, start }
    : null
  service.pendingReveal.value = anchor.message
  return true
}

/**
 * Back to where a comment hangs: the message it is on, in the chat or the comment above it, or
 * its marker in a note — opened and scrolled to. The one way back, used by a comment's own back
 * button and by every level of the trail over it, each passing the level below the one it opens.
 */
export async function revealAnchor(commentId: string, anchor: CommentAnchor): Promise<boolean> {
  if (anchor.message) return revealAnswer(anchor, commentId)

  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(anchor.note)
  if (!(file instanceof TFile)) {
    new Notice(
      anchor.cfi
        ? 'The book this was asked in has been deleted'
        : 'The note this was asked in has been deleted'
    )
    return false
  }

  // A discussion in a book goes back to its words there: the book opens at them, selected.
  if (anchor.cfi) {
    const { placeSubpath } = await import('@/reader/bookLinks')
    await app.workspace.openLinkText(
      `${anchor.note}${placeSubpath({ cfi: anchor.cfi })}`,
      '',
      false
    )
    return true
  }

  await app.workspace.openLinkText(anchor.note, '', false)

  const marker = parseMarkers(await app.vault.cachedRead(file)).find((candidate) =>
    candidate.ids.includes(commentId)
  )
  if (marker) reliableScrollTo(marker.from)
  return true
}
