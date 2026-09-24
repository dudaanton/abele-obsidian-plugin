/**
 * Opening a note at the lines a link names: which leaf it lands in, and what the person sees
 * there — the range selected in the editor, or flashed in reading view.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MarkdownView, type TFile } from 'obsidian'
import { openNoteAtLines, resolveLineLink } from '@/lineLinks/open'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const NOTE = 'Projects/Budget.md'
const TEXT = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')

interface Pos {
  line: number
  ch: number
}

/** A markdown view in one mode, recording what was done to its editor and preview. */
class FakeMarkdownView extends MarkdownView {
  file: TFile | null = null
  data = TEXT
  selection: [Pos, Pos] | null = null
  scrolledTo: { from: Pos; to: Pos } | null = null
  focused = false
  sections = Array.from({ length: 30 }, (_, i) => ({
    start: { line: i },
    end: { line: i },
    el: document.createElement('p'),
  }))
  previewScroll: number | null = null
  previewMode = {
    applyScroll: (n: number) => (this.previewScroll = n),
    renderer: { sections: this.sections },
  }
  editor = {
    getValue: () => this.data,
    getLine: (n: number) => this.data.split('\n')[n] ?? '',
    setSelection: (a: Pos, b: Pos) => (this.selection = [a, b]),
    scrollIntoView: (range: { from: Pos; to: Pos }) => (this.scrolledTo = range),
    focus: () => (this.focused = true),
  }
  constructor(public mode: 'source' | 'preview') {
    super()
  }
  getMode() {
    return this.mode
  }
}

let app: FakeApp & { workspace: unknown }
let leaves: Array<{ pane: unknown; view: FakeMarkdownView; opened: TFile | null }>
let mode: 'source' | 'preview'

beforeEach(() => {
  mode = 'source'
  leaves = []
  app = useVault([{ path: NOTE, content: TEXT }]) as typeof app
  app.workspace = {
    getLeaf: (pane: unknown) => {
      const leaf = {
        pane,
        view: new FakeMarkdownView(mode),
        opened: null as TFile | null,
        async openFile(file: TFile) {
          leaf.opened = file
          leaf.view.file = file
        },
      }
      leaves.push(leaf)
      return leaf
    },
  }
})

const note = () => app.vault.getAbstractFileByPath(NOTE) as TFile

describe('resolving a link to lines', () => {
  it('finds the note by path or name, with or without .md', () => {
    const asApp = app as never
    expect(resolveLineLink(asApp, 'Projects/Budget#L3', '')?.file.path).toBe(NOTE)
    expect(resolveLineLink(asApp, 'Budget#L3-L4', '')?.lines).toEqual({ from: 3, to: 4 })
    expect(resolveLineLink(asApp, 'Projects/Budget.md#L3', '')?.file.path).toBe(NOTE)
  })

  it('leaves alone a link that is not to lines, or not to a note that exists', () => {
    const asApp = app as never
    expect(resolveLineLink(asApp, 'Budget#Totals', '')).toBeNull()
    expect(resolveLineLink(asApp, 'Nowhere#L3', '')).toBeNull()
  })
})

describe('opening at lines in the editor', () => {
  it('reuses the leaf a plain click would, and selects the whole range', async () => {
    await openNoteAtLines(app as never, note(), { from: 3, to: 5 })

    expect(leaves).toHaveLength(1)
    expect(leaves[0].pane).toBe(false)
    expect(leaves[0].opened?.path).toBe(NOTE)
    const view = leaves[0].view
    expect(view.selection).toEqual([
      { line: 2, ch: 0 },
      { line: 4, ch: 'line 5'.length },
    ])
    expect(view.scrolledTo?.from).toEqual({ line: 2, ch: 0 })
    expect(view.focused).toBe(true)
  })

  it('opens in a new tab when the click asked for one', async () => {
    await openNoteAtLines(app as never, note(), { from: 3, to: 3 }, 'tab')
    expect(leaves[0].pane).toBe('tab')
  })

  it('ends a range past the end at the last line that is not blank', async () => {
    const withTail = new FakeMarkdownView('source')
    withTail.data = 'one\ntwo\n\n'
    ;(app.workspace as { getLeaf: unknown }).getLeaf = () => ({
      view: withTail,
      openFile: async () => {},
    })
    await openNoteAtLines(app as never, note(), { from: 9, to: 9 })
    expect(withTail.selection).toEqual([
      { line: 1, ch: 0 },
      { line: 1, ch: 3 },
    ])
  })

  it('ends a range past the end of the note at its last line, without complaint', async () => {
    await openNoteAtLines(app as never, note(), { from: 28, to: 400 })
    expect(leaves[0].view.selection).toEqual([
      { line: 27, ch: 0 },
      { line: 29, ch: 'line 30'.length },
    ])
  })
})

describe('opening at lines in reading view', () => {
  beforeEach(() => {
    mode = 'preview'
    vi.useFakeTimers()
  })

  it('scrolls a little above the range and flashes the blocks holding it', async () => {
    await openNoteAtLines(app as never, note(), { from: 10, to: 11 })

    const view = leaves[0].view
    expect(view.previewScroll).toBe(7)
    const flashed = view.sections.filter((s) => s.el.classList.contains('abele-line-flash'))
    expect(flashed.map((s) => s.start.line)).toEqual([9, 10])
    expect(view.selection).toBeNull()

    vi.advanceTimersByTime(3000)
    expect(view.sections.some((s) => s.el.classList.contains('abele-line-flash'))).toBe(false)
    vi.useRealTimers()
  })

  /** Reading view lays a note out a moment after it opens; flashing before that finds nothing. */
  it('waits for the note to be rendered before scrolling and flashing', async () => {
    vi.useRealTimers()
    const origGetLeaf = (app.workspace as { getLeaf: (p: unknown) => { view: FakeMarkdownView } })
      .getLeaf
    ;(app.workspace as { getLeaf: unknown }).getLeaf = (pane: unknown) => {
      const leaf = origGetLeaf(pane)
      const all = leaf.view.sections.splice(0)
      setTimeout(() => leaf.view.sections.push(...all), 100)
      return leaf
    }

    await openNoteAtLines(app as never, note(), { from: 20, to: 20 })

    const view = leaves[0].view
    expect(view.sections.filter((s) => s.el.classList.contains('abele-line-flash'))).toHaveLength(1)
  })
})
