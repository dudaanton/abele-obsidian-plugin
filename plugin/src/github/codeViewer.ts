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
import { parsePatch, type DiffLine } from './patch'
import type { LineRange } from './urls'
import { languageFor } from './languages'
import { lineSelection, type SelectionHooks } from './lineSelection'
import { scrollParent } from './scrollTo'

export interface Viewer {
  /**
   * Where the first highlighted line starts, in viewport pixels; null when nothing is highlighted
   * or the editor is not laid out. The editor draws only what is on screen, so before the line is
   * drawn this is an estimate from its height map, which scrolling to brings the line on screen.
   */
  targetTop(): number | null | { estimate: number }
  /** Where line `n` starts, the same way. */
  lineTop(n: number): number | null | { estimate: number }
  /** The line at the top edge of the scrolling tab; null when that cannot be measured. */
  topLine(): number | null
  /** Whether any of the lines `from`–`to` is on screen. */
  shows(from: number, to: number): boolean
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
  firstHighlighted: number | null,
  wrap = true
): Viewer {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [...readOnly, ...(wrap ? [EditorView.lineWrapping] : []), ...extensions],
    }),
  })
  const lineTop = (n: number | null) => {
    if (n === null || n < 1 || n > view.state.doc.lines) return null
    if (!view.dom.isConnected || view.dom.getClientRects().length === 0) return null
    const from = view.state.doc.line(n).from
    // Drawn: where it is. Not drawn yet: where the editor's height map expects it, which is
    // only as good as its guess at how the lines above it wrap.
    const drawn = from >= view.viewport.from && from <= view.viewport.to
    const rect = drawn ? view.coordsAtPos(from) : null
    if (rect) return rect.top
    return { estimate: view.documentTop + view.lineBlockAt(from).top }
  }
  /** The tab's scrolling box, in viewport pixels. */
  const box = () => {
    const container = view.dom.isConnected ? scrollParent(view.dom) : null
    return container ? container.getBoundingClientRect() : null
  }
  return {
    targetTop: () => lineTop(firstHighlighted),
    lineTop,
    topLine() {
      const rect = box()
      if (!rect) return null
      const y = rect.top - view.documentTop
      if (y <= 0) return 1
      return view.state.doc.lineAt(view.lineBlockAtHeight(y).from).number
    },
    shows(from, to) {
      const rect = box()
      const doc = view.state.doc
      if (!rect || from > doc.lines) return false
      const top = view.documentTop + view.lineBlockAt(doc.line(Math.max(1, from)).from).top
      const bottom =
        view.documentTop + view.lineBlockAt(doc.line(Math.min(doc.lines, to)).from).bottom
      return top < rect.bottom && bottom > rect.top
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
  const selection = lineSelection({
    ...hooks,
    initial: highlight.map((i) => i + 1),
    selectable: (n) => lines[n - 1]?.old !== undefined || lines[n - 1]?.new !== undefined,
  })
  const diff = diffParts(lines, selection.gutterHandlers)

  return mount(
    parent,
    diff.doc,
    [...diff.extensions, selection.extension, ...languageFor(path)],
    highlight.length > 0 ? Math.min(...highlight) + 1 : null
  )
}

/** A diff's text, its two columns of line numbers and the colours of its added and removed lines. */
function diffParts(
  lines: DiffLine[],
  handlers?: ReturnType<typeof lineSelection>['gutterHandlers']
): { doc: string; extensions: Extension[] } {
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
      ...(handlers ? { domEventHandlers: handlers } : {}),
    })

  const state = EditorState.create({ doc: lines.map((l) => l.text).join('\n') })
  const decorations = lineDecorations(state, (n) =>
    [TYPE_CLASS[lines[n - 1]?.type ?? 'ctx']].filter(Boolean)
  )
  return {
    doc: state.doc.toString(),
    extensions: [numbers('old'), numbers('new'), EditorView.decorations.of(decorations)],
  }
}

/**
 * A snippet kept in a note: the code, or the diff, with the numbers it had in the file. Nothing is
 * selectable and nothing wraps — a snippet is short and scrolls sideways within itself.
 */
export function mountSnippet(
  parent: HTMLElement,
  snippet: { kind: 'code' | 'diff'; text: string; lang?: string; start?: number }
): Viewer {
  const language = snippet.lang ? languageFor(`snippet.${snippet.lang}`) : []
  if (snippet.kind === 'diff') {
    // The leading `@@` line is kept in the note for its numbers, which the gutters show: not
    // drawn. A header further down marks a gap between hunks and stays, as a separator.
    const lines = parsePatch(snippet.text)
    const diff = diffParts(lines[0]?.type === 'hunk' ? lines.slice(1) : lines)
    return mount(parent, diff.doc, [...diff.extensions, ...language], null, false)
  }
  const offset = (snippet.start ?? 1) - 1
  const numbers = lineNumbers({ formatNumber: (n) => String(n + offset) })
  return mount(parent, snippet.text, [numbers, ...language], null, false)
}

/**
 * @param range lines to mark — a link's, or with `hooks.initialBar` a selection carried over
 * @param focus the line `targetTop` finds, when it is not the first marked one
 */
export function mountCode(
  parent: HTMLElement,
  text: string,
  path: string,
  range?: LineRange,
  hooks: SelectionHooks = {},
  focus?: number
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
    focus ?? (range ? range.start : null)
  )
}
