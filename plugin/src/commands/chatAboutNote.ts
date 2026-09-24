/**
 * "Chat about this": a new chat whose first message starts with a link to the note.
 *
 * Offered wherever a note is right-clicked — the file explorer, a tab's header and its "more
 * options" menu (all three are Obsidian's `file-menu`), the editor — and as a command for the
 * note in front. The link is written by Obsidian's own link generator, so it follows the
 * vault's link settings, and it is only prefilled: the person says what they want before
 * anything is sent.
 *
 * Something selected in the note goes in with it, the way "Use in AI agent" quotes it, and the
 * link then points at the selected lines. Only that note's own selection counts: the one in the
 * editor the menu was opened from, or in the note's pane in front — never another note's. In
 * reading view there are no lines to point at, so the link is to the note and the passage is
 * the text as it was selected on the page.
 *
 * Any vault file is offered, not only notes: an agent reads pictures and text files as well.
 * Chat logs are not — no scope takes one in, and a chat reaches an agent only by being attached.
 */
import {
  MarkdownView,
  Notice,
  TFile,
  type Editor,
  type TAbstractFile,
  type Plugin,
  type Workspace,
  type WorkspaceLeaf,
} from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import type { ScopeResolver } from '@/ai/ScopeResolver'
import { isChatLog } from '@/ai/chatText'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { quoteLines } from '@/ai/quoteSelection'
import { lineSubpath, type LineRange } from '@/lineLinks/parse'

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

/**
 * The link the way the person would have written it: Obsidian's own, by their settings. To
 * lines, it carries them as `#L10-L12` and keeps the note's name as its text.
 */
export function noteLink(file: TFile, lines?: LineRange): string {
  const { fileManager } = GlobalStore.getInstance().app
  if (!lines) return fileManager.generateMarkdownLink(file, '')
  return fileManager.generateMarkdownLink(file, '', lineSubpath(lines), file.basename)
}

/** What was selected in the note: the text, and its lines when it was selected in the editor. */
export interface NoteSelection {
  text: string
  /** 1-based, over the whole file; absent for a selection in reading view. */
  lines?: LineRange
}

/** The editor's selection, with the lines it covers; null when nothing is selected. */
export function editorSelection(editor: Editor): NoteSelection | null {
  const text = editor.getSelection()
  if (!text.trim()) return null
  const from = editor.getCursor('from')
  const to = editor.getCursor('to')
  // A selection run to the start of the next line does not take that line in.
  const last = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line
  return { text: text.replace(/\n+$/, ''), lines: { from: from.line + 1, to: last + 1 } }
}

/** What is selected in a note's pane: its editor's selection, or the page's in reading view. */
export function viewSelection(view: MarkdownView): NoteSelection | null {
  if (view.getMode() === 'source') return editorSelection(view.editor)
  const root = view.previewMode?.containerEl ?? view.contentEl
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null
  const text = selection.toString().trim()
  return text ? { text } : null
}

/**
 * The pane showing this very file — the one the menu was opened on, else the note in front —
 * or null. A selection in any other note is not this chat's business.
 */
export function paneOf(
  workspace: Workspace,
  file: TFile,
  leaf?: WorkspaceLeaf
): MarkdownView | null {
  const candidates = [
    leaf?.view,
    workspace.getActiveViewOfType(MarkdownView),
    workspace.getMostRecentLeaf()?.view,
  ]
  for (const view of candidates) {
    if (view instanceof MarkdownView && view.file?.path === file.path) return view
  }
  return null
}

/** What goes into the chat's input: the link, and the selected passage quoted under it. */
export function chatAboutText(file: TFile, selection?: NoteSelection | null): string {
  if (!selection?.text.trim()) return `${noteLink(file)} `
  return `${noteLink(file, selection.lines)}\n${quoteLines(selection.text)}\n\n`
}

/** Opens the chat. Answers whether one was opened — a full tab bar refuses. */
export async function chatAboutNote(
  file: TFile,
  selection?: NoteSelection | null
): Promise<boolean> {
  if (!canChatAbout(file)) return false

  const chatService = ChatService.getInstance()
  const session = await chatService.openBlankChat()
  if (!session) return false

  grantNote(session.scopeResolver, file.path)
  chatService.pendingInput.value = {
    text: chatAboutText(file, selection),
    tabId: session.id,
    focus: true,
  }
  await chatService.revealSidebar()
  return true
}

function run(file: TFile, selection: NoteSelection | null): void {
  void chatAboutNote(file, selection).catch((e: unknown) => {
    console.error('[Abele] Chat about this failed:', e)
    new Notice(`Could not open a chat: ${e instanceof Error ? e.message : 'unknown error'}`)
  })
}

const aiEnabled = () => AbeleConfig.getInstance().ai.enabled

export function registerChatAbout(plugin: Plugin): void {
  const { workspace } = plugin.app

  // The explorer, a tab's header and "more options" all build this one menu.
  plugin.registerEvent(
    workspace.on('file-menu', (menu, file, _source, leaf) => {
      if (!aiEnabled() || !canChatAbout(file)) return
      // Read now: choosing the item can take the page's selection away.
      const pane = paneOf(workspace, file, leaf)
      const selection = pane ? viewSelection(pane) : null
      menu.addItem((item) =>
        item
          .setTitle(CHAT_ABOUT_TITLE)
          .setIcon(CHAT_ABOUT_ICON)
          .onClick(() => run(file, selection))
      )
    })
  )

  plugin.registerEvent(
    workspace.on('editor-menu', (menu, editor, info) => {
      const file = info.file
      if (!aiEnabled() || !canChatAbout(file)) return
      const selection = editorSelection(editor)
      menu.addItem((item) =>
        item
          .setTitle(CHAT_ABOUT_TITLE)
          .setIcon(CHAT_ABOUT_ICON)
          .onClick(() => run(file, selection))
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
      if (checking) return true
      const pane = paneOf(workspace, file)
      run(file, pane ? viewSelection(pane) : null)
      return true
    },
  })
}
