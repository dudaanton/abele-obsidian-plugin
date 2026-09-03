/**
 * What the editor does with a marker.
 *
 * The field is exercised through a real `EditorState` rather than by calling the builder: the
 * decorations only mean anything in the order and at the offsets CodeMirror will apply them,
 * and the same state is what the cursor filter runs in.
 *
 * The default `CommentInfoSource` knows nothing, which is the whole of phase 2: every marker
 * is point-anchored and idle until `CommentService` is installed. A test that wants a quote
 * installs a source of its own and puts the silent one back afterwards.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { TFile, editorInfoField, editorLivePreviewField } from 'obsidian'
import {
  CommentEntries,
  CommentInfo,
  CommentInfoSource,
  commentExtensions,
  firstOccurrences,
  setCommentClickHandler,
  markersOf,
  setCommentInfoSource,
  commentStateField,
} from '@/editor/CommentPlugin'
import { parseMarkers } from '@/editor/commentMarkers'
import { CommentMarkerWidget } from '@/editor/CommentMarkerWidget'
import { marginOverlayFor } from '@/editor/MarginOverlay'
import { GlobalStore } from '@/stores/GlobalStore'

const NOTE = 'Notes/Anchor.md'
const DOC = 'The selected passage%%c:k7d2ph%% and more.'
const MARKER_FROM = 20
const MARKER_TO = 32

const silent: CommentInfoSource = { get: () => undefined, touch: () => {} }

afterEach(() => setCommentInfoSource(silent))

function noteFile(): TFile {
  const file = new TFile()
  file.path = NOTE
  file.basename = 'Anchor'
  file.extension = 'md'
  return file
}

function stateFor(
  doc: string,
  options: { live?: boolean; head?: number; file?: boolean } = {}
): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(options.head ?? 0),
    extensions: [
      editorLivePreviewField.init(() => options.live ?? true),
      editorInfoField.init(() => ({ file: options.file === false ? null : noteFile() })),
      // The shipped array, so the atomic ranges under test are the ones the editor loads.
      commentExtensions,
    ],
  })
}

/**
 * The stretches the editor refuses to put a caret inside — read out of the facet, because
 * `atomicRanges` is what makes Backspace take the whole marker and it is not in the field's set.
 */
function atomicRangesOf(state: EditorState): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = []
  for (const provider of state.facet(EditorView.atomicRanges)) {
    provider({ state } as unknown as EditorView).between(0, state.doc.length, (from, to) => {
      found.push({ from, to })
    })
  }
  return found
}

/**
 * Enough of an `EditorView` for the margin provider: it reads the state, hangs its hosts in the
 * scroller and measures. happy-dom lays nothing out, so the rects are stubbed as they are in
 * `marginOverlay.test.ts`.
 */
function fakeView(state: EditorState): EditorView {
  const document = window.document
  const scrollDOM = document.createElement('div')
  const contentDOM = document.createElement('div')
  scrollDOM.appendChild(contentDOM)
  document.body.appendChild(scrollDOM)

  const rect = (right: number) =>
    ({ left: 0, top: 0, right, bottom: 0, width: right, height: 0, x: 0, y: 0 }) as DOMRect
  scrollDOM.getBoundingClientRect = () => rect(1000)
  contentDOM.getBoundingClientRect = () => rect(700)

  return { state, scrollDOM, contentDOM, coordsAtPos: () => null } as unknown as EditorView
}

/** `Range` from CodeMirror is a class, so the shape the test collects is spelled out here. */
interface Deco {
  from: number
  to: number
  value: Decoration
}

function decorationsOf(state: EditorState): Deco[] {
  const found: Deco[] = []
  state.field(commentStateField).between(0, state.doc.length, (from, to, value) => {
    found.push({ from, to, value })
  })
  return found
}

describe('the comment decorations', () => {
  it('replaces the marker with a widget carrying its ids', () => {
    const found = decorationsOf(stateFor(DOC))

    expect(found).toHaveLength(1)
    expect(found[0].from).toBe(MARKER_FROM)
    expect(found[0].to).toBe(MARKER_TO)

    const widget = found[0].value.spec.widget as CommentMarkerWidget

    expect(widget.toDOM().getAttribute('data-comment-ids')).toBe('k7d2ph')
  })

  it('leaves the marker as text outside live preview', () => {
    expect(decorationsOf(stateFor(DOC, { live: false }))).toEqual([])
  })

  it('point-anchors every marker while nothing knows the quotes', () => {
    // The phase-2 default: one decoration per marker, and no quote mark anywhere.
    expect(decorationsOf(stateFor(DOC))).toHaveLength(1)
  })

  it('marks the quoted range when the source knows the quote', () => {
    setCommentInfoSource({
      get: (): CommentInfo => ({ quote: 'The selected passage', state: 'idle', open: false }),
      touch: () => {},
    })

    const found = decorationsOf(stateFor(DOC))

    expect(found).toHaveLength(2)
    expect(found[0].from).toBe(0)
    expect(found[0].to).toBe(MARKER_FROM)
    expect(found[0].value.spec.class).toBe('abele-comment__quote')
  })

  it('says on the quote when the comment is open and running', () => {
    setCommentInfoSource({
      get: (): CommentInfo => ({ quote: 'The selected passage', state: 'busy', open: true }),
      touch: () => {},
    })

    const found = decorationsOf(stateFor(DOC))

    expect(found[0].value.spec.class).toBe(
      'abele-comment__quote abele-comment__quote_open abele-comment__quote_busy'
    )
  })

  it('shows the most urgent state when a marker carries several comments', () => {
    setCommentInfoSource({
      get: (id): CommentInfo => ({ state: id === 'k7d2ph' ? 'busy' : 'pending', open: false }),
      touch: () => {},
    })

    const found = decorationsOf(stateFor('Passage%%c:k7d2ph,3mq0xa%%'))
    const el = (found[0].value.spec.widget as CommentMarkerWidget).toDOM()

    expect(el.classList.contains('abele-comment-marker_pending')).toBe(true)
  })

  it('asks the source to load every id it can see', () => {
    const seen: { notePath: string; ids: string[] }[] = []
    setCommentInfoSource({
      get: () => undefined,
      touch: (notePath, ids) => seen.push({ notePath, ids }),
    })

    stateFor('a%%c:aaaaaa%%b%%c:bbbbbb,cccccc%%')

    expect(seen).toEqual([
      { notePath: NOTE, ids: ['aaaaaa'] },
      { notePath: NOTE, ids: ['bbbbbb', 'cccccc'] },
    ])
  })
})

describe('the caret and a marker', () => {
  it('steps over the marker moving right', () => {
    const state = stateFor(DOC, { head: MARKER_FROM })

    const applied = state.update({ selection: EditorSelection.cursor(MARKER_FROM + 1) })

    expect(applied.state.selection.main.head).toBe(MARKER_TO)
  })

  it('steps over the marker moving left', () => {
    const state = stateFor(DOC, { head: MARKER_TO })

    const applied = state.update({ selection: EditorSelection.cursor(MARKER_TO - 1) })

    expect(applied.state.selection.main.head).toBe(MARKER_FROM)
  })

  it('leaves a caret outside the marker where it was put', () => {
    const state = stateFor(DOC)

    const applied = state.update({ selection: EditorSelection.cursor(5) })

    expect(applied.state.selection.main.head).toBe(5)
  })

  it('does not interfere outside live preview', () => {
    const state = stateFor(DOC, { live: false, head: MARKER_FROM })

    const applied = state.update({ selection: EditorSelection.cursor(MARKER_FROM + 1) })

    expect(applied.state.selection.main.head).toBe(MARKER_FROM + 1)
  })
})

describe('parsing the document once', () => {
  it('gives every reader the same markers for one document', () => {
    const state = stateFor(DOC)

    // The field, the atomic-range facet and the cursor filter all ask on the same keystroke.
    expect(markersOf(state.doc)).toBe(markersOf(state.doc))
  })

  it('parses again once the document has changed', () => {
    const state = stateFor(DOC)
    const next = state.update({ changes: { from: 0, insert: 'X' } }).state

    expect(markersOf(next.doc)).not.toBe(markersOf(state.doc))
    expect(markersOf(next.doc)[0].from).toBe(MARKER_FROM + 1)
  })
})

describe('an editor the extensions want nothing to do with', () => {
  it('makes the marker atomic in a live-preview pane that has a file', () => {
    expect(atomicRangesOf(stateFor(DOC))).toEqual([{ from: MARKER_FROM, to: MARKER_TO }])
  })

  it('makes nothing atomic outside live preview', () => {
    expect(atomicRangesOf(stateFor(DOC, { live: false }))).toEqual([])
  })

  it('leaves a pane with no file alone in every one of the three', () => {
    // All three guard alike, so a fileless editor cannot show the raw marker as text while
    // Backspace still swallows it whole.
    const state = stateFor(DOC, { file: false, head: MARKER_FROM })

    expect(decorationsOf(state)).toEqual([])
    expect(atomicRangesOf(state)).toEqual([])
    expect(
      state.update({ selection: EditorSelection.cursor(MARKER_FROM + 1) }).state.selection.main.head
    ).toBe(MARKER_FROM + 1)
  })
})

describe('the margin provider at teardown', () => {
  it('gives its hosts back to the store when the view goes', () => {
    const store = GlobalStore.getInstance()
    store.commentsContainers.value = []
    const provider = new CommentEntries(fakeView(stateFor(DOC)))

    expect(store.commentsContainers.value).toHaveLength(1)

    provider.destroy()

    expect(store.commentsContainers.value).toHaveLength(0)
  })

  it('does not build a layer on a view whose overlay has already gone', () => {
    // `footnoteExtensions` is registered before `commentExtensions`, so by the time this
    // provider is torn down the footnote one has already called `MarginOverlay.destroy()`.
    const view = fakeView(stateFor(DOC))
    const provider = new CommentEntries(view)

    marginOverlayFor(view).destroy()
    provider.destroy()

    expect(view.scrollDOM.querySelector('.abele-margin-overlay')).toBeNull()
  })
})

describe('a marker that was copied along with its text', () => {
  it('leaves the card with the first occurrence in the document', () => {
    const markers = parseMarkers('One%%c:k7d2ph%% and a pasted copy%%c:k7d2ph%%.')
    expect(markers).toHaveLength(2)

    const kept = firstOccurrences(markers)

    expect(kept).toHaveLength(1)
    expect(kept[0].from).toBe(markers[0].from)
  })

  it('keeps a marker carrying a different set of ids', () => {
    const markers = parseMarkers('One%%c:k7d2ph%% and another%%c:3mq0xa%%.')

    expect(firstOccurrences(markers).map((marker) => marker.ids.join(','))).toEqual([
      'k7d2ph',
      '3mq0xa',
    ])
  })

  it('counts the same two comments in the other order as a set of its own', () => {
    // `insertMarker` only ever appends, so a marker written by the plugin cannot reach this
    // state — but a marker edited by hand can, and two ids in the other order are two
    // different conversations to look at. Better a second card than a card nobody can reach.
    const markers = parseMarkers('One%%c:k7d2ph,3mq0xa%% two%%c:3mq0xa,k7d2ph%%.')

    expect(firstOccurrences(markers)).toHaveLength(2)
  })
})

describe('pressing a marker', () => {
  // The handler asks the workspace for the live editor so it can measure the margin. There is
  // no workspace in this tier, and an app with none at all throws before the handler is
  // reached — so the smallest one that answers the question is installed here.
  beforeEach(() => {
    ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = {
      workspace: { getActiveViewOfType: () => null },
    }
  })

  afterEach(() => setCommentClickHandler(() => {}))

  it('hands the ids to whatever was installed to handle them', () => {
    const handler = vi.fn()
    setCommentClickHandler(handler)

    const found = decorationsOf(stateFor(DOC))
    const widget = found[0].value.spec.widget as CommentMarkerWidget
    widget.toDOM().dispatchEvent(new MouseEvent('click'))

    expect(handler).toHaveBeenCalledWith(['k7d2ph'], false)
  })
})
