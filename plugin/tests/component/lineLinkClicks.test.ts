/**
 * A link to lines clicked inside a note — reading view and Live Preview — and a link to lines
 * copied out of the editor.
 *
 * The click is taken in the capture phase, ahead of Obsidian's own handler, only when the link
 * really is to lines of a note that exists; everything else must reach Obsidian untouched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MarkdownView, Menu, Notice, TFile } from 'obsidian'
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state'
import {
  lineLinkHover,
  lineLinkInterceptor,
  registerLineLinks,
  selectedLines,
} from '@/lineLinks/register'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

const NOTE = 'Projects/Budget.md'
const TEXT = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')

let opened: Array<{ pane: unknown; file: TFile | null; selection: unknown }>
let listener: ((evt: MouseEvent) => void) | null = null

function fakeView() {
  const record = { pane: null as unknown, file: null as TFile | null, selection: null as unknown }
  const view = Object.assign(Object.create(MarkdownView.prototype), {
    data: TEXT,
    getMode: () => 'source',
    editor: {
      getValue: () => TEXT,
      getLine: (n: number) => TEXT.split('\n')[n],
      setSelection: (a: unknown, b: unknown) => (record.selection = [a, b]),
      scrollIntoView: () => {},
      focus: () => {},
    },
  })
  return { record, view }
}

beforeEach(() => {
  document.body.replaceChildren()
  opened = []
  const app = useVault([
    { path: NOTE, content: TEXT },
    { path: 'Notes/Here.md', content: '' },
  ]) as unknown as Record<string, unknown>
  app.workspace = {
    getLeavesOfType: () => [],
    getLeaf: (pane: unknown) => {
      const { record, view } = fakeView()
      record.pane = pane
      opened.push(record)
      return {
        view,
        openFile: async (file: TFile) => {
          record.file = file
        },
      }
    },
  }
  listener = lineLinkInterceptor(app as never)
  document.addEventListener('click', listener, { capture: true })
})

afterEach(() => {
  if (listener) document.removeEventListener('click', listener, { capture: true })
})

/** A note in reading view holding one rendered internal link. */
function readingView(href: string, wrapperClass = 'workspace-leaf-content'): HTMLElement {
  const leaf = document.body.appendChild(document.createElement('div'))
  leaf.className = wrapperClass
  const view = leaf.appendChild(document.createElement('div'))
  view.className = 'markdown-reading-view'
  const a = view.appendChild(document.createElement('a'))
  a.className = 'internal-link'
  a.setAttribute('data-href', href)
  a.textContent = 'the totals'
  return a
}

/** Clicks like a person, and says whether Obsidian's own handler would still have seen it. */
function click(el: Element, init: MouseEventInit = {}): { reachedObsidian: boolean } {
  let reachedObsidian = false
  const obsidian = () => (reachedObsidian = true)
  el.addEventListener('click', obsidian)
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
  el.removeEventListener('click', obsidian)
  return { reachedObsidian }
}

describe('a link to lines in reading view', () => {
  it('opens the note in the same leaf with the lines selected, instead of Obsidian', async () => {
    const { reachedObsidian } = click(readingView('Projects/Budget#L4-L6'))

    expect(reachedObsidian).toBe(false)
    await vi.waitFor(() => expect(opened[0]?.selection).toBeTruthy())
    expect(opened[0].pane).toBe(false)
    expect(opened[0].file?.path).toBe(NOTE)
    expect(opened[0].selection).toEqual([
      { line: 3, ch: 0 },
      { line: 5, ch: 'line 6'.length },
    ])
  })

  it('opens a new tab on Mod-click, a split on Mod+Alt', async () => {
    click(readingView('Projects/Budget#L4'), { metaKey: true })
    click(readingView('Projects/Budget#L4'), { ctrlKey: true, altKey: true })

    await vi.waitFor(() => expect(opened).toHaveLength(2))
    expect(opened.map((o) => o.pane)).toEqual(['tab', 'split'])
  })

  it('leaves a heading link, a missing note and a plain link to Obsidian', () => {
    for (const href of ['Projects/Budget#Totals', 'Nowhere#L4', 'Projects/Budget']) {
      expect(click(readingView(href)).reachedObsidian, href).toBe(true)
    }
    expect(opened).toHaveLength(0)
  })

  it('leaves the plugin’s own rendered markdown to its component', () => {
    const a = readingView('Projects/Budget#L4')
    a.parentElement!.classList.add('abele-markdown')
    expect(click(a).reachedObsidian).toBe(true)
    expect(opened).toHaveLength(0)
  })

  it('works in a page preview hovering over a note', async () => {
    click(readingView('Projects/Budget#L2', 'hover-popover'))
    await vi.waitFor(() => expect(opened).toHaveLength(1))
  })
})

/**
 * The pointer resting on a link to lines. Left to itself, Obsidian's page preview looks for a
 * heading called `L4-L6` and shows "Unable to find"; here it is asked for the note, scrolled to
 * the lines.
 */
describe('the hover preview of a link to lines', () => {
  let triggered: unknown[][]
  let hover: ((evt: MouseEvent) => void) | null = null

  beforeEach(() => {
    triggered = []
    const app = GlobalStore.getInstance().app as unknown as { workspace: Record<string, unknown> }
    app.workspace.trigger = (...args: unknown[]) => triggered.push(args)
    hover = lineLinkHover(app as never)
    document.addEventListener('mouseover', hover, { capture: true })
  })

  afterEach(() => {
    if (hover) document.removeEventListener('mouseover', hover, { capture: true })
  })

  const pointAt = (el: Element): { reachedObsidian: boolean } => {
    let reachedObsidian = false
    const obsidian = () => (reachedObsidian = true)
    el.addEventListener('mouseover', obsidian)
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    el.removeEventListener('mouseover', obsidian)
    return { reachedObsidian }
  }

  it("asks for the note scrolled to the first line, in place of Obsidian's own preview", () => {
    const a = readingView('Projects/Budget#L4-L6')
    expect(pointAt(a).reachedObsidian).toBe(false)

    expect(triggered).toHaveLength(1)
    const [name, info] = triggered[0] as [string, Record<string, unknown>]
    expect(name).toBe('hover-link')
    expect(info).toMatchObject({
      source: 'preview',
      targetEl: a,
      linktext: NOTE,
      state: { scroll: 3 },
    })
  })

  it('does the same for a link in a chat message', () => {
    const a = readingView('Projects/Budget#L4')
    a.parentElement!.classList.add('abele-markdown')
    pointAt(a)
    expect(triggered).toHaveLength(1)
  })

  it('leaves a heading link to Obsidian', () => {
    expect(pointAt(readingView('Projects/Budget#Totals')).reachedObsidian).toBe(true)
    expect(triggered).toHaveLength(0)
  })
})

/**
 * Live Preview: a real CodeMirror editor, with the link styled the way Obsidian styles it — a
 * `cm-hmd-internal-link` span around underlined text — so the click is mapped back to a position
 * in the line exactly as it is in the app.
 */
function livePreview(doc: string, linkText: string, live = true) {
  const start = doc.indexOf(linkText)
  const styled = StateField.define<DecorationSet>({
    create: () => {
      const builder = new RangeSetBuilder<Decoration>()
      builder.add(
        start,
        start + linkText.length,
        Decoration.mark({ class: 'cm-hmd-internal-link cm-underline' })
      )
      return builder.finish()
    },
    update: (value) => value,
    provide: (field) => EditorView.decorations.from(field),
  })
  const host = document.body.appendChild(document.createElement('div'))
  host.className = 'workspace-leaf-content'
  const source = host.appendChild(document.createElement('div'))
  if (live) source.className = 'is-live-preview'
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [styled] }),
    parent: source,
  })
  const link = view.dom.querySelector('.cm-underline')!
  return { view, link }
}

describe('a link to lines in Live Preview', () => {
  const DOC = 'See [[Projects/Budget#L7-L8|the totals]] for more'

  it('opens the note at the lines on a plain click on the link text', async () => {
    const { link, view } = livePreview(DOC, 'the totals')
    expect(click(link).reachedObsidian).toBe(false)
    await vi.waitFor(() => expect(opened[0]?.selection).toBeTruthy())
    expect(opened[0].selection).toEqual([
      { line: 6, ch: 0 },
      { line: 7, ch: 'line 8'.length },
    ])
    view.destroy()
  })

  it('takes a markdown link to lines too', async () => {
    const { link, view } = livePreview('Read [the totals](Projects/Budget.md#L9) now', 'the totals')
    click(link)
    await vi.waitFor(() => expect(opened[0]?.selection).toBeTruthy())
    expect((opened[0].selection as Array<{ line: number }>)[0].line).toBe(8)
    view.destroy()
  })

  it('in source mode leaves a plain click to place the cursor, and opens on Mod-click', async () => {
    const { link, view } = livePreview(DOC, 'the totals', false)
    expect(click(link).reachedObsidian).toBe(true)
    expect(opened).toHaveLength(0)

    click(link, { metaKey: true })
    await vi.waitFor(() => expect(opened).toHaveLength(1))
    expect(opened[0].pane).toBe(false)
    view.destroy()
  })
})

describe('copying a link to lines', () => {
  const editorAt = (from: [number, number], to: [number, number]) =>
    ({
      getCursor: (which: 'from' | 'to') =>
        which === 'from' ? { line: from[0], ch: from[1] } : { line: to[0], ch: to[1] },
    }) as never

  it('covers the lines the selection touches', () => {
    expect(selectedLines(editorAt([3, 2], [3, 2]))).toEqual({ from: 4, to: 4 })
    expect(selectedLines(editorAt([3, 2], [5, 1]))).toEqual({ from: 4, to: 6 })
  })

  it('does not count a line the selection only reaches the start of', () => {
    expect(selectedLines(editorAt([3, 0], [6, 0]))).toEqual({ from: 4, to: 6 })
  })

  it('offers it on the editor menu and copies it in the person’s link format', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    Notice.shown.length = 0

    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const { app } = GlobalStore.getInstance()
    const appRecord = app as unknown as Record<string, unknown>
    appRecord.workspace = {
      on: (name: string, cb: (...args: unknown[]) => void) => (handlers[name] = cb),
    }
    const generateMarkdownLink = vi.fn(
      (file: TFile, _source: string, subpath: string) => `[[${file.basename}${subpath}]]`
    )
    appRecord.fileManager = { generateMarkdownLink }
    const plugin = {
      app,
      registerDomEvent: () => {},
      registerEvent: () => {},
      addCommand: () => {},
    }
    registerLineLinks(plugin as never)

    const file = app.vault.getAbstractFileByPath(NOTE) as TFile
    const menu = new Menu()
    handlers['editor-menu'](menu, editorAt([9, 0], [11, 3]), { file })

    expect(menu.items.map((i) => i.title)).toEqual(['Copy link to lines'])
    menu.items[0].handler!()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('[[Budget#L10-L12]]'))
    expect(Notice.shown).toContain('Link copied')
  })
})
