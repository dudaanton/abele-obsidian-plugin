/**
 * What the canvas's "more" menus do outside the canvas (`canvas/pickedActions.ts`): a picture of
 * the picked part, its embed, the chat, a card's words as a note, a note to the trash.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { PendingInput } from '@/ai/ChatService'
import * as pictures from '@/canvas/pictureAdapter'
import { canvasHostActions, canvasQuestion, noteName, partRegion } from '@/canvas/pickedActions'
import type { CanvasGraph } from '@/canvas/core/model'
import { useVault } from '../helpers/testEnv'

const graph: CanvasGraph = {
  nodes: [{ id: 'alpha', type: 'text', text: 'Alpha', x: 0, y: 0, width: 240, height: 120 }],
  edges: [],
}

function fakeChats() {
  const added: string[] = []
  const scope = {
    added,
    isInScope: (p: string) => added.includes(p),
    addFile: (p: string) => added.push(p),
  }
  return {
    scope,
    pendingInput: ref<PendingInput | null>(null),
    revealSidebar: vi.fn(async () => {}),
    openBlankChat: vi.fn(async () => ({ id: 'chat-1', scopeResolver: scope })),
  }
}

describe('the picked part', () => {
  it('keeps room round its edges and lands on whole units', () => {
    expect(partRegion({ x: 10.5, y: -4, width: 100, height: 50.2 })).toEqual({
      x: -14,
      y: -28,
      width: 148,
      height: 99,
    })
  })
  it('is named in the question with its place and what was picked', () => {
    expect(
      canvasQuestion(
        '[[Plans/sample.canvas]]',
        { x: 0, y: 10, width: 300, height: 200 },
        ['a', 'b'],
        'ask'
      )
    ).toBe('Look at the part of [[Plans/sample.canvas]] at region 0 10 300 200 (picked: a, b): ')
    expect(canvasQuestion('[[Plans/sample.canvas]]', null, [], 'transcribe')).toBe(
      'Transcribe the handwriting in [[Plans/sample.canvas]] as text, keeping its lines and lists.'
    )
  })
  it('names a note by the first line of the card, without what file names forbid', () => {
    expect(noteName('# Weekly: plan/review?\nmore words')).toBe('Weekly plan review')
    expect(noteName('\n\n   ')).toBe('Untitled')
  })
})

describe('canvas host actions', () => {
  let app: ReturnType<typeof useVault>
  let chats: ReturnType<typeof fakeChats>
  const canvas = () => app.vault.getAbstractFileByPath('Plans/sample.canvas') as never
  const actions = (confirm = vi.fn(async () => true)) =>
    canvasHostActions(
      app as never,
      canvas,
      () => graph,
      async () => null,
      () => chats as never,
      confirm
    )

  beforeEach(() => {
    app = useVault([
      { path: 'Plans/sample.canvas', content: JSON.stringify(graph) },
      { path: 'Plans/Sample note.md', content: 'Sample' },
    ])
    chats = fakeChats()
    Object.assign(app.fileManager, {
      getAvailablePathForAttachment: async (name: string) => `Attachments/${name}`,
      getNewFileParent: () => ({ path: 'Inbox' }),
    })
    const surface = document.createElement('canvas')
    vi.spyOn(surface, 'toBlob').mockImplementation((done) =>
      done(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
    )
    vi.spyOn(pictures, 'canvasPicture').mockResolvedValue({
      canvas: surface,
      region: { x: 0, y: 0, width: 1, height: 1 },
      warnings: [],
      visible: [],
      say: undefined,
    } as never)
  })

  it('saves a picture of the part with the attachments', async () => {
    const made = await actions().exportPart({ x: -24, y: -24, width: 288, height: 168 }, 'frame')
    expect(made?.path).toBe('Attachments/sample frame.png')
    expect(pictures.canvasPicture).toHaveBeenCalledWith(
      app,
      graph,
      'Plans/sample.canvas',
      { region: { x: -24, y: -24, width: 288, height: 168 }, maxSide: 2048 },
      expect.any(Function)
    )
  })

  it('copies the embed of a frame by its id, and of a part by its place', async () => {
    const write = vi.fn(async () => {})
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText: write } as never)
    await actions().copyEmbed({ node: 'alpha' })
    await actions().copyEmbed({ region: { x: 0, y: 0, width: 300, height: 200 } })
    expect(write.mock.calls).toEqual([
      ['![[Plans/sample.canvas#node=alpha]]'],
      ['![[Plans/sample.canvas#part=0,0,300,200]]'],
    ])
  })

  it('attaches the part to the chat in front as a picture', async () => {
    const made = await actions().attach({ x: 0, y: 0, width: 300, height: 200 })
    expect(made?.path).toBe('Attachments/sample (part).png')
    expect(chats.pendingInput.value).toMatchObject({
      attachments: ['Attachments/sample (part).png'],
    })
  })

  it('opens a chat that may see the canvas, with the question begun and nothing sent', async () => {
    expect(await actions().ask(null, ['alpha'], 'transcribe')).toBe(true)
    expect(chats.openBlankChat).toHaveBeenCalledOnce()
    expect(chats.scope.added).toEqual(['Plans/sample.canvas'])
    expect(chats.pendingInput.value).toEqual({
      text: 'Transcribe the handwriting in [[Plans/sample.canvas]] as text, keeping its lines and lists.',
      tabId: 'chat-1',
      focus: true,
    })
  })

  it("makes a note of a card's words where new notes go, under a free name", async () => {
    await app.vault.create('Inbox/Shopping list.md', 'taken')
    expect(await actions().makeNote('Shopping list\n- milk')).toBe('Inbox/Shopping list 2.md')
    expect(await app.vault.read(app.vault.getFileByPath('Inbox/Shopping list 2.md')!)).toBe(
      'Shopping list\n- milk\n'
    )
  })

  it('takes a note to the trash only once asked and agreed', async () => {
    const no = vi.fn(async () => false)
    expect(await actions(no).trashNote('Plans/Sample note.md')).toBe(false)
    expect(app.vault.getFileByPath('Plans/Sample note.md')).not.toBeNull()
    expect(await actions().trashNote('Plans/Sample note.md')).toBe(true)
    expect(app.vault.getFileByPath('Plans/Sample note.md')).toBeNull()
  })
})
