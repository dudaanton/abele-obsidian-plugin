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

export interface Viewer {
  /** Scrolls the highlighted lines into the middle of whatever scrolls around the editor. */
  reveal(): void
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
    reveal() {
      if (firstHighlighted === null || firstHighlighted > view.state.doc.lines) return
      const pos = view.state.doc.line(firstHighlighted).from
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
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
 */
export function mountDiff(
  parent: HTMLElement,
  lines: DiffLine[],
  path: string,
  highlight: number[] = []
): Viewer {
  const marked = new Set(highlight)
  const widest = String(lines.reduce((max, l) => Math.max(max, l.old ?? 0, l.new ?? 0), 0)).replace(
    /\d/g,
    '0'
  )

  const numbers = (side: 'old' | 'new') =>
    gutter({
      class: `abele-github-code__gutter abele-github-code__gutter_${side}`,
      lineMarker(view, block) {
        const line = lines[view.state.doc.lineAt(block.from).number - 1]
        const n = line?.[side]
        return n === undefined ? null : new NumberMarker(String(n))
      },
      initialSpacer: () => new NumberMarker(widest),
    })

  const state = EditorState.create({ doc: lines.map((l) => l.text).join('\n') })
  const decorations = lineDecorations(state, (n) => {
    const i = n - 1
    const classes = [TYPE_CLASS[lines[i]?.type ?? 'ctx']].filter(Boolean)
    if (marked.has(i)) classes.push('abele-github-code__line_target')
    return classes
  })

  return mount(
    parent,
    state.doc.toString(),
    [numbers('old'), numbers('new'), EditorView.decorations.of(decorations), ...languageFor(path)],
    highlight.length > 0 ? Math.min(...highlight) + 1 : null
  )
}

export function mountCode(
  parent: HTMLElement,
  text: string,
  path: string,
  range?: LineRange
): Viewer {
  const state = EditorState.create({ doc: text })
  const decorations = range
    ? lineDecorations(state, (n) =>
        n >= range.start && n <= range.end ? ['abele-github-code__line_target'] : []
      )
    : Decoration.none

  return mount(
    parent,
    text,
    [lineNumbers(), EditorView.decorations.of(decorations), ...languageFor(path)],
    range ? range.start : null
  )
}
