/**
 * Selecting lines in a read-only code view by their numbers, the way GitHub does: a click on a
 * line number selects that line, a Shift-click extends the selection to it, a click on the only
 * selected line clears it. The selected lines are marked like the lines a link points at — the
 * lines a link opened on are simply the first selection — and under the last one a bar is drawn
 * for whoever wants to act on it.
 *
 * The bar is only a host element here. CodeMirror draws its widgets on demand and throws them
 * away when they scroll out of view, so every time it draws the bar it hands the new host out,
 * and the component renders into whichever host is current.
 */
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import {
  BlockType,
  Decoration,
  EditorView,
  WidgetType,
  type BlockInfo,
  type DecorationSet,
} from '@codemirror/view'
import { Platform } from 'obsidian'
import type { LineSpan } from './permalinks'

export interface SelectionHooks {
  /** Lines marked when the view opens — those a link named. They get no bar. */
  initial?: number[]
  /**
   * The initial lines are a selection the person made — in the other view of the same file — and
   * keep their bar.
   */
  initialBar?: boolean
  /**
   * A tap extends the selection, and a tap inside it clears it: a phone has no Shift. By default
   * on a phone.
   */
  extendOnTap?: boolean
  /** Whether a line can be selected; a diff's hunk headers cannot. */
  selectable?: (line: number) => boolean
  /** The lines the person selected, or null when they cleared the selection. */
  onSelect?: (span: LineSpan | null) => void
  /**
   * The element the selection's bar is drawn in, each time CodeMirror draws one; `removed` when
   * it throws one away — which may be after it has drawn the next.
   */
  onBarHost?: (host: HTMLElement | null, removed?: HTMLElement) => void
}

interface Selected {
  /** Marked lines, 1-based. */
  lines: number[]
  /** Where a Shift-click extends from. */
  anchor: number | null
  /** The person chose these: draw the bar. */
  bar: boolean
}

const select = StateEffect.define<Selected>()

const TARGET = Decoration.line({ class: 'abele-github-code__line_target' })

class BarWidget extends WidgetType {
  constructor(
    private readonly last: number,
    private readonly onHost: SelectionHooks['onBarHost']
  ) {
    super()
  }

  eq(other: BarWidget) {
    return other.last === this.last
  }

  toDOM() {
    const host = createDiv({ cls: 'abele-github-code__bar' })
    this.onHost?.(host)
    return host
  }

  destroy(dom: HTMLElement) {
    this.onHost?.(null, dom)
  }

  get estimatedHeight() {
    return 40
  }

  // The bar's buttons are the bar's; the editor must not take their clicks as a selection.
  ignoreEvent() {
    return true
  }
}

const range = (a: number, b: number) =>
  Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => Math.min(a, b) + i)

export function lineSelection(hooks: SelectionHooks): {
  extension: Extension
  /** For every gutter that shows line numbers: its clicks select. */
  gutterHandlers: Record<string, (view: EditorView, line: BlockInfo, event: Event) => boolean>
} {
  const field = StateField.define<{ selected: Selected; decorations: DecorationSet }>({
    create: (state) => {
      const selected = {
        lines: hooks.initial ?? [],
        anchor: hooks.initial?.[0] ?? null,
        bar: !!hooks.initialBar && !!hooks.initial?.length,
      }
      return { selected, decorations: build(state, selected, hooks) }
    },
    update(value, tr) {
      for (const e of tr.effects)
        if (e.is(select)) return { selected: e.value, decorations: build(tr.state, e.value, hooks) }
      return value
    },
    // Directly, not through a function of the view: the bar is a block, and changes the height.
    provide: (f) => EditorView.decorations.from(f, (value) => value.decorations),
  })

  const onNumber = (view: EditorView, block: BlockInfo, event: Event): boolean => {
    // A line with the bar under it comes as one block made of both: the bar's part is not a line.
    if (Array.isArray(block.type)) {
      const y = (event as MouseEvent).clientY - view.documentTop
      const part = block.type.find((b) => y >= b.top && y < b.bottom) ?? block.type[0]
      if (part.type !== BlockType.Text) return false
    } else if (block.type !== BlockType.Text) return false
    const line = view.state.doc.lineAt(block.from).number
    if (hooks.selectable && !hooks.selectable(line)) return false
    const current = view.state.field(field).selected
    const shift = (event as MouseEvent).shiftKey
    const tap = hooks.extendOnTap ?? Platform.isPhone
    let next: Selected
    if (tap && current.bar && current.lines.length) {
      next = current.lines.includes(line)
        ? { lines: [], anchor: null, bar: false }
        : {
            lines: range(current.anchor ?? current.lines[0], line),
            anchor: current.anchor ?? current.lines[0],
            bar: true,
          }
    } else if (shift && current.anchor !== null) {
      next = { lines: range(current.anchor, line), anchor: current.anchor, bar: true }
    } else if (current.bar && current.lines.length === 1 && current.lines[0] === line) {
      next = { lines: [], anchor: null, bar: false }
    } else {
      next = { lines: [line], anchor: line, bar: true }
    }
    if (hooks.selectable) next.lines = next.lines.filter((n) => hooks.selectable(n))
    view.dispatch({ effects: select.of(next) })
    hooks.onSelect?.(
      next.bar && next.lines.length
        ? { from: next.lines[0], to: next.lines[next.lines.length - 1] }
        : null
    )
    event.preventDefault()
    return true
  }

  return { extension: field, gutterHandlers: { mousedown: onNumber } }
}

function build(state: EditorState, value: Selected, hooks: SelectionHooks): DecorationSet {
  const marks = [...new Set(value.lines)]
    .filter((n) => n >= 1 && n <= state.doc.lines)
    .sort((a, b) => a - b)
  const ranges = marks.map((n) => TARGET.range(state.doc.line(n).from))
  if (value.bar && marks.length) {
    const last = marks[marks.length - 1]
    const widget = Decoration.widget({
      widget: new BarWidget(last, hooks.onBarHost),
      block: true,
      side: 1,
    })
    ranges.push(widget.range(state.doc.line(last).to))
  }
  return Decoration.set(ranges, true)
}
