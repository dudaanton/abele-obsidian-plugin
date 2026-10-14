import { Prec, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { replyNumbers, replyTokens } from '@/ai/replyLinks'
import type { ChatReplyTo } from '@/ai/types'
import { replyChip } from '@/components/chat/replyChip'

/** One place standing in the text: drawn as its chip, taken and deleted as one character. */
class ReplyChipWidget extends WidgetType {
  constructor(
    readonly reply: ChatReplyTo,
    readonly length: number,
    readonly key: string,
    readonly number: number | undefined,
    readonly open: (to: ChatReplyTo) => void
  ) {
    super()
  }

  eq(other: ReplyChipWidget) {
    return other.key === this.key && other.number === this.number
  }

  toDOM(view: EditorView) {
    const chip: HTMLElement = replyChip(view.dom.ownerDocument, this.reply, {
      number: this.number,
      onOpen: () => this.open(this.reply),
      onRemove: () => {
        const from = view.posAtDOM(chip)
        view.dispatch({ changes: { from, to: from + this.length } })
      },
    })
    return chip
  }

  /** The chip answers its own presses; the editor leaves them alone. */
  ignoreEvent() {
    return true
  }
}

function build(view: EditorView, open: (to: ChatReplyTo) => void): DecorationSet {
  const text = view.state.doc.toString()
  const tokens = replyTokens(text)
  const numbers = replyNumbers(tokens.map((t) => t.reply))
  const several = new Set(numbers).size > 1
  const builder = new RangeSetBuilder<Decoration>()
  tokens.forEach((t, i) => {
    const key = text.slice(t.from, t.to)
    const widget = new ReplyChipWidget(
      t.reply,
      t.to - t.from,
      key,
      several ? numbers[i] : undefined,
      open
    )
    builder.add(t.from, t.to, Decoration.replace({ widget }))
  })
  return builder.finish()
}

/**
 * The composer's places of the agent's words, each a token in the text, drawn where it stands
 * as a chip the cursor steps over and Backspace takes whole. Numbered once there are several
 * places, so the words around them can say which.
 */
export function replyChips(open: (to: ChatReplyTo) => void): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view, open)
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.decorations = build(update.view, open)
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) =>
        EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
    }
  )
  return Prec.highest(plugin)
}
