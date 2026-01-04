import { Editor, MarkdownView } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { getTemplateComposable } from '@/composables/useTemplates'

/**
 * Get currently selected text from active editor
 */
function getSelection(): string | undefined {
  const { app } = GlobalStore.getInstance()
  const view = app.workspace.getActiveViewOfType(MarkdownView)
  if (!view?.editor) return undefined

  const selection = view.editor.getSelection()
  return selection || undefined
}

/**
 * Command: Create a new note from a template
 */
export function createNoteFromTemplate(): void {
  const selection = getSelection()
  getTemplateComposable().startCreateFlow(selection)
}

/**
 * Command: Replace current note content with a template
 */
export function replaceNoteWithTemplate(): void {
  const selection = getSelection()
  getTemplateComposable().startReplaceFlow(selection)
}

/**
 * Command: Insert template content at cursor position
 */
export function insertTemplateAtCursor(editor: Editor): void {
  const selection = editor.getSelection() || undefined
  getTemplateComposable().startInsertFlow(selection)
}
