/**
 * Comment markers in the editor.
 *
 * Live preview only, like the plugin's other fields. Per marker the field emits two things: a
 * `Decoration.replace` carrying the icon widget, so the raw `%%c:…%%` never shows whatever the
 * cursor is doing, and a `Decoration.mark` over the passage the comment is about, when the
 * quote can still be found.
 *
 * The quote lives in the chat file, not in the note, so the field asks a `CommentInfoSource`
 * for it. Phase 2 ships the no-op source and phase 3 installs `CommentService`; until then
 * every marker is point-anchored and idle, which is the intended state and not a defect.
 */
import {
  EditorSelection,
  EditorState,
  Extension,
  Range,
  StateEffect,
  StateField,
  Text,
} from '@codemirror/state'
import { Decoration, DecorationSet, EditorView } from '@codemirror/view'
import { MarkdownView, editorInfoField, editorLivePreviewField } from 'obsidian'
import { CommentMarkerWidget } from './CommentMarkerWidget'
import { ParsedMarker, parseMarkers, resolveQuote } from './commentMarkers'
import { GlobalStore } from '@/stores/GlobalStore'

export type CommentState = 'idle' | 'busy' | 'pending' | 'error'

export interface CommentInfo {
  quote?: string
  state: CommentState
  open: boolean
  /** How much has been said in this comment — what the marker's digit counts. */
  messages: number
}

/**
 * Source of `CommentInfo`. Phase 2 ships a no-op default; phase 3 installs `CommentService`.
 *
 * `touch` is called from inside the field's computation, so an implementation must never
 * dispatch synchronously — it starts a load and answers later with `commentsChanged`.
 */
export interface CommentInfoSource {
  get(id: string): CommentInfo | undefined
  touch(notePath: string, ids: string[]): void
}

let commentInfoSource: CommentInfoSource = {
  get: () => undefined,
  touch: () => {},
}

export function setCommentInfoSource(source: CommentInfoSource): void {
  commentInfoSource = source
}

/** Dispatched to every view of a note after a load or a state change; forces a rebuild. */
export const commentsChanged = StateEffect.define<null>()

/**
 * Which state a marker shows when it carries several comments: the one that most wants the
 * user. Something waiting on an answer outranks something that failed, which outranks
 * something still working.
 */
const STATE_PRECEDENCE: CommentState[] = ['pending', 'error', 'busy', 'idle']

function markerState(infos: (CommentInfo | undefined)[]): CommentState {
  for (const state of STATE_PRECEDENCE) {
    if (infos.some((info) => info?.state === state)) return state
  }
  return 'idle'
}

/**
 * One parse per document.
 *
 * The field, the atomic-range facet and the transaction filter all want the same markers on the
 * same keystroke, and `parseMarkers` walks the whole note to find them. A CodeMirror `Text` is
 * immutable and a new one is made for every change, so it is exactly the right key: one document
 * is parsed once however many readers it has, and an edited document parses again.
 */
const markersByDoc = new WeakMap<Text, ParsedMarker[]>()

export function markersOf(doc: Text): ParsedMarker[] {
  const known = markersByDoc.get(doc)
  if (known) return known

  const markers = parseMarkers(doc.toString())
  markersByDoc.set(doc, markers)
  return markers
}

/**
 * The markers this state should act on, and the one guard all three extensions share.
 *
 * Live preview, and a pane that holds a file: guarding them differently is how an editor with
 * no file ends up showing the raw marker as text while Backspace still swallows it whole.
 */
function activeMarkers(state: EditorState): ParsedMarker[] {
  if (!state.field(editorLivePreviewField, false)) return []
  if (!state.field(editorInfoField, false)?.file?.path) return []

  return markersOf(state.doc)
}

/**
 * What a press on a marker does.
 *
 * Injected rather than imported: `CommentService` already imports this module for
 * `dispatchCommentsChanged`, and importing it back would close a cycle for one call.
 * `main.ts` imports both and installs the handler there.
 */
let commentClickHandler: (ids: string[]) => void = () => {}

export function setCommentClickHandler(handler: (ids: string[]) => void): void {
  commentClickHandler = handler
}

/**
 * Where a press on a marker goes: the chat sidebar, always.
 *
 * There is nothing to measure any more. A card in the margin was tried for three releases and
 * taken out again — it only appeared on a very wide screen, and everywhere else it was a
 * second way of showing a conversation that had to be kept in step with the first.
 */
function handleMarkerClick(ids: string[]): void {
  console.debug('abele: comment marker clicked', ids.join(','))
  commentClickHandler(ids)
}

function buildCommentDecorations(state: EditorState): DecorationSet {
  const markers = activeMarkers(state)
  if (markers.length === 0) return Decoration.none

  const notePath = state.field(editorInfoField, false)?.file?.path ?? ''
  const text = state.doc.toString()

  const decorations: Range<Decoration>[] = []

  for (const marker of markers) {
    // Every id on screen is reported, which is what starts a load for one nobody has read yet.
    commentInfoSource.touch(notePath, marker.ids)

    const infos = marker.ids.map((id) => commentInfoSource.get(id))
    const open = infos.some((info) => info?.open === true)
    const iconState = markerState(infos)
    // Everything said at this marker. A marker can carry more than one comment and the icon is
    // one icon, so the digit is the sum: it answers "how much is there", which is the question
    // somebody scanning a page of markers is asking.
    const said = infos.reduce((total, info) => total + (info?.messages ?? 0), 0)
    // Comments on one marker share a selection, so the first quote anyone knows is the quote.
    const quote = infos.find((info) => info?.quote)?.quote

    const range = resolveQuote(text, marker, quote)
    if (range && range.from < range.to) {
      decorations.push(
        Decoration.mark({
          class:
            'abele-comment__quote' +
            (open ? ' abele-comment__quote_open' : '') +
            (iconState === 'busy' ? ' abele-comment__quote_busy' : ''),
        }).range(range.from, range.to)
      )
    }

    decorations.push(
      Decoration.replace({
        widget: new CommentMarkerWidget(marker.ids, said, iconState, open, handleMarkerClick),
      }).range(marker.from, marker.to)
    )
  }

  // A resolved quote can sit anywhere in the document, so the set is sorted rather than built
  // in order: `RangeSetBuilder` would throw on the first quote that follows its own marker.
  return Decoration.set(decorations, true)
}

export const commentStateField = StateField.define<DecorationSet>({
  create(state) {
    return buildCommentDecorations(state)
  },
  update(decorations, tr) {
    if (
      tr.docChanged ||
      tr.state.field(editorLivePreviewField, false) !==
        tr.startState.field(editorLivePreviewField, false) ||
      tr.effects.some((effect) => effect.is(commentsChanged))
    ) {
      return buildCommentDecorations(tr.state)
    }

    // Deliberately not rebuilt on a selection change: unlike a gallery header, a marker is
    // hidden whatever the cursor is doing.
    return decorations.map(tr.changes)
  },
  provide(field) {
    return [EditorView.decorations.from(field)]
  },
})

/** A replaced marker, used only to say which stretches of text are indivisible. */
const atomicMarker = Decoration.replace({})

/**
 * Backspace beside a marker takes the whole marker, rather than one `%` off the end of it.
 *
 * This cannot be derived from `commentStateField`: that set also holds the quote marks, and
 * making the user's own prose atomic would leave them unable to edit the passage.
 */
const commentAtomicRanges = EditorView.atomicRanges.of((view) =>
  Decoration.set(
    activeMarkers(view.state).map((marker) => atomicMarker.range(marker.from, marker.to))
  )
)

/**
 * Moves the caret over a marker in both directions, in the spirit of `galleryCursorFilter`.
 *
 * `atomicRanges` above governs the editor's own cursor motion; this governs every other way a
 * caret can land inside the marker — a mouse click, a programmatic `setCursor`, a search hit.
 * Transactions that change the document are left alone, because the marker positions read here
 * come from the state before the change and would no longer refer to the same text.
 */
export const commentCursorFilter: Extension = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged) return tr
  if (tr.newSelection.eq(tr.startState.selection)) return tr

  const markers = activeMarkers(tr.startState)
  if (markers.length === 0) return tr

  const oldHead = tr.startState.selection.main.head
  let modified = false

  const ranges = tr.newSelection.ranges.map((range) => {
    for (const marker of markers) {
      if (range.head <= marker.from || range.head >= marker.to) continue

      modified = true
      const head = oldHead <= marker.from ? marker.to : marker.from

      return range.anchor === range.head
        ? EditorSelection.cursor(head)
        : EditorSelection.range(range.anchor, head)
    }
    return range
  })

  return modified ? [tr, { selection: EditorSelection.create(ranges) }] : tr
})

/**
 * Every editor showing this note recomputes its markers. Called by the info source once a
 * comment has been read from disk or its session's state has changed.
 */
export function dispatchCommentsChanged(notePath: string): void {
  const { app } = GlobalStore.getInstance()

  app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view
    if (!(view instanceof MarkdownView) || view.file?.path !== notePath) return

    const cm = (view as unknown as { editor?: { cm?: EditorView } }).editor?.cm
    cm?.dispatch({ effects: commentsChanged.of(null) })
  })
}

export const commentExtensions: Extension = [
  commentStateField,
  commentAtomicRanges,
  commentCursorFilter,
]
