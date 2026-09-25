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
  constructor(public viewType: string) {}
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

let open: ReturnType<typeof vi.fn>
let undo: () => void
const originalOpenFile = FakeLeaf.prototype.openFile

beforeEach(() => {
  open = vi.fn(async () => {})
  undo = keepChatFilesOutOfLeaves(open, FakeLeaf.prototype as never)
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
