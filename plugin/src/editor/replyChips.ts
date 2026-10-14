import { h, render } from 'vue'
import {
  Prec,
  RangeSetBuilder,
  StateField,
  type EditorState,
  type Extension,
} from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { replyTokens } from '@/ai/replyLinks'
import type { ChatReplyTo } from '@/ai/types'
import ChatReplyCard from '@/components/chat/ChatReplyCard.vue'

/** One place standing in the text: drawn as its card, taken and deleted as one character. */
class ReplyCardWidget extends WidgetType {
  constructor(
    readonly reply: ChatReplyTo,
    readonly source: string,
    readonly open: (to: ChatReplyTo) => void
  ) {
    super()
  }

  eq(other: ReplyCardWidget) {
    return other.source === this.source
  }

  toDOM(view: EditorView) {
    const el = view.dom.ownerDocument.win.createSpan({ cls: 'abele-chat-reply-inline' })
    render(
      h(ChatReplyCard, {
        to: this.reply,
        removable: true,
        onOpen: () => this.open(this.reply),
        onRemove: () => this.remove(view, el),
      }),
      el
    )
    return el
  }

  /** Off the text with the line break after it, wherever edits around it have moved it. */
  remove(view: EditorView, el: HTMLElement) {
    const from = view.posAtDOM(el)
    const doc = view.state.doc
    const end = from + this.source.length
    if (doc.sliceString(from, end) !== this.source) return
    const to = doc.sliceString(end, end + 1) === '\n' ? end + 1 : end
    view.dispatch({ changes: { from, to }, selection: { anchor: from } })
    view.focus()
  }

  destroy(dom: HTMLElement) {
    render(null, dom)
  }

  /** The card answers its own presses; the editor does not put a cursor inside it. */
  ignoreEvent() {
    return true
  }
}

function cards(state: EditorState, open: (to: ChatReplyTo) => void): DecorationSet {
  const text = state.doc.toString()
  const builder = new RangeSetBuilder<Decoration>()
  for (const t of replyTokens(text)) {
    const widget = new ReplyCardWidget(t.reply, text.slice(t.from, t.to), open)
    builder.add(t.from, t.to, Decoration.replace({ widget }))
  }
  return builder.finish()
}

/**
 * The composer's places of the agent's words, each a token in the text, drawn where it stands as
 * its card, the person's words around it. The cursor steps over a card as over one character and
 * Backspace takes the whole card.
 */
export function replyChips(open: (to: ChatReplyTo) => void): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => cards(state, open),
    update: (set, tr) => (tr.docChanged ? cards(tr.state, open) : set),
    provide: (f) => [
      EditorView.decorations.from(f),
      EditorView.atomicRanges.of((view) => view.state.field(f)),
    ],
  })
  return Prec.highest(field)
}
