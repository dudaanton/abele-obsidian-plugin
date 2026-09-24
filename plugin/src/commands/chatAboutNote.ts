/**
 * "Chat about this": a new chat whose first message starts with a link to the note.
 *
 * Offered wherever a note is right-clicked — the file explorer, a tab's header and its "more
 * options" menu (all three are Obsidian's `file-menu`), the editor — and as a command for the
 * note in front. The link is written by Obsidian's own link generator, so it follows the
 * vault's link settings, and it is only prefilled: the person says what they want before
 * anything is sent.
 *
 * Any vault file is offered, not only notes: an agent reads pictures and text files as well.
 * Chat logs are not — no scope takes one in, and a chat reaches an agent only by being attached.
 */
import { Notice, TFile, type TAbstractFile, type Plugin } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import type { ScopeResolver } from '@/ai/ScopeResolver'
import { isChatLog } from '@/ai/chatText'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'

export const CHAT_ABOUT_TITLE = 'Chat about this'
const CHAT_ABOUT_ICON = 'message-square-plus'

/** Whether this is something a chat can be about. */
export function canChatAbout(file: TAbstractFile | null | undefined): file is TFile {
  return file instanceof TFile && !isChatLog(file.path)
}

/**
 * Lets the chat reach this one file, and nothing else, when it could not already — the same
 * entry attaching the file to a message adds. Answers whether anything was granted.
 *
 * Asked through `isInScope` rather than by looking for an entry, so a note already covered by
 * a folder, a group or the whole vault is left as it is and the chat's scope stays what its
 * agent says. The entry, once added, is a change this chat made, and it is saved with it.
 */
export function grantNote(scope: ScopeResolver, path: string): boolean {
  if (scope.isInScope(path)) return false
  scope.addFile(path)
  return true
}

/** The link the way the person would have written it: Obsidian's own, by their settings. */
export function noteLink(file: TFile): string {
  return GlobalStore.getInstance().app.fileManager.generateMarkdownLink(file, '')
}

/** Opens the chat. Answers whether one was opened — a full tab bar refuses. */
export async function chatAboutNote(file: TFile): Promise<boolean> {
  if (!canChatAbout(file)) return false

  const chatService = ChatService.getInstance()
  const session = await chatService.openBlankChat()
  if (!session) return false

  grantNote(session.scopeResolver, file.path)
  chatService.pendingInput.value = { text: `${noteLink(file)} `, tabId: session.id, focus: true }
  await chatService.revealSidebar()
  return true
}

function run(file: TFile): void {
  void chatAboutNote(file).catch((e: unknown) => {
    console.error('[Abele] Chat about this failed:', e)
    new Notice(`Could not open a chat: ${e instanceof Error ? e.message : 'unknown error'}`)
  })
}

const aiEnabled = () => AbeleConfig.getInstance().ai.enabled

export function registerChatAbout(plugin: Plugin): void {
  const { workspace } = plugin.app

  // The explorer, a tab's header and "more options" all build this one menu.
  plugin.registerEvent(
    workspace.on('file-menu', (menu, file) => {
      if (!aiEnabled() || !canChatAbout(file)) return
      menu.addItem((item) =>
        item
          .setTitle(CHAT_ABOUT_TITLE)
          .setIcon(CHAT_ABOUT_ICON)
          .onClick(() => run(file))
      )
    })
  )

  plugin.registerEvent(
    workspace.on('editor-menu', (menu, _editor, info) => {
      const file = info.file
      if (!aiEnabled() || !canChatAbout(file)) return
      menu.addItem((item) =>
        item
          .setTitle(CHAT_ABOUT_TITLE)
          .setIcon(CHAT_ABOUT_ICON)
          .onClick(() => run(file))
      )
    })
  )

  plugin.addCommand({
    id: 'chat-about-current-note',
    name: 'Chat about current note',
    icon: CHAT_ABOUT_ICON,
    checkCallback: (checking) => {
      const file = workspace.getActiveFile()
      if (!aiEnabled() || !canChatAbout(file)) return false
      if (!checking) run(file)
      return true
    },
  })
}
