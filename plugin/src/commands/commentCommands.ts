/**
 * Starting a comment chat from the note.
 *
 * Both entry points — the command for a hotkey and "Ask here" in the editor's context menu —
 * come through here, so that "where the marker goes" has one definition. The marker sits
 * immediately after the end of the selection, which is what makes the quote resolvable later:
 * the editor looks for text ending exactly there before it looks anywhere else.
 */
import { Editor, Notice, TFile } from 'obsidian'
import { CommentService } from '@/ai/CommentService'
import { dispatchCommentsChanged } from '@/editor/CommentPlugin'
import { isCommentablePosition } from '@/editor/commentMarkers'

export async function commentHere(editor: Editor, file: TFile): Promise<void> {
  const text = editor.getValue()
  const selection = editor.getSelection()
  const pos = editor.posToOffset(selection ? editor.getCursor('to') : editor.getCursor())

  // A marker in a fence renders as text, and one in frontmatter breaks the YAML. Neither is
  // recoverable by the reader, so the command declines rather than writing it.
  if (!isCommentablePosition(text, pos)) {
    new Notice('A comment cannot be anchored inside code or frontmatter')
    return
  }

  const service = CommentService.getInstance()
  const session = await service.create(file, pos, selection || undefined)

  // Expanded and focused: someone who just asked for a comment is about to type a question.
  if (session.commentId) service.open.value = session.commentId
  dispatchCommentsChanged(file.path)
}
