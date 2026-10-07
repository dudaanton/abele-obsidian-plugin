import { WidgetType } from '@codemirror/view'
import { CommentMarkerWidget } from './CommentMarkerWidget'

/** A single atomic source token can have two independently activatable kinds of comment. */
export class MixedCommentMarkerWidget extends WidgetType {
  constructor(private readonly widgets: CommentMarkerWidget[]) {
    super()
  }
  toDOM(): HTMLElement {
    const el = createSpan({ cls: 'abele-comment-markers' })
    for (const widget of this.widgets) el.appendChild(widget.toDOM())
    return el
  }
  eq(other: MixedCommentMarkerWidget): boolean {
    return (
      this.widgets.length === other.widgets.length &&
      this.widgets.every((widget, i) => widget.eq(other.widgets[i]))
    )
  }
  ignoreEvent(): boolean {
    return true
  }
}
