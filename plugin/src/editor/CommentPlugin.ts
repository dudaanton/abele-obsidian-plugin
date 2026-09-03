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
import {
  Decoration,
  DecorationSet,
  EditorView,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'
import { MarkdownView, editorInfoField, editorLivePreviewField } from 'obsidian'
import { CommentMarkerWidget } from './CommentMarkerWidget'
import { ParsedMarker, parseMarkers, resolveQuote } from './commentMarkers'
import { CommentEntry } from '@/entities/Comment'
import { MarginEntry, marginOverlayFor, marginOverlayIfAny } from './MarginOverlay'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'

export type CommentState = 'idle' | 'busy' | 'pending' | 'error'

export interface CommentInfo {
  quote?: string
  state: CommentState
  open: boolean
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
 * `main.ts` imports both and installs the handler there. `hasRoom` is the margin's answer,
 * which phase 5 routes on when it sends a card to a sheet instead.
 */
let commentClickHandler: (ids: string[], hasRoom: boolean) => void = () => {}

export function setCommentClickHandler(handler: (ids: string[], hasRoom: boolean) => void): void {
  commentClickHandler = handler
}

/**
 * Where a press on a marker goes: the margin when the pane holding this icon has room for a
 * card beside its text, a sheet when it has not.
 *
 * The view is the one CodeMirror gave the widget, not `getActiveViewOfType`. A marker can be
 * pressed in a split that is not the focused pane, or in a popout window where there is no
 * active markdown view at all, and the margin measured then belongs to another note or to
 * nothing — a wide pane gets a sheet, a narrow one gets a card it cannot show.
 *
 * `hasRoom()` answers `false` until the first measurement, so ask for one before reading it.
 * The reading is deliberate rather than a subscription: `onRoomChange` never reports the state
 * it starts in, and a card that is already open when the margin goes stays as it is — see the
 * decision recorded in the phase 5 plan.
 */
function handleMarkerClick(ids: string[], view: EditorView): void {
  const overlay = marginOverlayFor(view)
  overlay.position()
  const room = overlay.hasRoom()

  console.debug('abele: comment marker clicked', ids.join(','), 'margin room:', room)
  commentClickHandler(ids, room)
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
        widget: new CommentMarkerWidget(marker.ids, iconState, open, handleMarkerClick),
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

/**
 * One card per id set, given to the first marker in document order that carries it.
 *
 * Copying a commented passage copies its marker with it, and both copies then claim the same
 * comments. A host is keyed by its ids, so the second marker finds the first one's host and
 * hands the overlay a second entry pointing at the same element and the same teleport id —
 * the layer appends one node twice and stacks it against itself, and Vue mounts a card into a
 * slot another card already has. The later occurrences keep their icon and lose their card.
 */
export function firstOccurrences(markers: ParsedMarker[]): ParsedMarker[] {
  const seen = new Set<string>()

  return markers.filter((marker) => {
    const key = marker.ids.join(',')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A marker's host in the margin: the element Vue teleports a `CommentCard` into. */
interface HostedEntry {
  /** The marker's ids joined — the identity that survives an edit elsewhere in the note. */
  key: string
  /** The teleport id, written on the mount point as `data-comment-id`. */
  id: string
  el: HTMLElement
}

/**
 * The second provider of the margin overlay, beside footnotes.
 *
 * A host is keyed by its marker's ids rather than by its position, so that typing earlier in
 * the note does not tear the card down and take a half-written question with it. The live
 * position travels to the overlay as `anchorPos`, which is rebuilt on every sync.
 */
export class CommentEntries implements PluginValue {
  private hosted: HostedEntry[] = []
  private destroyed = false

  constructor(private readonly view: EditorView) {
    this.sync()
  }

  /**
   * A frame that lands after the view is gone must not build a layer on a torn-down scroller:
   * `marginOverlayFor` would make a fresh overlay for a dead view. `FootnoteProvider` guards
   * its own frames the same way.
   */
  private positionSoon() {
    window.requestAnimationFrame(() => {
      if (this.destroyed) return
      marginOverlayFor(this.view).position()
    })
  }

  update(update: ViewUpdate) {
    if (this.destroyed) return

    if (
      update.docChanged ||
      update.state.field(editorLivePreviewField, false) !==
        update.startState.field(editorLivePreviewField, false) ||
      update.transactions.some((tr) => tr.effects.some((effect) => effect.is(commentsChanged)))
    ) {
      this.sync()
    }

    // The same three signals the footnote provider re-measures on. A card's height is not
    // known until it has been laid out, so the re-stack waits for the next frame.
    if (update.geometryChanged || update.viewportChanged || update.docChanged) {
      this.positionSoon()
    }
  }

  destroy() {
    this.destroyed = true
    const store = GlobalStore.getInstance()
    for (const hosted of [...this.hosted]) this.drop(hosted, store)
    // Not `destroy()`: the overlay is shared with footnotes, and `FootnotePlugin` owns that call.
    // `IfAny`, because footnotes are registered first and their destroy has already run — asking
    // to create here would put a new layer on a scroller that is on its way out.
    marginOverlayIfAny(this.view)?.setEntries('comment', [])
  }

  private sync() {
    const store = GlobalStore.getInstance()
    const state = this.view.state
    const notePath = state.field(editorInfoField, false)?.file?.path ?? ''
    // The icons come from every marker; the cards come from the first of each id set.
    const markers = firstOccurrences(activeMarkers(state))

    for (const hosted of [...this.hosted]) {
      if (!markers.some((marker) => marker.ids.join(',') === hosted.key)) this.drop(hosted, store)
    }

    const entries: MarginEntry[] = markers.map((marker) => {
      const key = marker.ids.join(',')
      const hosted =
        this.hosted.find((candidate) => candidate.key === key) ??
        this.host(key, marker, notePath, store)

      return { id: hosted.id, kind: 'comment' as const, anchorPos: marker.from, el: hosted.el }
    })

    marginOverlayFor(this.view).setEntries('comment', entries)
    this.positionSoon()
  }

  private host(
    key: string,
    marker: ParsedMarker,
    notePath: string,
    store: GlobalStore
  ): HostedEntry {
    const id = genid()
    const el = createDiv({ cls: 'abele-comment-widget-container' })
    el.id = id
    el.createDiv({ attr: { 'data-comment-id': id }, cls: 'abele-vue-mount' })

    store.commentsContainers.value.push(
      new CommentEntry({ id, ids: [...marker.ids], notePath, markerFrom: marker.from })
    )

    const hosted: HostedEntry = { key, id, el }
    this.hosted.push(hosted)
    return hosted
  }

  private drop(hosted: HostedEntry, store: GlobalStore) {
    const index = store.commentsContainers.value.findIndex((entry) => entry.id === hosted.id)
    if (index !== -1) {
      store.commentsContainers.value[index].cleanup()
      store.commentsContainers.value.splice(index, 1)
    }
    hosted.el.remove()
    this.hosted = this.hosted.filter((candidate) => candidate !== hosted)
  }
}

const commentEntries = ViewPlugin.fromClass(CommentEntries)

export const commentExtensions: Extension = [
  commentStateField,
  commentAtomicRanges,
  commentCursorFilter,
  commentEntries,
]
