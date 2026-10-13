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
import type { EditorView, ViewUpdate } from '@codemirror/view'
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

describe('a footnote where there is no margin', () => {
  it('closes a peek when its definition changes, so its text and navigation cannot stay stale', async () => {
    const view = fakeView()
    const state = stateFor('A sample[^1].\n\n[^1]: Original text.\n')
    ;(view as unknown as { state: EditorState }).state = state
    view.contentDOM.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 990, bottom: 0, width: 990, height: 0 }) as DOMRect
    const provider = new FootnoteProvider(view)
    marginOverlayFor(view).position()
    const number = view.contentDOM.createSpan({
      cls: 'abele-footnote-ref-link',
      attr: { 'data-footnote-label': '1' },
    })
    try {
      number.click()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(document.querySelector('.abele-footnote-peek')).not.toBeNull()
      const next = state.update({
        changes: { from: 0, to: state.doc.length, insert: 'No footnote.' },
      }).state
      ;(view as unknown as { state: EditorState }).state = next
      provider.update({ docChanged: true, state: next, startState: state } as ViewUpdate)
      expect(document.querySelector('.abele-footnote-peek')).toBeNull()
    } finally {
      provider.destroy()
      view.dom.remove()
    }
  })

  it('opens in a card under its line when its number is pressed, and closes on a second press', async () => {
    const view = fakeView()
    ;(view as unknown as { state: EditorState }).state = stateFor(
      'Rain twice in a week[^1].\n\n[^1]: Read off the gauge on the rail.\n'
    )
    // A phone's width: the text runs to the scroller's edge, nothing beside it.
    view.contentDOM.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 990, bottom: 0, width: 990, height: 0, x: 0, y: 0 }) as DOMRect
    const provider = new FootnoteProvider(view)
    marginOverlayFor(view).position()
    expect(marginOverlayFor(view).hasRoom()).toBe(false)
    const number = view.contentDOM.createSpan({
      cls: 'abele-footnote-ref-link',
      attr: { 'data-footnote-label': '1' },
      text: '1',
    })

    number.click()
    // Its words are drawn by Obsidian's renderer, a moment after the card.
    await new Promise((r) => setTimeout(r, 20))
    const card = document.querySelector('.abele-footnote-peek')
    expect(card?.textContent).toContain('Read off the gauge on the rail.')
    number.click()
    expect(document.querySelector('.abele-footnote-peek')).toBeNull()

    provider.destroy()
  })
})
