/**
 * The icon that replaces `%%c:…%%` in live preview.
 *
 * `CommentState` is imported as a type only: the field constructs the widget, so a value
 * import would close a cycle between the two modules.
 */
import { WidgetType, type EditorView } from '@codemirror/view'
import { setIcon } from 'obsidian'
import type { CommentState } from './CommentPlugin'

export class CommentMarkerWidget extends WidgetType {
  constructor(
    private readonly ids: string[],
    private readonly state: CommentState,
    private readonly open: boolean,
    private readonly onClick: (ids: string[], view: EditorView) => void
  ) {
    super()
  }

  /**
   * The view is CodeMirror's own argument, and it is the reason this signature exists: the
   * press has to be answered with the margin of the pane the icon is in, which is this one —
   * not the pane the workspace happens to call active.
   */
  toDOM(view: EditorView): HTMLElement {
    const el = createSpan({
      cls: 'abele-comment-marker',
      attr: { 'data-comment-ids': this.ids.join(',') },
    })

    if (this.state !== 'idle') el.addClass(`abele-comment-marker_${this.state}`)
    if (this.open) el.addClass('abele-comment-marker_open')

    const icon = createSpan({ cls: 'abele-comment-marker__icon', parent: el })
    setIcon(icon, 'message-circle')

    // A count only earns its space when there is something to count.
    if (this.ids.length > 1) {
      createSpan({
        cls: 'abele-comment-marker__count',
        text: String(this.ids.length),
        parent: el,
      })
    }

    el.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.onClick(this.ids, view)
    })

    return el
  }

  eq(other: CommentMarkerWidget): boolean {
    return (
      this.ids.join(',') === other.ids.join(',') &&
      this.state === other.state &&
      this.open === other.open
    )
  }

  /** The click belongs to the card, not to the editor's selection handling. */
  ignoreEvent(): boolean {
    return true
  }
}
