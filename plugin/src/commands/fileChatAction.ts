import { Notice, type FileView } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { attachNoteToChat } from './attachChat'
import { NOTE_ACTIONS } from './noteActions'

/** The same file attachment in canvas and presentation headers; pane menus use file-menu. */
export function addFileChatAction(view: Pick<FileView, 'file' | 'addAction'>): void {
  const attach = NOTE_ACTIONS[2]
  view.addAction(attach.icon, attach.title, () => {
    if (!view.file || !AbeleConfig.getInstance().ai.enabled) return
    void attachNoteToChat(view.file).catch((error: unknown) => {
      console.error('[Abele] File attachment failed:', error)
      new Notice(
        `Could not attach the file: ${error instanceof Error ? error.message : 'unknown error'}`
      )
    })
  })
}
