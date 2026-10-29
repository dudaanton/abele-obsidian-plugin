import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view'

const change = StateEffect.define<DecorationSet>()
const marks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(change)) return effect.value
    return tr.docChanged ? Decoration.none : value
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** Selection work is debounced, bounded and independent of scrolling. */
export function occurrences() {
  return [
    marks,
    EditorView.baseTheme({
      '.abele-code-occurrence': {
        backgroundColor: 'var(--text-highlight-bg)',
      },
    }),
    ViewPlugin.define((view) => {
      const document = view.dom.ownerDocument
      let timer: number | undefined
      const read = () => {
        const selection = document.getSelection()
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null
        const text = selection?.toString() ?? ''
        const found = []
        if (
          range &&
          !selection?.isCollapsed &&
          text.trim() &&
          text.length <= 100 &&
          !/[\r\n]/.test(text) &&
          view.contentDOM.contains(range.startContainer) &&
          view.contentDOM.contains(range.endContainer)
        ) {
          const start = view.posAtDOM(range.startContainer, range.startOffset)
          const end = view.posAtDOM(range.endContainer, range.endOffset)
          const source = view.state.doc.sliceString(0, Math.min(view.state.doc.length, 2_000_000))
          const word = /^[\p{L}\p{N}_$]+$/u.test(text)
          const identifier = (char: string) => /[\p{L}\p{N}_$]/u.test(char)
          for (
            let at = source.indexOf(text);
            at >= 0 && found.length < 2000;
            at = source.indexOf(text, at + text.length)
          ) {
            if (at === start && at + text.length === end) continue
            if (
              word &&
              (identifier(source[at - 1] ?? '') || identifier(source[at + text.length] ?? ''))
            )
              continue
            found.push(
              Decoration.mark({ class: 'cm-selectionMatch abele-code-occurrence' }).range(
                at,
                at + text.length
              )
            )
          }
        }
        view.dispatch({ effects: change.of(Decoration.set(found)) })
      }
      const schedule = () => {
        window.clearTimeout(timer)
        timer = window.setTimeout(read, 100)
      }
      document.addEventListener('selectionchange', schedule)
      return {
        destroy() {
          window.clearTimeout(timer)
          document.removeEventListener('selectionchange', schedule)
        },
      }
    }),
  ]
}
