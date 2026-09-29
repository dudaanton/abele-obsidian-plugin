/**
 * A chat file opened into a leaf goes to the chat panel instead, and the leaf is left alone.
 *
 * Every way Obsidian opens a file — the file explorer, the quick switcher, a link in a note,
 * search results, "open in new tab" — ends in `WorkspaceLeaf.openFile`. The leaf it is called
 * on is the one holding the note in front, or a tab made for the occasion. Asserted here is
 * what happens to each: the note is not replaced, and a blank tab made only for the chat goes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TFile } from 'obsidian'
import { keepChatFilesOutOfLeaves } from '@/ai/chatFileLeaves'

class FakeLeaf {
  opened: TFile[] = []
  detached = false
  constructor(
    public viewType: string,
    public activeTime = 0
  ) {}
  get view() {
    return { getViewType: () => this.viewType }
  }
  async openFile(file: TFile): Promise<void> {
    this.opened.push(file)
    this.viewType = file.extension === 'md' ? 'markdown' : 'code'
  }
  detach(): void {
    this.detached = true
  }
}

const file = (path: string): TFile => {
  const f = new TFile()
  f.path = path
  f.extension = path.split('.').pop() ?? ''
  f.basename = path
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '')
  return f
}

/** Tabs in the main area and leaves in the sidebars, and what was made active, in order. */
class FakeWorkspace {
  tabs: FakeLeaf[] = []
  side: FakeLeaf[] = []
  activated: { leaf: FakeLeaf; focus: boolean }[] = []
  iterateRootLeaves(cb: (leaf: FakeLeaf) => void): void {
    this.tabs.filter((l) => !l.detached).forEach(cb)
  }
  iterateAllLeaves(cb: (leaf: FakeLeaf) => void): void {
    ;[...this.tabs, ...this.side].filter((l) => !l.detached).forEach(cb)
  }
  setActiveLeaf(leaf: FakeLeaf, params?: { focus?: boolean }): void {
    this.activated.push({ leaf, focus: !!params?.focus })
  }
}

let open: ReturnType<typeof vi.fn>
let undo: () => void
let ws: FakeWorkspace
const originalOpenFile = FakeLeaf.prototype.openFile

beforeEach(() => {
  open = vi.fn(async () => {})
  ws = new FakeWorkspace()
  undo = keepChatFilesOutOfLeaves(open, () => ws as never, FakeLeaf.prototype as never)
})

afterEach(() => undo())

describe('opening a chat file into a leaf', () => {
  it('sends the chat to the chat panel and leaves the note in the leaf', async () => {
    const leaf = new FakeLeaf('markdown')
    const chat = file('Chats/Talk.abchat')
    await leaf.openFile(chat)
    expect(open).toHaveBeenCalledWith(chat)
    expect(leaf.opened).toEqual([])
    expect(leaf.viewType).toBe('markdown')
    expect(leaf.detached).toBe(false)
  })

  it('closes a blank tab that was opened only to hold the chat', async () => {
    const leaf = new FakeLeaf('empty')
    await leaf.openFile(file('Chats/Talk.abchat'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(leaf.detached).toBe(true)
  })

  it('puts the tab that was in front back in front once the blank tab is closed', async () => {
    const first = new FakeLeaf('markdown', 100)
    const middle = new FakeLeaf('markdown', 300)
    const last = new FakeLeaf('markdown', 200)
    const blank = new FakeLeaf('empty', 400)
    ws.tabs = [first, middle, last, blank]
    await blank.openFile(file('Chats/Talk.abchat'))
    expect(blank.detached).toBe(true)
    expect(ws.activated).toEqual([{ leaf: middle, focus: true }])
  })

  it('gives the focus back to the sidebar it was in, with the tab in front as it was', async () => {
    const note = new FakeLeaf('markdown', 300)
    const other = new FakeLeaf('markdown', 100)
    const panel = new FakeLeaf('abele-ai-sidebar-view', 500)
    const blank = new FakeLeaf('empty', 600)
    ws.tabs = [other, note, blank]
    ws.side = [panel]
    await blank.openFile(file('Chats/Talk.abchat'))
    expect(ws.activated).toEqual([
      { leaf: note, focus: false },
      { leaf: panel, focus: true },
    ])
  })

  it('makes nothing active when the chat is turned away from a leaf holding a note', async () => {
    const note = new FakeLeaf('markdown', 300)
    ws.tabs = [new FakeLeaf('markdown', 100), note]
    await note.openFile(file('Chats/Talk.abchat'))
    expect(ws.activated).toEqual([])
  })

  it('matches the extension whatever its case', async () => {
    const leaf = new FakeLeaf('markdown')
    await leaf.openFile(file('Chats/Talk.ABCHAT'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(leaf.opened).toEqual([])
  })

  it('opens everything else into the leaf as before', async () => {
    const leaf = new FakeLeaf('empty')
    const note = file('Note.md')
    await leaf.openFile(note)
    expect(open).not.toHaveBeenCalled()
    expect(leaf.opened).toEqual([note])
    expect(leaf.detached).toBe(false)
  })

  it('is undone when the plugin unloads', async () => {
    undo()
    expect(FakeLeaf.prototype.openFile).toBe(originalOpenFile)
    const leaf = new FakeLeaf('markdown')
    await leaf.openFile(file('Chats/Talk.abchat'))
    expect(open).not.toHaveBeenCalled()
  })

  it('passes through once unloaded even when something patched on top of it', async () => {
    const ours = FakeLeaf.prototype.openFile
    const theirs = async function (this: FakeLeaf, f: TFile) {
      return ours.call(this, f)
    }
    FakeLeaf.prototype.openFile = theirs
    undo()
    expect(FakeLeaf.prototype.openFile).toBe(theirs)
    const leaf = new FakeLeaf('markdown')
    await leaf.openFile(file('Chats/Talk.abchat'))
    expect(open).not.toHaveBeenCalled()
    expect(leaf.opened).toHaveLength(1)
    FakeLeaf.prototype.openFile = originalOpenFile
  })
})
