import { t } from '@/i18n'
import { Notice, type App } from 'obsidian'
import { recentNoteView } from '@/github/linking'
import { insertBlockOnOwnLine } from '@/helpers/editorHelpers'
import { selectionQuote, type FileSelection } from '@/components/nodeWork/fileSelection'

export type CodeSelection = Pick<FileSelection, 'text'> &
  Partial<Pick<FileSelection, 'from' | 'to'>>

/** Quote into the last note without switching away from the source tab. */
export function insertCodeSelection(app: App, path: string, selection: FileSelection): void {
  const view = recentNoteView(app)
  if (!view) {
    new Notice(t('streamC.9ea4fea45da7892b'))
    return
  }
  view.editor.setCursor(insertBlockOnOwnLine(view.editor, selectionQuote(path, selection)))
  new Notice(t('streamC.df176fc5cbbf3cb1'))
}

/** Prepare the draft only; the user sends it. */
export async function chatCodeSelection(
  action: 'ask' | 'add',
  path: string,
  selection: FileSelection
): Promise<void> {
  const { ChatService } = await import('@/ai/ChatService')
  const chats = ChatService.getInstance()
  const session = action === 'ask' ? await chats.openBlankChat() : chats.activeSession.value
  if (!session) {
    new Notice(t('streamC.40a65f8d386581f1'))
    return
  }
  chats.pendingInput.value = {
    text: selectionQuote(path, selection),
    tabId: session.id,
    append: action === 'add',
    focus: true,
  }
  await chats.revealSidebar()
}
