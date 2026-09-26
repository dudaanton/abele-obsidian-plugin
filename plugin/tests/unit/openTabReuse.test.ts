/**
 * A link followed to a book or a note that is already open in a tab goes to that tab
 * (`src/helpers/openLeaves.ts`, `src/reader/bookTabReuse.ts`): brought forward and moved to the
 * place, instead of the file opening a second time. Mod-click still asks for a new tab.
 */
import { describe, it, expect, vi } from 'vitest'
import { TFile, type App, type WorkspaceLeaf } from 'obsidian'
import { leavesShowing, openNoteInTab } from '@/helpers/openLeaves'
import { followIntoOpenBook, reuseBookTabs } from '@/reader/bookTabReuse'

interface FakeLeaf {
  type: string
  file?: string
  activeTime?: number
  view: unknown
  getViewState(): { type: string; state?: Record<string, unknown> }
  setEphemeralState: ReturnType<typeof vi.fn>
  openFile: ReturnType<typeof vi.fn>
}

function leaf(type: string, file?: string, activeTime = 0): FakeLeaf {
  return {
    type,
    file,
    activeTime,
    // A tab not yet loaded since the app started names its file in its state only.
    view: { getViewType: () => 'deferred' },
    getViewState: () => ({ type, state: file ? { file } : {} }),
    setEphemeralState: vi.fn(),
    openFile: vi.fn(async () => {}),
  }
}

function fileAt(path: string): TFile {
  const f = new TFile()
  f.path = path
  f.extension = path.split('.').pop() ?? ''
  return f
}

function appWith(leaves: FakeLeaf[], files: string[] = []) {
  const byPath = new Map(files.map((p) => [p, fileAt(p)]))
  const fresh = leaf('empty')
  const calls: string[] = []
  const openLinkText = vi.fn(async () => {
    calls.push('original')
  })
  const app = {
    workspace: {
      iterateAllLeaves: (fn: (l: FakeLeaf) => void) => leaves.forEach(fn),
      revealLeaf: vi.fn(async (l: FakeLeaf) => {
        calls.push(`reveal:${l.file}`)
      }),
      setActiveLeaf: vi.fn((l: FakeLeaf) => {
        calls.push(`active:${l.file}`)
      }),
      getLeaf: vi.fn(() => fresh),
      openLinkText,
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath: string) =>
        byPath.get(linkpath) ?? [...byPath.values()].find((f) => f.name === linkpath) ?? null,
    },
    vault: { getFileByPath: (p: string) => byPath.get(p) ?? null },
  }
  for (const f of byPath.values()) f.name = f.path.split('/').pop() ?? f.path
  return { app: app as unknown as App, ws: app.workspace, fresh, calls, openLinkText }
}

const BOOK = 'Books/Dune.epub'
const PLACE = '#cfi=epubcfi(/6/8!/4/2,/1:0,/1:22)'

describe('the tabs already showing a file', () => {
  it('are found in every window and sidebar, the one used last first, deferred ones too', () => {
    const older = leaf('abele-book', BOOK, 10)
    const newer = leaf('abele-book', BOOK, 30)
    const other = leaf('abele-book', 'Other.epub', 50)
    const note = leaf('markdown', BOOK, 60)
    const { app } = appWith([older, other, newer, note])
    expect(leavesShowing(app, BOOK, 'abele-book')).toEqual([newer, older])
  })
})

describe('a link into a book already open', () => {
  it('goes to the place in that tab, brought forward, rather than opening the book again', async () => {
    const book = leaf('abele-book', BOOK, 5)
    const { app, calls } = appWith([leaf('markdown', 'Notes/Dune highlights.md', 9), book], [BOOK])
    const followed = await followIntoOpenBook(app, `Dune.epub${PLACE}`, 'Notes/x.md')
    expect(followed).toBe(true)
    expect(calls).toEqual([`reveal:${BOOK}`, `active:${BOOK}`])
    expect(book.setEphemeralState).toHaveBeenCalledWith({ subpath: PLACE })
  })

  it('takes a path written with escapes, the way a markdown link carries it', async () => {
    const book = leaf('abele-book', 'Books/Dune Messiah.epub')
    const { app } = appWith([book], ['Books/Dune Messiah.epub'])
    expect(await followIntoOpenBook(app, `Dune%20Messiah.epub${PLACE}`, '')).toBe(true)
    expect(book.setEphemeralState).toHaveBeenCalledWith({ subpath: PLACE })
  })

  it('leaves the link alone when the book is not open, or it is not a book', async () => {
    const { app, calls } = appWith([leaf('markdown', 'Note.md')], [BOOK, 'Note.md'])
    expect(await followIntoOpenBook(app, `Dune.epub${PLACE}`, '')).toBe(false)
    expect(await followIntoOpenBook(app, 'Note.md', '')).toBe(false)
    expect(calls).toEqual([])
  })

  it('is taken from every link Obsidian follows with a plain click, and not from a Mod-click', async () => {
    const book = leaf('abele-book', BOOK)
    const { app, ws, calls } = appWith([book], [BOOK])
    const undo = reuseBookTabs(app)

    await ws.openLinkText(`Dune.epub${PLACE}`, '', false)
    expect(calls).toEqual([`reveal:${BOOK}`, `active:${BOOK}`])

    calls.length = 0
    await ws.openLinkText(`Dune.epub${PLACE}`, '', 'tab')
    await ws.openLinkText(`Dune.epub${PLACE}`, '', true)
    expect(calls).toEqual(['original', 'original'])

    calls.length = 0
    undo()
    await ws.openLinkText(`Dune.epub${PLACE}`, '', false)
    expect(calls).toEqual(['original'])
  })

  it('passes through once undone even when something else wrapped it meanwhile', async () => {
    const book = leaf('abele-book', BOOK)
    const { app, ws, calls } = appWith([book], [BOOK])
    const undo = reuseBookTabs(app)
    const ours = ws.openLinkText
    ws.openLinkText = (...args: Parameters<typeof ours>) => ours(...args)
    undo()
    await ws.openLinkText(`Dune.epub${PLACE}`, '', false)
    expect(calls).toEqual(['original'])
  })
})

describe('a note opened from a book', () => {
  it('goes to the tab already showing it, the one used last', async () => {
    const older = leaf('markdown', 'Notes/Dune.md', 1)
    const newer = leaf('markdown', 'Notes/Dune.md', 7)
    const { app, ws, calls } = appWith([older, newer], ['Notes/Dune.md'])
    const at = await openNoteInTab(app, fileAt('Notes/Dune.md'))
    expect(at).toBe(newer as unknown as WorkspaceLeaf)
    expect(ws.getLeaf).not.toHaveBeenCalled()
    expect(calls).toEqual(['reveal:Notes/Dune.md', 'active:Notes/Dune.md'])
  })

  it('opens a new tab when the note is not open, and whenever Mod-click asks for one', async () => {
    const open = leaf('markdown', 'Notes/Dune.md')
    const { app, ws, fresh } = appWith([open], ['Notes/Dune.md'])
    const note = fileAt('Notes/Dune.md')
    expect(await openNoteInTab(app, note, 'split')).toBe(fresh as unknown as WorkspaceLeaf)
    expect(ws.getLeaf).toHaveBeenLastCalledWith('split')
    expect(fresh.openFile).toHaveBeenCalledWith(note, { active: true })

    expect(await openNoteInTab(app, fileAt('Notes/Other.md'))).toBe(
      fresh as unknown as WorkspaceLeaf
    )
    expect(ws.getLeaf).toHaveBeenLastCalledWith('tab')
  })
})
