/**
 * The small mechanics of the canvas by mouse, finger and keyboard: a double press opens what was
 * pressed for writing, a drag over empty canvas with Select draws a box, keys take up tools, and
 * the bar over a connection stands by the connection rather than by its cards.
 */
import { describe, expect, it, vi } from 'vitest'
import type { CanvasGraph } from '@/canvas/core/model'
import { cards, pointer, setup } from '../helpers/canvasEditorHarness'

const mouse = { pointerType: 'mouse' }
type Harness = ReturnType<typeof setup>
function tap(s: Harness, x: number, y: number, extra: Record<string, unknown> = mouse) {
  pointer(s, 'pointerdown', x, y, { ...extra, buttons: 1 })
  pointer(s, 'pointerup', x, y, extra)
}
function key(s: Harness, k: string, type = 'keydown', extra = {}) {
  s.el.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, ...extra }))
}
const framed = (): CanvasGraph => ({
  nodes: [
    { id: 'bed', type: 'group', label: 'Bed', x: -20, y: -40, width: 600, height: 240 },
    ...cards().nodes,
  ],
  edges: cards().edges,
})

describe('a double press', () => {
  it('opens a card for its words', () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    tap(s, 100, 80)
    tap(s, 100, 80)
    expect(s.editor.controls.editing()).toBe('alpha')
  })
  it('opens a connection for its label, saved as one step', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    // The connection runs from alpha's right edge to beta's left one, at mid height.
    tap(s, 280, 80)
    tap(s, 280, 80)
    expect(s.editor.controls.labeling()).toBe('connection')
    await s.editor.controls.saveLabel('connection', 'feeds')
    expect(s.document.session.graph.edges[0].label).toBe('feeds')
    expect(s.document.session.history.undo).toBe(1)
    expect(s.editor.controls.labeling()).toBeNull()
  })
  it('leaves an unchanged label without a step', async () => {
    const s = setup(cards())
    s.editor.controls.editLabel('connection')
    await s.editor.controls.saveLabel('connection', '')
    expect(s.publish).not.toHaveBeenCalled()
    expect(s.editor.controls.labeling()).toBeNull()
  })
  it('makes a card on empty canvas, where it was pressed, open for its words', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    tap(s, 400, 500)
    tap(s, 400, 500)
    const made = s.document.session.graph.nodes.find((n) => n.id === s.editor.controls.editing())
    expect(made).toMatchObject({ type: 'text' })
    expect(made!.x + made!.width / 2).toBe(400)
    expect(made!.y + made!.height / 2).toBe(500)
  })
  it('names a frame', () => {
    const s = setup(framed())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    // Empty room inside the frame, under its cards.
    tap(s, 300, 185)
    tap(s, 300, 185)
    expect(s.editor.controls.naming()).toBe('bed')
  })
  it('is two presses close in time and place, not a press and a drag', () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    tap(s, 100, 80)
    pointer(s, 'pointerdown', 160, 80, { ...mouse, buttons: 1 })
    pointer(s, 'pointerup', 160, 80, mouse)
    expect(s.editor.controls.editing()).toBeNull()
  })
})

describe('Select', () => {
  it('picks a shape with a click', () => {
    const graph = cards()
    graph.nodes[1].styleAttributes = { shape: 'diamond' }
    const s = setup(graph)
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    tap(s, 430, 80)
    expect(s.editor.controls.picked().ids).toEqual(['beta'])
  })
  it('draws a box over empty canvas with the mouse instead of moving the canvas', () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: -100, zoom: 1 })
    pointer(s, 'pointerdown', -20, 40, { ...mouse, buttons: 1 })
    pointer(s, 'pointermove', 300, 300, { ...mouse, buttons: 1 })
    pointer(s, 'pointerup', 580, 300, mouse)
    expect(s.viewer.camera).toMatchObject({ x: 0, y: -100 })
    expect(new Set(s.editor.controls.picked().ids)).toEqual(new Set(['alpha', 'beta']))
  })
  it('still moves the canvas with a finger on empty canvas', () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: -100, zoom: 1 })
    pointer(s, 'pointerdown', 100, 400, { buttons: 1 })
    pointer(s, 'pointermove', 160, 400, { buttons: 1 })
    pointer(s, 'pointerup', 160, 400)
    expect(s.viewer.camera.x).toBe(-60)
  })
})

describe('keys', () => {
  it('take up the tools their tooltips name', () => {
    const s = setup(cards())
    for (const [k, tool] of [
      ['h', 'pan'],
      ['p', 'pen'],
      ['e', 'eraser'],
      ['l', 'lasso'],
      ['f', 'frame'],
      ['a', 'connect'],
      ['v', 'select'],
    ]) {
      key(s, k)
      expect(s.editor.controls.tool(), k).toBe(tool)
    }
    // Pressed again, P and E take the other member of their family.
    key(s, 'p')
    key(s, 'p')
    expect(s.editor.controls.tool()).toBe('marker')
    key(s, 'e')
    key(s, 'e')
    expect(s.editor.controls.tool()).toBe('partial-eraser')
  })
  it('make a card with T, and leave letters alone while words are written', () => {
    const s = setup(cards())
    key(s, 't')
    const id = s.editor.controls.editing()
    expect(id).not.toBeNull()
    s.editor.controls
      .textField()
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }))
    expect(s.editor.controls.tool()).toBe('select')
  })
  it('move the canvas while Space is held, and give the tool back after', () => {
    const s = setup(cards())
    key(s, 'p')
    key(s, ' ')
    expect(s.editor.controls.tool()).toBe('pan')
    key(s, ' ', 'keyup')
    expect(s.editor.controls.tool()).toBe('pen')
  })
})

describe('the bar over a connection', () => {
  it('stands over the connection, not over the cards it joins', () => {
    const graph = cards()
    graph.nodes[1] = { ...graph.nodes[1], y: 600 }
    const s = setup(graph)
    ;(s.editor as unknown as { selected: Set<string> }).selected = new Set(['connection'])
    const rect = s.editor.controls.picked().rect!
    // Not from alpha's top to beta's foot: only where the line runs between them.
    expect(rect.y).toBeGreaterThan(100)
    expect(rect.y + rect.height).toBeLessThan(700)
  })
})

vi.setConfig({ testTimeout: 10_000 })

describe('a card turned into a note', () => {
  it('stands where the card stood, as one step to take back', async () => {
    const s = setup(cards())
    await s.editor.controls.replaceWithNote('alpha', 'Sample idea.md')
    expect(s.document.session.graph.nodes[0]).toMatchObject({
      id: 'alpha',
      type: 'file',
      file: 'Sample idea.md',
      x: 0,
      width: 260,
    })
    expect(s.document.session.graph.nodes[0].text).toBeUndefined()
    expect(s.document.session.history.undo).toBe(1)
  })
})

describe('a card being written', () => {
  it('is saved and left with Esc', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    tap(s, 100, 80)
    tap(s, 100, 80)
    s.input('alpha, written')
    s.field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => expect(s.publish).toHaveBeenCalledOnce())
    expect(s.editor.controls.editing()).toBeNull()
    expect(s.document.session.graph.nodes[0].text).toBe('alpha, written')
  })
})

describe('a paste', () => {
  const paste = (s: Harness, text: string, files: File[] = []) => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { files, getData: (type: string) => (type === 'text/plain' ? text : '') },
    })
    s.el.dispatchEvent(event)
    return event
  }
  it('puts words where the pointer is, as one step', async () => {
    const s = setup(cards())
    // A stage with room on it, as the app's has, so the pointer is over the shown part.
    Object.defineProperty(s.viewer.stage, 'clientWidth', { value: 1000 })
    Object.defineProperty(s.viewer.stage, 'clientHeight', { value: 800 })
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    pointer(s, 'pointermove', 400, 500, mouse)
    expect(paste(s, 'A sample thought').defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(s.publish).toHaveBeenCalledOnce())
    const made = s.document.session.graph.nodes.find((n) => n.text === 'A sample thought')!
    expect(made.x + made.width / 2).toBe(400)
    expect(s.document.session.history.undo).toBe(1)
    expect(s.editor.controls.picked().ids).toEqual([made.id])
  })
  it('leaves a paste into a card\'s words to the field', () => {
    const s = setup(cards())
    s.button('Add text card').click()
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [], getData: () => 'words' },
    })
    s.field().dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('fitting the canvas', () => {
  it('keeps what it shows clear of the tools across the top', () => {
    const s = setup(cards())
    Object.defineProperty(s.viewer.stage, 'clientWidth', { value: 1000 })
    Object.defineProperty(s.viewer.stage, 'clientHeight', { value: 600 })
    s.viewer.insetTop = 44
    s.viewer.fit(false)
    const { y, zoom } = s.viewer.camera
    // The topmost card's edge lands under the row of tools, with the margin still to spare.
    expect((0 - y) * zoom).toBeGreaterThanOrEqual(44 + 16 - 0.5)
  })
})

describe('keys on what is picked', () => {
  const pick = (s: Harness, ...ids: string[]) =>
    ((s.editor as unknown as { selected: Set<string> }).selected = new Set(ids))
  it('duplicate it with Cmd+D and move it with the arrows', async () => {
    const s = setup(cards())
    pick(s, 'alpha')
    key(s, 'd', 'keydown', { metaKey: true })
    await vi.waitFor(() => expect(s.document.session.graph.nodes).toHaveLength(4))
    const copy = s.editor.controls.picked().ids[0]
    key(s, 'ArrowRight', 'keydown', { shiftKey: true })
    await vi.waitFor(() =>
      expect(s.document.session.graph.nodes.find((n) => n.id === copy)!.x).toBe(260 + 40 + 10)
    )
    expect(s.document.session.history.undo).toBe(2)
  })
  it('send it back with Cmd+[ and pick all with Cmd+A', async () => {
    const s = setup(cards())
    pick(s, 'gamma')
    key(s, '[', 'keydown', { metaKey: true })
    await vi.waitFor(() => expect(s.document.session.graph.nodes[0].id).toBe('gamma'))
    key(s, 'a', 'keydown', { metaKey: true })
    expect(new Set(s.editor.controls.picked().ids)).toEqual(new Set(['alpha', 'beta', 'gamma']))
  })
  it('leave the arrows to the walkthrough when nothing is picked', () => {
    const s = setup(cards())
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    s.el.dispatchEvent(event)
    expect(s.document.session.dirty).toBe(false)
  })
})
