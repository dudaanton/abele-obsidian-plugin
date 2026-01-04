import { Editor, Notice } from 'obsidian'

export const pasteFromClipboard = async (editor: Editor) => {
  const text = await navigator.clipboard.readText()

  if (!text) {
    new Notice('Clipboard is empty or does not contain text.', 3000)
    return
  }

  if (!editor) {
    new Notice('No active markdown editor found.', 3000)
    return
  }

  if (editor) {
    const cursor = editor.getCursor()

    editor.replaceRange(text, cursor)

    const newCursorCh = cursor.ch + text.length

    editor.setCursor({ line: cursor.line, ch: newCursorCh })
  }
}
