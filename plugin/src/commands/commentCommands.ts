/**
 * Starting a comment chat from the note.
 *
 * Both entry points — the command for a hotkey and "Ask here" in the editor's context menu —
 * come through here, so that "where the marker goes" has one definition. The marker sits
 * immediately after the end of the selection, which is what makes the quote resolvable later:
 * the editor looks for text ending exactly there before it looks anywhere else. `anchorFor`
 * decides what "the end of the selection" means when the selection stopped halfway through a
 * link, an embed or anything else a marker written into the middle of would break.
 */
import { Editor, MarkdownView, Notice, TFile } from 'obsidian'
import { CommentService } from '@/ai/CommentService'
import { dispatchCommentsChanged } from '@/editor/CommentPlugin'
import { anchorFor, stripMarkers } from '@/editor/commentMarkers'

export async function commentHere(editor: Editor, file: TFile): Promise<void> {
  const text = editor.getValue()
  const selection = editor.getSelection()
  const to = editor.posToOffset(selection ? editor.getCursor('to') : editor.getCursor())
  const from = selection ? editor.posToOffset(editor.getCursor('from')) : to

  /**
   * Where the marker may go, which is not always where the selection stopped.
   *
   * A selection that ended in the middle of a link, an embed, a footnote or a checkbox is
   * carried out to the end of it — a marker written inside any of those destroys it. A fence,
   * frontmatter, a table and a callout's title line have no such end, and are declined: the
   * first two break on a marker, and the last two are drawn by widgets that swallow it, so the
   * comment would be made and never be reachable again.
   */
  const anchor = anchorFor(text, to)
  if (!anchor) {
    new Notice('A comment cannot be anchored inside code, frontmatter, a table or a callout title')
    return
  }

  /**
   * The reader's prose, with none of our syntax in it.
   *
   * Read from the note rather than from `getSelection`, because the anchor above may have
   * reached past where the selection stopped, and the quote has to cover what the marker now
   * sits after or it will not resolve. Markers are stripped for the same reason the quote is
   * prose: one of them is drawn as an atomic widget, so a selection dragged as far as the icon
   * covers it rather than stopping in front of it, and the raw `%%c:…%%` comes back in the
   * middle of what was chosen. Saved that way it would never match the note again, and the
   * commented passage would silently lose its underline.
   */
  const quoted = selection ? stripMarkers(text.slice(from, anchor.quoteTo)) : ''

  const service = CommentService.getInstance()
  const session = await service.create(file, anchor.pos, quoted.trim() ? quoted : undefined, from)

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
