import { expect, it, vi } from 'vitest'
import { type App, TFolder } from 'obsidian'
import { newCanvas } from '@/canvas/editorControls'
import { promptDialog } from '@/components/obsidian/dialogs'
import { ObsidianCanvasStore } from '@/canvas/obsidianStore'
import { newDeck } from '@/slides/newDeck'

vi.mock('@/components/obsidian/dialogs', () => ({ promptDialog: vi.fn(), choiceDialog: vi.fn() }))
vi.mock('@/canvas/obsidianStore', () => ({
  canvasPath: (path: string) => path,
  ObsidianCanvasStore: class {
    async create() {}
  },
}))
vi.mock('@/canvas/opening', () => ({ openCanvas: vi.fn() }))

it.each(['root', 'folder', 'current'])(
  'uses the %s new-note location with an active daily note',
  async (mode) => {
    let source = 'Journal/sample-day.md'
    const parent = Object.assign(new TFolder(), {
      path: mode === 'folder' ? 'Inbox' : mode === 'current' ? 'Journal' : '/',
    })
    const getNewFileParent = vi.fn(() => parent)
    const create = vi.spyOn(ObsidianCanvasStore.prototype, 'create')
    const createMarkdown = vi.fn(async (path: string) => ({ path }))
    const leaf = { setViewState: vi.fn(async () => {}) }
    const app = {
      workspace: {
        getActiveFile: () => ({ path: source }),
        getLeaf: () => leaf,
        revealLeaf: vi.fn(),
      },
      fileManager: { getNewFileParent },
      vault: { getAbstractFileByPath: () => null, create: createMarkdown },
    } as unknown as App
    vi.mocked(promptDialog).mockImplementationOnce(async () => {
      source = 'Elsewhere/sample-note.md'
      return 'sample.canvas'
    })
    await newCanvas(app)
    expect(getNewFileParent).toHaveBeenCalledWith('Journal/sample-day.md', 'Untitled.md')
    expect(create).toHaveBeenCalledWith(
      parent.path === '/' ? 'sample.canvas' : `${parent.path}/sample.canvas`,
      { nodes: [], edges: [] }
    )
    source = 'Journal/sample-day.md'
    vi.mocked(promptDialog).mockImplementationOnce(async () => {
      source = 'Elsewhere/sample-note.md'
      return 'sample.md'
    })
    await newDeck(app)
    expect(getNewFileParent).toHaveBeenLastCalledWith('Journal/sample-day.md', 'Untitled.md')
    const path = parent.path === '/' ? 'sample.md' : `${parent.path}/sample.md`
    expect(createMarkdown).toHaveBeenCalledWith(path, expect.stringContaining('type: presentation'))
    expect(leaf.setViewState).toHaveBeenCalledWith({
      type: 'abele-deck',
      state: { file: path },
      active: true,
    })
    create.mockRestore()
  }
)

it('keeps an explicit folder-menu destination instead of the default', async () => {
  const folder = Object.assign(new TFolder(), { path: 'Selected' })
  const getNewFileParent = vi.fn()
  const create = vi.spyOn(ObsidianCanvasStore.prototype, 'create')
  const createMarkdown = vi.fn(async (path: string) => ({ path }))
  const app = {
    workspace: { getLeaf: () => ({ setViewState: vi.fn() }), revealLeaf: vi.fn() },
    fileManager: { getNewFileParent },
    vault: { getAbstractFileByPath: () => null, create: createMarkdown },
  } as unknown as App
  vi.mocked(promptDialog).mockResolvedValueOnce('sample.canvas').mockResolvedValueOnce('sample.md')
  await newCanvas(app, folder)
  await newDeck(app, folder)
  expect(getNewFileParent).not.toHaveBeenCalled()
  expect(create).toHaveBeenCalledWith('Selected/sample.canvas', expect.anything())
  expect(createMarkdown).toHaveBeenCalledWith('Selected/sample.md', expect.anything())
  create.mockRestore()
})
