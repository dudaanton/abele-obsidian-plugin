/**
 * The picked things' "more" menu does what it says: the agent, pictures and embeds of the picked
 * part go to the host, a card's words become a note in its place, and a note goes to the trash
 * only once it is asked about.
 */
import { describe, expect, it, vi } from 'vitest'
import { moreEntries, type PickedView } from '@/components/canvas/chromeMenus'
import type { CanvasHostActions } from '@/canvas/pickedActions'
import type { CanvasEditor } from '@/canvas/Editor'

type Controls = CanvasEditor['controls']
function controls() {
  return {
    press: vi.fn(),
    state: vi.fn(() => ({ disabled: false, hidden: false, on: false })),
    act: vi.fn(async () => {}),
    editLabel: vi.fn(),
    replaceWithNote: vi.fn(async () => {}),
  } as unknown as Controls & {
    press: ReturnType<typeof vi.fn>
    editLabel: ReturnType<typeof vi.fn>
    replaceWithNote: ReturnType<typeof vi.fn>
  }
}
function host(): CanvasHostActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    exportPart: vi.fn(async () => null),
    copyEmbed: vi.fn(async () => true),
    attach: vi.fn(async () => null),
    ask: vi.fn(async () => true),
    makeNote: vi.fn(async () => 'Sample idea.md'),
    trashNote: vi.fn(async () => true),
    askText: vi.fn(async () => null),
  }
}
const rect = { x: 100, y: 50, width: 200, height: 100 }
const picked = (kind: string, node: Record<string, unknown> = {}): PickedView => ({
  ids: ['one'],
  kinds: [kind],
  one: true,
  kind,
  node: { id: 'one', type: 'text', x: 100, y: 50, width: 200, height: 100, ...node } as never,
  shape: 'rectangle',
  colour: '',
  rect,
})
async function run(entries: ReturnType<typeof moreEntries>, title: string) {
  const entry = entries.find((e) => e !== '-' && e.title === title)
  expect(entry, title).toBeTruthy()
  await (entry as { run: () => unknown }).run()
}
const region = { x: 76, y: 26, width: 248, height: 148 }

describe("the picked things' more menu", () => {
  it('sends the picked part to the chat as a picture or a question', async () => {
    const c = controls(),
      h = host()
    const entries = moreEntries(c, picked('text', { text: 'Idea' }), h)
    await run(entries, 'Attach to the chat as a picture')
    expect(h.attach).toHaveBeenCalledWith(region)
    await run(entries, 'Ask the agent about this')
    expect(h.ask).toHaveBeenCalledWith(region, ['one'], 'ask')
  })
  it('saves a picture of the selection and copies its embed', async () => {
    const c = controls(),
      h = host()
    const entries = moreEntries(c, picked('shape'), h)
    await run(entries, 'Export the selection…')
    expect(h.exportPart).toHaveBeenCalledWith(region, 'selection')
    await run(entries, 'Copy embed of the selection')
    expect(h.copyEmbed).toHaveBeenCalledWith({ region })
  })
  it("turns a card's words into a note standing where the card stood", async () => {
    const c = controls(),
      h = host()
    await run(moreEntries(c, picked('text', { text: '# Idea\nmore' }), h), 'Turn into a note')
    expect(h.makeNote).toHaveBeenCalledWith('# Idea\nmore')
    expect(c.replaceWithNote).toHaveBeenCalledWith('one', 'Sample idea.md')
  })
  it('takes a note to the trash and off the canvas only once it is confirmed', async () => {
    const c = controls(),
      h = host()
    const entries = moreEntries(c, picked('file', { type: 'file', file: 'Sample.md' }), h)
    h.trashNote.mockResolvedValueOnce(false)
    await run(entries, 'Delete the note…')
    expect(c.press).not.toHaveBeenCalled()
    await run(entries, 'Delete the note…')
    expect(h.trashNote).toHaveBeenLastCalledWith('Sample.md')
    expect(c.press).toHaveBeenCalledWith('Delete selected card')
  })
  it('exports a frame and copies an embed of it by its id', async () => {
    const c = controls(),
      h = host()
    const entries = moreEntries(c, picked('group', { type: 'group', label: 'Bed' }), h)
    await run(entries, 'Export frame…')
    expect(h.exportPart).toHaveBeenCalledWith(region, 'Bed')
    await run(entries, 'Copy embed of this frame')
    expect(h.copyEmbed).toHaveBeenCalledWith({ node: 'one' })
  })
  it('asks the agent to read handwriting', async () => {
    const c = controls(),
      h = host()
    await run(moreEntries(c, picked('stroke'), h), 'Read the handwriting')
    expect(h.ask).toHaveBeenCalledWith(region, ['one'], 'transcribe')
  })
  it("opens a connection's label where it stands", async () => {
    const c = controls()
    await run(moreEntries(c, picked('connection'), host()), 'Edit label')
    expect(c.editLabel).toHaveBeenCalledWith('one')
  })
})

describe('finding things on the canvas', () => {
  it('names cards by their first words, notes by their path and frames by their name', async () => {
    const { canvasPlaces, canvasContents } = await import('@/canvas/canvasFind')
    const graph = {
      nodes: [
        { id: 'f', type: 'group' as const, label: 'Kitchen', x: 0, y: 0, width: 400, height: 300 },
        { id: 't', type: 'text' as const, text: '## Sample plan\nmore', x: 10, y: 10, width: 100, height: 60 },
        { id: 'n', type: 'file' as const, file: 'Sample.md', subpath: '#Part', x: 0, y: 400, width: 100, height: 60 },
      ],
      edges: [],
    }
    expect(canvasPlaces(graph).map((p) => p.title)).toEqual(['Kitchen', 'Sample plan', 'Sample.md#Part'])
    expect(canvasContents(graph).map((p) => p.title)).toEqual(['Frame: Kitchen'])
  })
  it('puts the tab\'s own items first, with drawing by finger only on a tablet', async () => {
    const { paneEntries } = await import('@/components/canvas/chromeMenus')
    const handlers = {
      find: vi.fn(),
      contents: vi.fn(),
      exportCanvas: vi.fn(),
      copyEmbed: vi.fn(),
      openNative: vi.fn(),
      fingerDraws: { on: true, toggle: vi.fn() },
    }
    expect(paneEntries(handlers, false).map((e) => e.title)).toEqual([
      'Find on the canvas',
      'Show contents',
      'Export…',
      'Copy embed of what is shown',
      'Open in Obsidian Canvas',
    ])
    expect(paneEntries(handlers, true).at(-1)).toMatchObject({
      title: 'Draw with a finger',
      checked: true,
    })
  })
})
