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
import { describe, it, expect, afterEach, vi } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { TFile, editorInfoField, editorLivePreviewField } from 'obsidian'
import {
  CommentInfo,
  CommentInfoSource,
  commentExtensions,
  setCommentClickHandler,
  markersOf,
  setCommentInfoSource,
  commentStateField,
} from '@/editor/CommentPlugin'
import { CommentMarkerWidget } from '@/editor/CommentMarkerWidget'

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
 * `marginOverlay.test.ts`. `contentRight` is what makes the margin wide or narrow: the overlay
 * measures `scroller.right - content.right`, and `MARGIN_MIN_SPACE` is 200.
 */
function fakeView(state: EditorState, options: { contentRight?: number } = {}): EditorView {
  const document = window.document
  const scrollDOM = document.createElement('div')
  const contentDOM = document.createElement('div')
  scrollDOM.appendChild(contentDOM)
  document.body.appendChild(scrollDOM)

  const rect = (right: number) =>
    ({ left: 0, top: 0, right, bottom: 0, width: right, height: 0, x: 0, y: 0 }) as DOMRect
  scrollDOM.getBoundingClientRect = () => rect(1000)
  contentDOM.getBoundingClientRect = () => rect(options.contentRight ?? 700)

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
    const state = stateFor(DOC)
    const found = decorationsOf(state)

    expect(found).toHaveLength(1)
    expect(found[0].from).toBe(MARKER_FROM)
    expect(found[0].to).toBe(MARKER_TO)

    const widget = found[0].value.spec.widget as CommentMarkerWidget

    expect(widget.toDOM(fakeView(state)).getAttribute('data-comment-ids')).toBe('k7d2ph')
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

    const state = stateFor('Passage%%c:k7d2ph,3mq0xa%%')
    const found = decorationsOf(state)
    const el = (found[0].value.spec.widget as CommentMarkerWidget).toDOM(fakeView(state))

    expect(el.classList.contains('abele-comment-marker_pending')).toBe(true)
  })

  /**
   * The digit, from what the source says to the DOM the phone draws.
   *
   * It counts what was *said* — «считаться должны сообщения в чате» — and a marker is one icon
   * however many comments hang on it, so what it shows is the sum. A marker nobody has said
   * anything at shows nothing: a "0" beside an icon is not information.
   */
  it('counts everything said at a marker, however many comments it carries', () => {
    setCommentInfoSource({
      get: (id): CommentInfo => ({
        state: 'idle',
        open: false,
        messages: id === 'k7d2ph' ? 4 : 3,
      }),
      touch: () => {},
    })

    const state = stateFor('Passage%%c:k7d2ph,3mq0xa%%')
    const found = decorationsOf(state)
    const el = (found[0].value.spec.widget as CommentMarkerWidget).toDOM(fakeView(state))

    expect(el.querySelector('.abele-comment-marker__count')?.textContent).toBe('7')
  })

  it('draws no digit for a comment nobody has said anything in', () => {
    setCommentInfoSource({
      get: (): CommentInfo => ({ state: 'idle', open: false, pinned: [], messages: 0 }),
      touch: () => {},
    })

    const state = stateFor('Passage%%c:k7d2ph%%')
    const found = decorationsOf(state)
    const el = (found[0].value.spec.widget as CommentMarkerWidget).toDOM(fakeView(state))

    expect(el.querySelector('.abele-comment-marker__count')).toBeNull()
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
/** The widget the field put over the marker, which is what a press arrives on. */
function widgetOf(state: EditorState): CommentMarkerWidget {
  const found = decorationsOf(state).find((deco) => deco.value.spec.widget)
  return found?.value.spec.widget as CommentMarkerWidget
}

describe('where a press on a marker is sent', () => {
  afterEach(() => setCommentClickHandler(() => {}))

  /**
   * Nothing is measured any more: a marker leads to the sidebar wherever it is pressed. The
   * card in the margin it used to lead to on a wide screen is gone.
   */
  it('hands the press the ids it carries, and nothing else', () => {
    const handler = vi.fn()
    setCommentClickHandler(handler)
    const state = stateFor(DOC)

    widgetOf(state).toDOM().dispatchEvent(new MouseEvent('click'))

    expect(handler).toHaveBeenCalledWith(['k7d2ph'])
  })
})
