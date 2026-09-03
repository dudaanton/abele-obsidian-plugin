/**
 * The footnote provider's share of the margin layer, at teardown.
 *
 * One layer serves both providers and whichever goes first takes it with it, so the other has
 * to ask whether there is a layer rather than ask for one. `marginOverlayFor` would hang a
 * fresh div on a scroller that is already going away — and in a popout being closed, on a
 * window that may no longer be there to make it with.
 */
import { describe, it, expect, vi } from 'vitest'
// The stand-in for the plugin API installs Obsidian's `HTMLElement` helpers on import.
import { TFile, editorInfoField, editorLivePreviewField } from 'obsidian'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { FootnoteProvider } from '@/editor/FootnotePlugin'
import { marginOverlayFor, marginOverlayIfAny } from '@/editor/MarginOverlay'

/** No reference and no definition: the provider still claims the layer, with nothing in it. */
const DOC = 'A line with nothing hanging off it.\n'

function noteFile(): TFile {
  const file = new TFile()
  file.path = 'Notes/Anchor.md'
  file.basename = 'Anchor'
  file.extension = 'md'
  return file
}

function stateFor(doc: string): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(0),
    extensions: [
      editorLivePreviewField.init(() => true),
      editorInfoField.init(() => ({ file: noteFile() })),
    ],
  })
}

/** As in `marginOverlay.test.ts`: happy-dom lays nothing out, so the rects are stubbed. */
function fakeView(): EditorView {
  const scrollDOM = window.document.createElement('div')
  const contentDOM = window.document.createElement('div')
  const dom = window.document.createElement('div')
  scrollDOM.appendChild(contentDOM)
  dom.appendChild(scrollDOM)
  window.document.body.appendChild(dom)

  const rect = (right: number) =>
    ({ left: 0, top: 0, right, bottom: 0, width: right, height: 0, x: 0, y: 0 }) as DOMRect
  scrollDOM.getBoundingClientRect = () => rect(1000)
  contentDOM.getBoundingClientRect = () => rect(700)

  return {
    state: stateFor(DOC),
    dom,
    scrollDOM,
    contentDOM,
    coordsAtPos: () => null,
  } as unknown as EditorView
}

describe('the footnote provider at teardown', () => {
  it('takes the layer with it when it is the one still holding it', () => {
    const view = fakeView()
    const provider = new FootnoteProvider(view)
    expect(marginOverlayIfAny(view)).toBeDefined()

    provider.destroy()

    expect(marginOverlayIfAny(view)).toBeUndefined()
  })

  it('does not mint a layer on a view whose overlay has already gone', () => {
    const view = fakeView()
    const provider = new FootnoteProvider(view)
    marginOverlayFor(view).destroy()
    const appended = vi.spyOn(view.scrollDOM, 'appendChild')

    provider.destroy()

    expect(appended).not.toHaveBeenCalled()
    expect(marginOverlayIfAny(view)).toBeUndefined()
  })
})
