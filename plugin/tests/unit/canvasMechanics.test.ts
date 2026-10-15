import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasEditor } from '@/canvas/Editor'
import { CanvasViewer } from '@/canvas/Viewer'
import { CanvasDocument } from '@/canvas/documentRegistry'
import { emptyCanvas, parentsOf, type CanvasGraph } from '@/canvas/core/model'
import { clipOf, copyOps, parseClip } from '@/canvas/core/copy'
import { editCanvas } from '@/canvas/core/edit'
import { labelPoint, paintedRoute } from '@/canvas/core/scene'
import { canvasKey, frameAround, pastedUrl, pictureSize } from '@/canvas/editorKeys'
import { dragRect, keepRatio, objectsInBox } from '@/canvas/input'
import { snapMove } from '@/canvas/core/snap'
import { findOnCanvas } from '@/canvas/core/find'
import { TFile } from 'obsidian'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((fn) => fn()))

function setup(graph: CanvasGraph = emptyCanvas(), extra: Record<string, unknown> = {}) {
  const el = document.createElement('div')
  document.body.append(el)
  const scrollers = new Map<string, HTMLElement>()
  const viewer = new CanvasViewer(el, {
    theme: () => ({
      paper: 'white',
      card: 'white',
      text: 'black',
      border: 'gray',
      accent: 'blue',
      muted: 'gray',
      font: 'sans-serif',
      size: 16,
      lineHeight: 1.4,
      presets: [],
    }),
    assets: async () => ({}),
    cards: {
      sync: () => new Set(),
      destroy: () => {},
      scroller: (id) => scrollers.get(id) ?? null,
    },
    openNode: vi.fn(),
  })
  const file = Object.assign(new TFile(), { path: 'sample.canvas' })
  const snapshot = { graph, revision: 'initial' }
  const documentState = new CanvasDocument(
    file,
    snapshot,
    async () => snapshot,
    () => false,
    () => {}
  )
  const publish = vi.fn(async () => {
    const session = documentState.session,
      token = session.prepareDraft()
    const next = session.apply(token, session.committed)
    session.acknowledge(token, { graph: next, revision: `saved-${session.generation}` })
    documentState.clearRecovery()
    documentState.notify()
  })
  const editor = new CanvasEditor(viewer, {
    document: () => documentState,
    publish,
    history: vi.fn(async (direction) => {
      const session = documentState.session,
        token = direction === 'undo' ? session.prepareUndo() : session.prepareRedo()
      const next = session.apply(token, session.committed)
      session.acknowledge(token, { graph: next, revision: `history-${session.generation}` })
      documentState.notify()
    }),
    pickFile: async () => 'sample-note.md',
    pickLink: async () => 'https://sample.example',
    confirmDiscard: async () => true,
    handoffChoice: async () => 'retain',
    notice: vi.fn(),
    ...extra,
  } as never)
  documentState.owners.set(editor, (current) => {
    viewer.load(current.session.graph)
    editor.refresh()
  })
  documentState.notify()
  viewer.setCamera({ x: 0, y: 0, zoom: 1 })
  cleanups.push(() => {
    editor.destroy()
    viewer.destroy()
    el.remove()
  })
  const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
    viewer.stage.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: y,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        bubbles: true,
        ...extra,
      })
    )
  const key = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(event)
    return event
  }
  const graphNow = () => documentState.session.graph
  return { el, viewer, editor, document: documentState, publish, pointer, key, graphNow, scrollers }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

const cards = (): CanvasGraph => ({
  nodes: [
    { id: 'alpha', type: 'text', text: 'alpha', x: 0, y: 0, width: 200, height: 100 },
    { id: 'beta', type: 'text', text: 'beta', x: 400, y: 0, width: 200, height: 100 },
  ],
  edges: [{ id: 'link', fromNode: 'alpha', fromSide: 'right', toNode: 'beta', toSide: 'left' }],
})

describe('the Select tool with a mouse', () => {
  it('draws a box over empty space and picks what is whole inside, rather than moving the canvas', () => {
    const s = setup(cards())
    const camera = { ...s.viewer.camera }
    s.pointer('pointerdown', -20, -20)
    s.pointer('pointermove', 100, 60)
    s.pointer('pointermove', 260, 140)
    s.pointer('pointerup', 260, 140)
    expect(s.viewer.camera).toEqual(camera)
    expect(s.editor.controls.picked().ids).toEqual(['alpha'])
  })
  it('still moves the canvas with a finger on empty space', () => {
    const s = setup(cards())
    s.pointer('pointerdown', 300, 300, { pointerType: 'touch' })
    s.pointer('pointermove', 340, 330, { pointerType: 'touch' })
    s.pointer('pointerup', 340, 330, { pointerType: 'touch' })
    expect(s.viewer.camera.x).toBe(-40)
    expect(s.editor.controls.picked().ids).toEqual([])
  })
  it('moves the canvas with the middle button whatever is in hand', () => {
    const s = setup(cards())
    s.editor.controls.useTool('pen')
    s.pointer('pointerdown', 300, 300, { button: 1, buttons: 4 })
    s.pointer('pointermove', 320, 300, { buttons: 4 })
    s.pointer('pointerup', 320, 300, { button: 1 })
    expect(s.viewer.camera.x).toBe(-20)
  })
  it('moves the canvas while Space is held, and goes back to the tool when it is let go', () => {
    const s = setup(cards())
    s.key(' ')
    expect(s.editor.controls.tool()).toBe('pan')
    s.pointer('pointerdown', 50, 50)
    s.pointer('pointermove', 80, 50)
    s.pointer('pointerup', 80, 50)
    expect(s.viewer.camera.x).toBe(-30)
    expect(s.graphNow().nodes[0].x).toBe(0)
    s.el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }))
    expect(s.editor.controls.tool()).toBe('select')
  })
})

describe('connections', () => {
  it('pulling a picked connection’s end that sits on a card’s edge point moves that end', async () => {
    const graph = cards()
    graph.nodes.push({ id: 'gamma', type: 'text', text: 'gamma', x: 0, y: 300, width: 200, height: 100 })
    const s = setup(graph)
    s.pointer('pointerdown', 300, 50)
    s.pointer('pointerup', 300, 50)
    expect(s.editor.controls.picked().ids).toEqual(['link'])
    // The mouse rests on the end, over the card's left edge point, then pulls it.
    s.pointer('pointermove', 400, 50, { buttons: 0 })
    s.pointer('pointerdown', 400, 50)
    s.pointer('pointermove', 300, 200)
    s.pointer('pointermove', 100, 390)
    s.pointer('pointerup', 100, 390)
    await flush()
    expect(s.graphNow().edges).toHaveLength(1)
    expect(s.graphNow().edges[0]).toMatchObject({ fromNode: 'alpha', toNode: 'gamma', toSide: 'bottom' })
  })
})

describe('frames', () => {
  const framed = (): CanvasGraph => ({
    nodes: [
      { id: 'box', type: 'group', label: 'Box', x: -20, y: -20, width: 300, height: 200 },
      ...cards().nodes,
    ],
    edges: [],
  })
  it('a card carried out of a frame leaves it, and carried back in joins it again', async () => {
    const s = setup(framed())
    const parent = () => parentsOf(s.graphNow()).get('alpha') ?? null
    expect(parent()).toBe('box')
    s.pointer('pointerdown', 50, 50)
    s.pointer('pointermove', 50, 300)
    s.pointer('pointermove', 50, 450)
    s.pointer('pointerup', 50, 450)
    await flush()
    expect(parent()).toBeNull()
    s.pointer('pointerdown', 50, 450)
    s.pointer('pointermove', 50, 200)
    s.pointer('pointermove', 50, 50)
    s.pointer('pointerup', 50, 50)
    await flush()
    expect(parent()).toBe('box')
  })
})

describe('drawing', () => {
  it('a line held still at its end becomes a straight line; let go at once, it stays as drawn', async () => {
    vi.useFakeTimers()
    try {
      const s = setup()
      s.editor.controls.useTool('pen')
      s.pointer('pointerdown', 100, 100)
      for (let i = 1; i <= 20; i++) s.pointer('pointermove', 100 + i * 10, 100 + (i % 2))
      vi.advanceTimersByTime(600)
      s.pointer('pointerup', 300, 101)
      await vi.runAllTimersAsync()
      expect(s.graphNow().abele?.ink ?? []).toHaveLength(0)
      expect((s.graphNow().abele?.lines as unknown[]).length).toBe(1)
      s.pointer('pointerdown', 100, 300)
      for (let i = 1; i <= 20; i++) s.pointer('pointermove', 100 + i * 10, 300 + (i % 2))
      s.pointer('pointerup', 300, 301)
      await vi.runAllTimersAsync()
      expect(s.graphNow().abele?.ink as unknown[]).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a finger far zoomed out', () => {
  it('carries a small picked card by its middle rather than pulling a connection or a corner', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 0.25 })
    const touch = { pointerType: 'touch' as const }
    s.pointer('pointerdown', 25, 12, touch)
    s.pointer('pointerup', 25, 12, touch)
    s.pointer('pointerdown', 25, 12, touch)
    s.pointer('pointermove', 35, 30, touch)
    s.pointer('pointermove', 45, 52, touch)
    s.pointer('pointerup', 45, 52, touch)
    await flush()
    expect(s.graphNow().edges).toHaveLength(1)
    expect(s.graphNow().nodes[0]).toMatchObject({ x: 80, y: 160, width: 200, height: 100 })
  })
})

describe('double clicks', () => {
  it('on empty canvas puts a card there, open for writing', async () => {
    const s = setup(cards())
    for (let i = 0; i < 2; i++) {
      s.pointer('pointerdown', 300, 400)
      s.pointer('pointerup', 300, 400)
    }
    await flush()
    const added = s.graphNow().nodes.find((n) => !['alpha', 'beta'].includes(n.id))!
    expect(added).toMatchObject({ type: 'text', x: 170, y: 340 })
    expect(s.editor.controls.editing()).toBe(added.id)
  })
  it('on a connection opens its label for writing on the line, and saves what is written', async () => {
    const s = setup(cards())
    for (let i = 0; i < 2; i++) {
      s.pointer('pointerdown', 300, 50)
      s.pointer('pointerup', 300, 50)
    }
    await flush()
    expect(s.editor.controls.labelling()).toBe('link')
    await s.editor.controls.saveLabel('link', '  joins  ')
    expect(s.graphNow().edges[0].label).toBe('joins')
    expect(s.publish).toHaveBeenCalledTimes(1)
  })
  it('on a text card writes in it', async () => {
    const s = setup(cards())
    for (let i = 0; i < 2; i++) {
      s.pointer('pointerdown', 50, 50)
      s.pointer('pointerup', 50, 50)
    }
    await flush()
    expect(s.editor.controls.editing()).toBe('alpha')
  })
  it('two presses far apart are two clicks, not a double click', async () => {
    const s = setup(cards())
    s.pointer('pointerdown', 300, 400)
    s.pointer('pointerup', 300, 400)
    s.pointer('pointerdown', 340, 400)
    s.pointer('pointerup', 340, 400)
    await flush()
    expect(s.graphNow().nodes).toHaveLength(2)
  })
})

describe('writing on a card', () => {
  it('Escape finishes and saves what was written', async () => {
    const s = setup()
    s.el.querySelector<HTMLButtonElement>('[aria-label="Add text card"]')!.click()
    const field = s.el.querySelector('textarea')!
    field.value = 'written'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
    await flush()
    expect(s.editor.controls.editing()).toBeNull()
    expect(s.graphNow().nodes[0].text).toBe('written')
    expect(s.publish).toHaveBeenCalledTimes(1)
  })
})

describe('the Card and Shape tools', () => {
  it('put a card down where the canvas is clicked, the usual size, and the hand goes back to Select', () => {
    const s = setup()
    s.editor.controls.useTool('card')
    s.pointer('pointerdown', 500, 300)
    s.pointer('pointerup', 500, 300)
    expect(s.graphNow().nodes[0]).toMatchObject({ x: 370, y: 240, width: 260, height: 120 })
    expect(s.editor.controls.tool()).toBe('select')
  })
  it('draw a shape across a drag, square with Shift', () => {
    const s = setup()
    s.editor.controls.set('shape', 'circle')
    s.editor.controls.useTool('shape')
    s.pointer('pointerdown', 100, 100, { shiftKey: true })
    s.pointer('pointermove', 180, 140, { shiftKey: true })
    s.pointer('pointerup', 180, 140, { shiftKey: true })
    expect(s.graphNow().nodes[0]).toMatchObject({ x: 100, y: 100, width: 80, height: 80 })
    expect(s.graphNow().nodes[0].styleAttributes?.shape).toBe('circle')
  })
})

describe('keys', () => {
  it('take tools by their letters, stepping through a family on a second press', () => {
    expect(canvasKey(new KeyboardEvent('keydown', { key: 'v' }), 'pen')).toEqual({
      kind: 'tool',
      tool: 'select',
    })
    expect(canvasKey(new KeyboardEvent('keydown', { key: 'p' }), 'select')).toMatchObject({
      tool: 'pen',
    })
    expect(canvasKey(new KeyboardEvent('keydown', { key: 'p' }), 'pen')).toMatchObject({
      tool: 'marker',
    })
    expect(canvasKey(new KeyboardEvent('keydown', { key: 'a' }), 'arrow')).toMatchObject({
      tool: 'connect',
    })
    expect(canvasKey(new KeyboardEvent('keydown', { key: 'n' }), 'select')).toMatchObject({
      tool: 'note',
    })
    expect(canvasKey(new KeyboardEvent('keydown', { key: 'd', metaKey: true }), 'select')).toEqual({
      kind: 'duplicate',
    })
    expect(
      canvasKey(
        new KeyboardEvent('keydown', { key: '!', code: 'Digit1', shiftKey: true }),
        'select'
      )
    ).toEqual({ kind: 'fit' })
    expect(
      canvasKey(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }), 'select')
    ).toEqual({
      kind: 'nudge',
      dx: -100,
      dy: 0,
    })
  })
  it('R again steps through the shapes', () => {
    const s = setup()
    s.key('r')
    expect(s.editor.controls.tool()).toBe('shape')
    const first = s.editor.controls.value('shape')
    s.key('r')
    expect(s.editor.controls.value('shape')).not.toBe(first)
  })
  it('arrows nudge what is picked, one step to undo each', async () => {
    const s = setup(cards())
    s.pointer('pointerdown', 50, 50)
    s.pointer('pointerup', 50, 50)
    s.key('ArrowRight')
    await flush()
    s.key('ArrowDown', { shiftKey: true })
    await flush()
    expect(s.graphNow().nodes[0]).toMatchObject({ x: 10, y: 100 })
    expect(s.publish).toHaveBeenCalledTimes(2)
  })
  it('Cmd+A picks everything, cards and connections', () => {
    const s = setup(cards())
    s.key('a', { metaKey: true })
    expect(new Set(s.editor.controls.picked().ids)).toEqual(new Set(['alpha', 'beta', 'link']))
  })
})

describe('copies', () => {
  it('Alt-drag leaves the original and puts a copy where it is let go', async () => {
    const s = setup(cards())
    s.pointer('pointerdown', 50, 50)
    s.pointer('pointerup', 50, 50)
    s.pointer('pointerdown', 50, 50, { altKey: true })
    s.pointer('pointermove', 80, 250, { altKey: true })
    s.pointer('pointerup', 80, 250, { altKey: true })
    await flush()
    const nodes = s.graphNow().nodes
    expect(nodes.find((n) => n.id === 'alpha')).toMatchObject({ x: 0, y: 0 })
    expect(nodes).toHaveLength(3)
    expect(nodes[2]).toMatchObject({ type: 'text', text: 'alpha', x: 30, y: 200 })
  })
  it('copy carries frames with what they hold, the connections among them, and the ink on them', () => {
    const graph: CanvasGraph = {
      nodes: [
        { id: 'box', type: 'group', label: 'Box', x: -20, y: -20, width: 700, height: 200 },
        ...cards().nodes.map((n, i) =>
          i === 0
            ? {
                ...n,
                abele: {
                  ink: [
                    {
                      version: 1,
                      id: 'mark',
                      tool: 'pen',
                      color: '',
                      size: 2,
                      points: [1, 1, 0.5, 9, 9, 0.5],
                      frame: { width: 200, height: 100 },
                    },
                  ],
                },
              }
            : n
        ),
      ],
      edges: cards().edges,
    }
    const clip = clipOf(graph, new Set(['box']))
    expect(clip.nodes).toHaveLength(3)
    const { ops, picked } = copyOps(clip, 0, 500)
    const after = editCanvas(graph, ops).graph
    expect(after.nodes).toHaveLength(6)
    expect(after.edges).toHaveLength(2)
    expect(picked.size).toBe(1)
    const copied = after.nodes.find(
      (n) => n.id !== 'alpha' && n.type === 'text' && n.text === 'alpha'
    )!
    expect(copied.y).toBe(500)
    expect((copied.abele?.ink as unknown[]).length).toBe(1)
  })
  it('reads back what was copied, and refuses what is not a canvas', () => {
    expect(parseClip(JSON.stringify({ nodes: cards().nodes, edges: [] }))?.nodes).toHaveLength(2)
    expect(parseClip('just words')).toBeNull()
    expect(parseClip('{"nodes":[{"id":1}]}')).toBeNull()
  })
})

describe('pasting and dropping', () => {
  it('a web address becomes a link card at the pointer, other words a text card', async () => {
    const s = setup()
    s.pointer('pointermove', 400, 300, { buttons: 0 })
    const paste = (text: string) => {
      const data = new DataTransfer()
      data.setData('text/plain', text)
      s.el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
    }
    paste('https://sample.example/page')
    await flush()
    await flush()
    expect(s.graphNow().nodes[0]).toMatchObject({
      type: 'link',
      url: 'https://sample.example/page',
    })
    paste('A thought')
    await flush()
    await flush()
    expect(s.graphNow().nodes[1]).toMatchObject({ type: 'text', text: 'A thought' })
    expect(pastedUrl('see https://sample.example')).toBeNull()
  })
  it('a pasted picture is saved as an attachment and stands on the canvas as a file card', async () => {
    const saveAttachment = vi.fn(async (name: string) => `attachments/${name}`)
    const s = setup(emptyCanvas(), { saveAttachment })
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array([1, 2, 3])], 'sample-image.png', { type: 'image/png' }))
    s.el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
    await vi.waitFor(() => expect(s.graphNow().nodes).toHaveLength(1), { timeout: 4000 })
    expect(saveAttachment).toHaveBeenCalledWith('sample-image.png', expect.any(ArrayBuffer))
    expect(s.graphNow().nodes[0]).toMatchObject({
      type: 'file',
      file: 'attachments/sample-image.png',
    })
  })
  it('a picture card keeps its picture shape, no larger than 400 units', () => {
    expect(pictureSize(1600, 800)).toEqual({ width: 400, height: 200 })
    expect(pictureSize(100, 50)).toEqual({ width: 100, height: 50 })
  })
})

describe('notes on the canvas', () => {
  it('a text card turns into a note in the same place, keeping its connections', async () => {
    const createNote = vi.fn(async (name: string) => `${name}.md`)
    const s = setup(cards(), { createNote })
    s.pointer('pointerdown', 50, 50)
    s.pointer('pointerup', 50, 50)
    await s.editor.controls.act('turn-into-note')
    expect(createNote).toHaveBeenCalledWith('alpha', 'alpha')
    expect(s.graphNow().nodes[0]).toMatchObject({ id: 'alpha', type: 'file', file: 'alpha.md', x: 0 })
    expect(s.graphNow().nodes[0].text).toBeUndefined()
    expect(s.graphNow().edges[0].fromNode).toBe('alpha')
  })
  it('the wheel over a picked note scrolls its words rather than the canvas', () => {
    const graph: CanvasGraph = {
      nodes: [
        { id: 'note', type: 'file', file: 'sample-note.md', x: 0, y: 0, width: 200, height: 100 },
      ],
      edges: [],
    }
    const s = setup(graph)
    const body = document.createElement('div')
    Object.defineProperties(body, {
      scrollHeight: { value: 500 },
      clientHeight: { value: 100 },
    })
    let top = 0
    Object.defineProperty(body, 'scrollTop', {
      get: () => top,
      set: (v: number) => (top = Math.max(0, Math.min(400, v))),
    })
    s.scrollers.set('note', body)
    const wheel = () => {
      const event = new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true })
      // The test DOM leaves a wheel's position out of its init: set it as a browser does.
      Object.defineProperties(event, { clientX: { value: 50 }, clientY: { value: 50 } })
      s.viewer.stage.dispatchEvent(event)
    }
    wheel()
    expect(top).toBe(0) // Not picked: the canvas moves.
    expect(s.viewer.camera.y).toBe(60)
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    s.pointer('pointerdown', 50, 50)
    s.pointer('pointerup', 50, 50)
    wheel()
    expect(top).toBe(60)
    expect(s.viewer.camera.y).toBe(0)
  })
  it('shows one part of a note from a heading, and back to the whole note', async () => {
    const graph: CanvasGraph = {
      nodes: [
        { id: 'note', type: 'file', file: 'sample-note.md', x: 0, y: 0, width: 200, height: 100 },
      ],
      edges: [],
    }
    const s = setup(graph)
    await s.editor.controls.showPart('note', '#Second part')
    expect(s.graphNow().nodes[0].subpath).toBe('#Second part')
    await s.editor.controls.addPart('note', '#Third part')
    expect(s.graphNow().nodes[1]).toMatchObject({
      file: 'sample-note.md',
      subpath: '#Third part',
      x: 260,
    })
    await s.editor.controls.showPart('note', '')
    expect(s.graphNow().nodes[0].subpath).toBeUndefined()
  })
})

describe('lining up', () => {
  it('a carried card sticks to a neighbour’s edge within reach and shows the line', () => {
    const graph = cards()
    const r = snapMove(graph, new Set(['beta']), new Set(['beta']), 3, 104, 6)
    // Its top would land at 104, four units under alpha's foot: it sticks to the foot.
    expect(r.dy).toBe(100)
    expect(r.guides.some((g) => g.axis === 'y' && g.at === 100)).toBe(true)
    expect(r.dx).toBe(3)
  })
  it('out of reach, the card goes where the pointer takes it', () => {
    const r = snapMove(cards(), new Set(['beta']), new Set(['beta']), 0, 130, 6)
    expect(r).toMatchObject({ dx: 0, dy: 130, guides: [] })
  })
  it('a corner pulled with Shift keeps the card’s shape', () => {
    const node = { x: 0, y: 0, width: 200, height: 100 }
    expect(keepRatio(node, 'se', { x: 0, y: 0, width: 300, height: 110 })).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 150,
    })
    expect(keepRatio(node, 'nw', { x: -10, y: -90, width: 210, height: 190 })).toEqual({
      x: -180,
      y: -90,
      width: 380,
      height: 190,
    })
  })
})

describe('finding on the canvas', () => {
  it('finds words in cards, labels, frame names, note names and what notes say, in reading order', () => {
    const graph: CanvasGraph = {
      nodes: [
        { id: 'frame', type: 'group', label: 'Seed tray', x: 0, y: 0, width: 900, height: 600 },
        { id: 'low', type: 'text', text: 'sow seeds', x: 50, y: 400, width: 200, height: 100 },
        { id: 'note', type: 'file', file: 'Plans/Seed list.md', x: 300, y: 100, width: 200, height: 100 },
        { id: 'quiet', type: 'file', file: 'Plans/Other.md', x: 600, y: 100, width: 200, height: 100 },
      ],
      edges: [{ id: 'e', fromNode: 'low', toNode: 'note', label: 'no match here' }],
    }
    const found = findOnCanvas(graph, 'SEED', (id) => (id === 'quiet' ? 'a seed inside' : undefined))
    expect(found.map((f) => f.id)).toEqual(['frame', 'note', 'quiet', 'low'])
    expect(findOnCanvas(graph, '  ')).toEqual([])
    expect(findOnCanvas(graph, 'match').map((f) => f.id)).toEqual(['e'])
  })
})

describe('geometry helpers', () => {
  it('a selection box with Alt picks what it touches; without, what is whole inside, lines too', () => {
    const graph: CanvasGraph = {
      ...cards(),
      abele: {
        lines: [{ version: 1, id: 'free', from: { x: 10, y: 300 }, to: { x: 90, y: 320 } }],
      },
    }
    const box = { x: -10, y: -10, width: 120, height: 400 }
    expect(objectsInBox(graph, box, false)).toEqual(['free'])
    expect(objectsInBox(graph, box, true)).toEqual(['alpha', 'free'])
  })
  it('a drag from right to left still gives a rectangle', () => {
    expect(dragRect([100, 100], [40, 70], false)).toEqual({ x: 40, y: 70, width: 60, height: 30 })
    expect(dragRect([100, 100], [40, 70], true)).toEqual({ x: 40, y: 40, width: 60, height: 60 })
  })
  it('a curved connection’s label stands on the curve itself', () => {
    const graph: CanvasGraph = {
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 100 },
        { id: 'b', type: 'text', x: 300, y: 300, width: 100, height: 100 },
      ],
      edges: [{ id: 'e', fromNode: 'a', fromSide: 'bottom', toNode: 'b', toSide: 'top' }],
    }
    const route = paintedRoute(graph.edges[0], graph)
    expect(route.kind).toBe('cubic')
    const [p0, p1, p2, p3] = route.points
    const at = (k: 'x' | 'y') => (p0[k] + 3 * p1[k] + 3 * p2[k] + p3[k]) / 8
    expect(labelPoint(route)).toEqual({ x: at('x'), y: at('y') })
  })
  it('something put down inside a frame is in that frame, the smallest one', () => {
    const graph: CanvasGraph = {
      nodes: [
        { id: 'outer', type: 'group', x: 0, y: 0, width: 1000, height: 1000 },
        { id: 'inner', type: 'group', x: 100, y: 100, width: 400, height: 400 },
      ],
      edges: [],
    }
    expect(frameAround(graph, { x: 120, y: 120, width: 100, height: 100 })).toBe('inner')
    expect(frameAround(graph, { x: 600, y: 600, width: 100, height: 100 })).toBe('outer')
    expect(frameAround(graph, { x: 2000, y: 0, width: 10, height: 10 })).toBeNull()
  })
})
