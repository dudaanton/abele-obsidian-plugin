/**
 * The icon that replaces `%%c:…%%` in live preview: `CommentMarker.vue`, rendered as the
 * widget's own element. The reading view and chat answers draw the same marker through `toDOM`
 * and take it out with `unrenderKitRoot` where they remove it.
 *
 * `CommentState` is imported as a type only: the field constructs the widget, so a value
 * import would close a cycle between the two modules.
 */
import { WidgetType } from '@codemirror/view'
import type { CommentState } from './CommentPlugin'
import CommentMarker from '@/components/CommentMarker.vue'
import { renderKitRoot, unrenderKitRoot } from '@/components/obsidian/mount'

export class CommentMarkerWidget extends WidgetType {
  constructor(
    private readonly ids: string[],
    /** How much has been said here: the messages of every comment on this marker. */
    private readonly count: number,
    private readonly state: CommentState,
    private readonly open: boolean,
    private readonly onClick: (ids: string[]) => void,
    private readonly kind: 'ai' | 'human' = 'ai',
    private readonly unresolved = false
  ) {
    super()
  }

  toDOM(): HTMLElement {
    return renderKitRoot(CommentMarker, {
      ids: this.ids,
      count: this.count,
      state: this.state,
      open: this.open,
      kind: this.kind,
      unresolved: this.unresolved,
      onPress: this.onClick,
    }).el
  }

  destroy(dom: HTMLElement): void {
    unrenderKitRoot(dom)
  }

  eq(other: CommentMarkerWidget): boolean {
    return (
      this.ids.join(',') === other.ids.join(',') &&
      this.count === other.count &&
      this.state === other.state &&
      this.open === other.open &&
      this.kind === other.kind &&
      this.unresolved === other.unresolved
    )
  }

  /** The click belongs to the card, not to the editor's selection handling. */
  ignoreEvent(): boolean {
    return true
  }
}
