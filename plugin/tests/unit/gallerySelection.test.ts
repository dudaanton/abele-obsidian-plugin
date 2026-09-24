/**
 * Selections that run into a gallery in Live Preview.
 *
 * The gallery draws its embed lines as one picture, so a bare cursor landing on one of them is
 * moved to the header, where it can be seen. A selection is different: shrinking it to the
 * header threw away what it covered — a link to lines 15–16 that start at the header came out
 * as line 15 alone, and a drag down across a gallery snapped back to the top of it.
 */
import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { editorInfoField, editorLivePreviewField } from 'obsidian'
import { galleryExtensions } from '@/editor/GalleryPlugin'

const DOC = [
  'Intro line', // 1
  '', // 2
  '::abele-gallery{height=210}::', // 3
  '![[a.jpg|first]]', // 4
  '![[b.jpg|second]]', // 5
  '![[c.jpg|third]]', // 6
  '', // 7
  'After the gallery', // 8
].join('\n')

const state = (anchor = 0, head = anchor) =>
  EditorState.create({
    doc: DOC,
    selection: EditorSelection.single(anchor, head),
    extensions: [editorLivePreviewField.init(() => true), editorInfoField, ...galleryExtensions],
  })

const lineFrom = (s: EditorState, n: number) => s.doc.line(n).from
const lineTo = (s: EditorState, n: number) => s.doc.line(n).to

const select = (from: EditorState, spec: TransactionSpec) => {
  const sel = from.update(spec).state.selection.main
  return { anchor: sel.anchor, head: sel.head }
}

describe('a selection set by code', () => {
  it('keeps a range that starts on the header and ends inside the gallery', () => {
    const s = state()
    const range = { anchor: lineFrom(s, 3), head: lineTo(s, 4) }
    expect(select(s, { selection: range })).toEqual(range)
  })

  it('keeps a range that runs from above into the gallery', () => {
    const s = state()
    const range = { anchor: lineFrom(s, 1), head: lineTo(s, 5) }
    expect(select(s, { selection: range })).toEqual(range)
  })
})

describe('a bare cursor', () => {
  it('landing on a picture line from above still goes to the end of the header', () => {
    const s = state()
    expect(select(s, { selection: { anchor: lineFrom(s, 5) }, userEvent: 'select' })).toEqual({
      anchor: lineTo(s, 3),
      head: lineTo(s, 3),
    })
  })
})

describe('a selection made by hand', () => {
  it('dragged down into the gallery takes the whole of it rather than snapping back', () => {
    const s = state()
    const got = select(s, {
      selection: { anchor: lineFrom(s, 1), head: lineFrom(s, 5) + 3 },
      userEvent: 'select.pointer',
    })
    expect(got).toEqual({ anchor: lineFrom(s, 1), head: lineTo(s, 6) })
  })

  it('dragged up into the gallery takes it from its header', () => {
    const s = state()
    const got = select(s, {
      selection: { anchor: lineTo(s, 8), head: lineFrom(s, 5) + 3 },
      userEvent: 'select.pointer',
    })
    expect(got).toEqual({ anchor: lineTo(s, 8), head: lineFrom(s, 3) })
  })

  it('extended with the keyboard into the gallery covers it', () => {
    const s = state(lineFrom(state(), 1))
    const got = select(s, {
      selection: { anchor: lineFrom(s, 1), head: lineFrom(s, 4) },
      userEvent: 'select',
    })
    expect(got).toEqual({ anchor: lineFrom(s, 1), head: lineTo(s, 6) })
  })

  it('dragged right across the gallery is left alone', () => {
    const s = state()
    const range = { anchor: lineFrom(s, 1), head: lineTo(s, 8) }
    expect(select(s, { selection: range, userEvent: 'select.pointer' })).toEqual(range)
  })
})
