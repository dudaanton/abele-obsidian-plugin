/**
 * Starting a comment chat from the note.
 *
 * Both entry points — the command for a hotkey and "Ask here" in the editor's context menu —
 * come through here, so that "where the marker goes" has one definition. The marker sits
 * immediately after the end of the selection, which is what makes the quote resolvable later:
 * the editor looks for text ending exactly there before it looks anywhere else.
 */
import { Editor, MarkdownView, Notice, TFile } from 'obsidian'
import { CommentService } from '@/ai/CommentService'
import { dispatchCommentsChanged } from '@/editor/CommentPlugin'
import { isCommentablePosition, stripMarkers } from '@/editor/commentMarkers'

export async function commentHere(editor: Editor, file: TFile): Promise<void> {
  const text = editor.getValue()
  const selection = editor.getSelection()
  const pos = editor.posToOffset(selection ? editor.getCursor('to') : editor.getCursor())
  const from = selection ? editor.posToOffset(editor.getCursor('from')) : pos

  /**
   * The reader's prose, with none of our syntax in it.
   *
   * A marker is drawn as an atomic widget, so a selection dragged as far as the icon covers
   * it rather than stopping in front of it — and the raw `%%c:…%%` comes back in the middle
   * of what `getSelection` returns. Saved as the quote it would never match the note again,
   * and the commented passage would silently lose its underline.
   */
  const quoted = selection ? stripMarkers(selection) : ''

  // A marker in a fence renders as text, and one in frontmatter breaks the YAML. Neither is
  // recoverable by the reader, so the command declines rather than writing it.
  if (!isCommentablePosition(text, pos)) {
    new Notice('A comment cannot be anchored inside code or frontmatter')
    return
  }

  const service = CommentService.getInstance()
  const session = await service.create(file, pos, quoted.trim() ? quoted : undefined, from)

  // Expanded and focused: someone who just asked for a comment is about to type a question.
  if (session.commentId) service.open.value = session.commentId
  dispatchCommentsChanged(file.path)
}

/**
 * The way in from a pane: both entry points come through here.
 *
 * The note is written out first. Obsidian keeps the edited buffer in the editor and flushes it
 * on a debounce, while `CommentService.create` edits the *file* through `vault.process` — so
 * commenting on a paragraph typed a moment ago would anchor the marker at an offset the file
 * on disk does not have, and the write would go on to drop everything since the last save.
 * `commentHere` is left taking `(editor, file)` so that a caller holding those two, and no
 * view, can still use it.
 */
export async function commentHereInView(view: MarkdownView): Promise<void> {
  const file = view.file
  if (!file) return

  await view.save()
  await commentHere(view.editor, file)
}
