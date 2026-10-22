import { Chunk } from '@codemirror/merge'
import { StateEffect, StateField, Text, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, WidgetType, gutter } from '@codemirror/view'
import { t } from '@/i18n'

const reveal = StateEffect.define<number>()

class OriginalLines extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: OriginalLines) {
    return this.text === other.text
  }
  toDOM(view: EditorView) {
    const block = view.dom.ownerDocument.win.createDiv()
    block.className = 'abele-code-original'
    block.textContent = this.text
    block.contentEditable = 'false'
    return block
  }
}

/** The working document stays whole; an old chunk is revealed only by its gutter marker. */
export function workingComparison(original: string) {
  const before = Text.of(original.split('\n'))
  const field = StateField.define<{ chunks: readonly Chunk[]; opened: Set<number> }>({
    create: (state) => ({ chunks: Chunk.build(before, state.doc), opened: new Set() }),
    update(value, transaction) {
      const chunks = transaction.docChanged
        ? Chunk.updateB(value.chunks, before, transaction.newDoc, transaction.changes)
        : value.chunks
      const opened = transaction.docChanged ? new Set<number>() : new Set(value.opened)
      for (const effect of transaction.effects)
        if (effect.is(reveal)) {
          if (opened.has(effect.value)) opened.delete(effect.value)
          else opened.add(effect.value)
        }
      return { chunks, opened }
    },
  })
  class Marker extends GutterMarker {
    constructor(
      readonly at: number,
      readonly kind: string,
      readonly opened: boolean
    ) {
      super()
    }
    eq(other: Marker) {
      return this.at === other.at && this.kind === other.kind && this.opened === other.opened
    }
    toDOM(view: EditorView) {
      const button = view.dom.ownerDocument.win.createEl('button')
      button.className = `abele-code-change abele-code-change_${this.kind}`
      button.setAttribute('aria-label', t('streamB.lastLoadedVersion.43fdff'))
      button.setAttribute('aria-expanded', String(this.opened))
      button.onclick = () => view.dispatch({ effects: reveal.of(this.at) })
      return button
    }
  }
  return [
    field,
    gutter({
      class: 'abele-code-changes',
      markers(view) {
        const { chunks, opened } = view.state.field(field)
        const markers = new Map<number, Marker>()
        for (const chunk of chunks) {
          const at = view.state.doc.lineAt(Math.min(chunk.fromB, view.state.doc.length)).from
          const kind =
            chunk.fromB === chunk.toB ? 'removed' : chunk.fromA === chunk.toA ? 'added' : 'changed'
          const end = Math.min(Math.max(chunk.toB - 1, at), view.state.doc.length)
          for (let line = view.state.doc.lineAt(at); line.from <= end; ) {
            markers.set(line.from, new Marker(at, kind, opened.has(at)))
            if (line.number === view.state.doc.lines) break
            line = view.state.doc.line(line.number + 1)
          }
        }
        const builder = new RangeSetBuilder<GutterMarker>()
        for (const [at, marker] of [...markers].sort((a, b) => a[0] - b[0]))
          builder.add(at, at, marker)
        return builder.finish()
      },
    }),
    EditorView.decorations.compute([field], (state) => {
      const { chunks, opened } = state.field(field)
      const decorations = chunks.flatMap((chunk) => {
        const at = state.doc.lineAt(Math.min(chunk.fromB, state.doc.length)).from
        if (!opened.has(at) || chunk.fromA === chunk.toA) return []
        return [
          Decoration.widget({
            widget: new OriginalLines(
              before.sliceString(chunk.fromA, Math.min(chunk.toA, before.length)).replace(/\n$/, '')
            ),
            block: true,
            side: -1,
          }).range(at),
        ]
      })
      return Decoration.set(decorations, true)
    }),
  ]
}
