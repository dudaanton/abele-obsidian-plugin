/**
 * Selecting lines by their numbers in a GitHub code view.
 *
 * The gutter handler is called the way CodeMirror calls it — with the line's block and the mouse
 * event — and what is asserted is what the person sees: which lines are marked, whether the bar
 * appears, and the span handed on for the link.
 */
import { describe, it, expect, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
// Installs Obsidian's DOM helpers, which the bar is built with.
import 'obsidian'
import { lineSelection, type SelectionHooks } from '@/github/lineSelection'

function editor(hooks: SelectionHooks = {}, lines = 8) {
  const onSelect = vi.fn()
  const hosts: Array<HTMLElement | null> = []
  const selection = lineSelection({
    ...hooks,
    onSelect,
    onBarHost: (host) => hosts.push(host),
  })
  const parent = document.body.appendChild(document.createElement('div'))
  const doc = Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n')
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [selection.extension] }),
  })
  const click = (line: number, shift = false) =>
    selection.gutterHandlers.mousedown(
      view,
      view.lineBlockAt(view.state.doc.line(line).from),
      new MouseEvent('mousedown', { shiftKey: shift })
    )
  const marked = () =>
    [...view.dom.querySelectorAll('.cm-line')]
      .map((el, i) => (el.classList.contains('abele-github-code__line_target') ? i + 1 : 0))
      .filter(Boolean)
  const bar = () => view.dom.querySelector('.abele-github-code__bar')
  return { view, click, marked, bar, onSelect, hosts }
}

describe('selecting lines by their numbers', () => {
  it('marks the lines a link named, without a bar', () => {
    const e = editor({ initial: [3, 4] })
    expect(e.marked()).toEqual([3, 4])
    expect(e.bar()).toBeNull()
  })

  it('a click selects one line and draws the bar under it', () => {
    const e = editor({ initial: [3, 4] })
    expect(e.click(6)).toBe(true)
    expect(e.marked()).toEqual([6])
    expect(e.onSelect).toHaveBeenLastCalledWith({ from: 6, to: 6 })
    expect(e.bar()).not.toBeNull()
    expect(e.hosts.filter(Boolean).pop()).toBe(e.bar())
  })

  it('a Shift-click extends the selection, in either direction', () => {
    const e = editor()
    e.click(5)
    e.click(2, true)
    expect(e.marked()).toEqual([2, 3, 4, 5])
    expect(e.onSelect).toHaveBeenLastCalledWith({ from: 2, to: 5 })
    e.click(7, true)
    expect(e.onSelect).toHaveBeenLastCalledWith({ from: 5, to: 7 })
  })

  it('a click on the only selected line clears it', () => {
    const e = editor()
    e.click(4)
    e.click(4)
    expect(e.marked()).toEqual([])
    expect(e.bar()).toBeNull()
    expect(e.onSelect).toHaveBeenLastCalledWith(null)
  })

  it('a line that cannot be selected is left to the editor, and skipped inside a range', () => {
    const e = editor({ selectable: (n) => n !== 3 })
    expect(e.click(3)).toBe(false)
    expect(e.onSelect).not.toHaveBeenCalled()
    e.click(2)
    e.click(4, true)
    expect(e.marked()).toEqual([2, 4])
    expect(e.onSelect).toHaveBeenLastCalledWith({ from: 2, to: 4 })
  })
})

describe('on a phone, where there is no Shift', () => {
  it('a tap extends the selection, a tap inside it clears it', () => {
    const e = editor({ initial: [2], extendOnTap: true })
    // The lines a link named are not a selection: the first tap selects one line.
    e.click(4)
    expect(e.marked()).toEqual([4])
    e.click(6)
    expect(e.marked()).toEqual([4, 5, 6])
    expect(e.onSelect).toHaveBeenLastCalledWith({ from: 4, to: 6 })
    e.click(1)
    expect(e.marked()).toEqual([1, 2, 3, 4])
    e.click(3)
    expect(e.marked()).toEqual([])
    expect(e.onSelect).toHaveBeenLastCalledWith(null)
    expect(e.bar()).toBeNull()
  })
})
