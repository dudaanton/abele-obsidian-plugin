/** One ordered set of actions for the explorer, tab header, editor and mobile menus. */
import { Notice, TFile, type Menu, type Plugin } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ChatService } from '@/ai/ChatService'
import { useInAgentText } from '@/ai/quoteSelection'
import { useFilesInAgent } from '@/helpers/useFilesInAgent'
import { BOOK_VIEW_TYPE } from '@/reader/viewType'
import {
  canChatAbout,
  chatAboutNote,
  editorSelection,
  paneOf,
  registerChatAbout,
  viewSelection,
  type NoteSelection,
} from './chatAboutNote'
import { attachChatToNote, attachNoteToChat, canAttachTo, registerAttachChat } from './attachChat'
import { NOTE_ACTIONS } from './noteActions'
import { noteWikilink } from './noteWikilink'

function run(job: Promise<unknown>): void {
  void job.catch((error: unknown) => {
    console.error('[Abele] Note action failed:', error)
    new Notice(
      `Could not complete the note action: ${error instanceof Error ? error.message : 'unknown error'}`
    )
  })
}

async function addContext(file: TFile, selection?: NoteSelection | null): Promise<void> {
  if (selection?.text) {
    ChatService.getInstance().pendingInput.value = {
      text: useInAgentText(selection.text, file.basename),
    }
  }
  await useFilesInAgent([file])
}

/** AI off leaves copying available. Books retain their place-aware chat action. */
export function addNoteActions(
  menu: Menu,
  file: TFile,
  selection?: NoteSelection | null,
  book = false
): void {
  const enabled = AbeleConfig.getInstance().ai.enabled
  const jobs: Array<(() => Promise<unknown>) | null> = [
    enabled ? () => addContext(file, selection) : null,
    enabled && canChatAbout(file) && !book ? () => chatAboutNote(file, selection) : null,
    enabled && canChatAbout(file) ? () => attachNoteToChat(file) : null,
    enabled && canAttachTo(file) ? () => attachChatToNote(file) : null,
    () => navigator.clipboard.writeText(noteWikilink(file)),
  ]
  NOTE_ACTIONS.forEach((action, index) => {
    const job = jobs[index]
    if (!job) return
    menu.addItem((item) =>
      item
        .setTitle(action.title)
        .setIcon(action.icon)
        .setSection('abele-note-actions')
        .onClick(() => run(job()))
    )
  })
}

export function registerNoteMenu(plugin: Plugin): void {
  const { workspace } = plugin.app
  // Preserve command ids used by hotkeys and saved quick menus, without duplicate menu rows.
  registerChatAbout(plugin, false)
  registerAttachChat(plugin, false)

  plugin.registerEvent(
    workspace.on('file-menu', (menu, file, _source, leaf) => {
      if (!(file instanceof TFile)) return
      const pane = paneOf(workspace, file, leaf)
      addNoteActions(
        menu,
        file,
        pane ? viewSelection(pane) : null,
        leaf?.view?.getViewType?.() === BOOK_VIEW_TYPE
      )
    })
  )
  plugin.registerEvent(
    workspace.on('editor-menu', (menu, editor, info) => {
      if (info.file) addNoteActions(menu, info.file, editorSelection(editor))
    })
  )

  for (const index of [0, 2, 4]) {
    const action = NOTE_ACTIONS[index]
    plugin.addCommand({
      id: action.id,
      name: action.title,
      icon: action.icon,
      checkCallback: (checking) => {
        const file = workspace.getActiveFile()
        if (!file || (index !== 4 && !AbeleConfig.getInstance().ai.enabled)) return false
        if (index === 2 && !canChatAbout(file)) return false
        if (checking) return true
        if (index === 0) {
          const pane = paneOf(workspace, file)
          run(addContext(file, pane ? viewSelection(pane) : null))
        } else if (index === 2) run(attachNoteToChat(file))
        else run(navigator.clipboard.writeText(noteWikilink(file)))
        return true
      },
    })
  }
}
