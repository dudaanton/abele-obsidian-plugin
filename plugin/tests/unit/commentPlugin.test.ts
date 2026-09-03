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
import { describe, it, expect, afterEach } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import { TFile, editorInfoField, editorLivePreviewField } from 'obsidian'
import {
  CommentInfo,
  CommentInfoSource,
  commentCursorFilter,
  commentStateField,
  setCommentInfoSource,
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

function stateFor(doc: string, options: { live?: boolean; head?: number } = {}): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(options.head ?? 0),
    extensions: [
      editorLivePreviewField.init(() => options.live ?? true),
      editorInfoField.init(() => ({ file: noteFile() })),
      commentStateField,
      commentCursorFilter,
    ],
  })
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
