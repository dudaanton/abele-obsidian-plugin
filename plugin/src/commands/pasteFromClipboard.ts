import { Editor, Notice } from 'obsidian'

export const pasteFromClipboard = async (editor: Editor) => {
  // Reading the clipboard needs the window focused and permitted, and rejects when it is not.
  // This runs from a command callback, which has nowhere to put a rejection — so it is caught
  // here and reported, rather than surfacing as an unhandled rejection and a command that
  // silently did nothing.
  let text: string
  try {
    text = await navigator.clipboard.readText()
  } catch {
    new Notice('Could not read the clipboard.', 3000)
    return
  }

  if (!text) {
    new Notice('Clipboard is empty or does not contain text.', 3000)
    return
  }

  if (!editor) {
    new Notice('No active Markdown editor found.', 3000)
    return
  }

  if (editor) {
    const cursor = editor.getCursor()

    editor.replaceRange(text, cursor)

    const newCursorCh = cursor.ch + text.length

    editor.setCursor({ line: cursor.line, ch: newCursorCh })
  }
}
