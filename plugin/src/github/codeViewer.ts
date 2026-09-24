/**
 * Read-only CodeMirror editors for a file's diff and for a file at a ref.
 *
 * CodeMirror rather than a hand-drawn table: it draws only what is on screen, so a file of ten
 * thousand lines costs what twenty do, and it gives selection, copying and the same highlighting
 * the plugin's own code view uses.
 */
import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { DiffLine } from './patch'
import type { LineRange } from './urls'
import { languageFor } from './languages'
import { lineSelection, type SelectionHooks } from './lineSelection'

export interface Viewer {
  /**
   * Where the first highlighted line starts, in viewport pixels; null when nothing is highlighted
   * or the editor is not laid out. Read from the editor's height map, so it is known before the
   * line is drawn — the editor draws only what is on screen — and grows exact as it is.
   */
  targetTop(): number | null
  destroy(): void
}

class NumberMarker extends GutterMarker {
  constructor(private readonly n: string) {
    super()
  }
  eq(other: NumberMarker) {
    return other.n === this.n
  }
  toDOM() {
    return document.createTextNode(this.n)
  }
}

const readOnly: Extension[] = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  EditorView.lineWrapping,
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
]

function lineDecorations(state: EditorState, classOf: (line: number) => string[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (let n = 1; n <= state.doc.lines; n++) {
    const classes = classOf(n)
    if (classes.length === 0) continue
    builder.add(
      state.doc.line(n).from,
      state.doc.line(n).from,
      Decoration.line({ class: classes.join(' ') })
    )
  }
  return builder.finish()
}

function mount(
  parent: HTMLElement,
  doc: string,
  extensions: Extension[],
  firstHighlighted: number | null
): Viewer {
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [...readOnly, ...extensions] }),
  })
  return {
    targetTop() {
      if (firstHighlighted === null || firstHighlighted > view.state.doc.lines) return null
      if (!view.dom.isConnected || view.dom.getClientRects().length === 0) return null
      const block = view.lineBlockAt(view.state.doc.line(firstHighlighted).from)
      return view.documentTop + block.top
    },
    destroy() {
      view.destroy()
    },
  }
}

const TYPE_CLASS: Record<DiffLine['type'], string> = {
  add: 'abele-github-code__line_add',
  del: 'abele-github-code__line_del',
  hunk: 'abele-github-code__line_hunk',
  note: 'abele-github-code__line_hunk',
  ctx: '',
}

/**
 * @param highlight indexes into `lines` to mark, as `linesFor` returns them
 * @param hooks what a click on a line number does; hunk headers carry no number and are skipped
 */
export function mountDiff(
  parent: HTMLElement,
  lines: DiffLine[],
  path: string,
  highlight: number[] = [],
  hooks: SelectionHooks = {}
): Viewer {
  const widest = String(lines.reduce((max, l) => Math.max(max, l.old ?? 0, l.new ?? 0), 0)).replace(
    /\d/g,
    '0'
  )
  const selection = lineSelection({
    ...hooks,
    initial: highlight.map((i) => i + 1),
    selectable: (n) => lines[n - 1]?.old !== undefined || lines[n - 1]?.new !== undefined,
  })

  const numbers = (side: 'old' | 'new') =>
    gutter({
      class: `abele-github-code__gutter abele-github-code__gutter_${side}`,
      lineMarker(view, block) {
        const line = lines[view.state.doc.lineAt(block.from).number - 1]
        const n = line?.[side]
        return n === undefined ? null : new NumberMarker(String(n))
      },
      initialSpacer: () => new NumberMarker(widest),
      domEventHandlers: selection.gutterHandlers,
    })

  const state = EditorState.create({ doc: lines.map((l) => l.text).join('\n') })
  const decorations = lineDecorations(state, (n) =>
    [TYPE_CLASS[lines[n - 1]?.type ?? 'ctx']].filter(Boolean)
  )

  return mount(
    parent,
    state.doc.toString(),
    [
      numbers('old'),
      numbers('new'),
      EditorView.decorations.of(decorations),
      selection.extension,
      ...languageFor(path),
    ],
    highlight.length > 0 ? Math.min(...highlight) + 1 : null
  )
}

export function mountCode(
  parent: HTMLElement,
  text: string,
  path: string,
  range?: LineRange,
  hooks: SelectionHooks = {}
): Viewer {
  const initial: number[] = []
  if (range) for (let n = range.start; n <= range.end; n++) initial.push(n)
  const selection = lineSelection({ ...hooks, initial })

  return mount(
    parent,
    text,
    [
      lineNumbers({ domEventHandlers: selection.gutterHandlers }),
      selection.extension,
      ...languageFor(path),
    ],
    range ? range.start : null
  )
}
