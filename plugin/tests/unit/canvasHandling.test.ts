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
/** Two presses in one place; the canvas answers a double press once the second is over. */
async function double(s: Harness, x: number, y: number) {
  tap(s, x, y)
  tap(s, x, y)
  await Promise.resolve()
  await Promise.resolve()
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
  it('opens a card for its words', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    await double(s, 100, 80)
    expect(s.editor.controls.editing()).toBe('alpha')
  })
  it('opens a connection for its label, saved as one step', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    // The connection runs from alpha's right edge to beta's left one, at mid height.
    await double(s, 280, 80)
    expect(s.editor.controls.labelling()).toBe('connection')
    // The keyboard's field is focused while the touch is still handled, for a phone to raise it.
    expect(document.activeElement?.classList.contains('abele-canvas-keyboard-primer')).toBe(true)
    await s.editor.controls.saveLabel('connection', 'feeds')
    expect(s.document.session.graph.edges[0].label).toBe('feeds')
    expect(s.document.session.history.undo).toBe(1)
    expect(s.editor.controls.labelling()).toBeNull()
  })
  it('leaves an unchanged label without a step', async () => {
    const s = setup(cards())
    s.editor.controls.editLabel('connection')
    await s.editor.controls.saveLabel('connection', '')
    expect(s.publish).not.toHaveBeenCalled()
    expect(s.editor.controls.labelling()).toBeNull()
  })
  it('makes a card on empty canvas, where it was pressed, open for its words', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    await double(s, 400, 500)
    const made = s.document.session.graph.nodes.find((n) => n.id === s.editor.controls.editing())
    expect(made).toMatchObject({ type: 'text' })
    expect(made!.x + made!.width / 2).toBe(400)
    expect(made!.y + made!.height / 2).toBe(500)
  })
  it('makes a card inside a frame when pressed on its empty room', async () => {
    const s = setup(framed())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    // Empty room inside the frame, under its cards; its name is opened from its label.
    await double(s, 300, 185)
    const made = s.document.session.graph.nodes.find((n) => n.id === s.editor.controls.editing())
    expect(made).toMatchObject({ type: 'text' })
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
  it('leave letters alone while words are written', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    await double(s, 100, 80)
    expect(s.editor.controls.editing()).toBe('alpha')
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

describe('a card being written', () => {
  it('is saved and left with Esc', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    await double(s, 100, 80)
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
  it("leaves a paste into a card's words to the field", () => {
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
    const copy = s.editor.controls.picked().ids[0],
      before = s.document.session.graph.nodes.find((n) => n.id === copy)!.x
    // The copy stands beside what was copied, to its right.
    expect(before).toBeGreaterThanOrEqual(260)
    key(s, 'ArrowRight', 'keydown', { shiftKey: true })
    await vi.waitFor(() =>
      // Shift moves it ten steps to the right.
      expect(s.document.session.graph.nodes.find((n) => n.id === copy)!.x).toBeGreaterThan(before)
    )
    expect(s.document.session.history.undo).toBe(2)
  })
  it('send it back with Cmd+[ and pick all with Cmd+A', async () => {
    const s = setup(cards())
    pick(s, 'gamma')
    key(s, '[', 'keydown', { metaKey: true })
    await vi.waitFor(() => expect(s.document.session.graph.nodes[0].id).toBe('gamma'))
    key(s, 'a', 'keydown', { metaKey: true })
    // Everything: the cards and the connection between them.
    expect(new Set(s.editor.controls.picked().ids)).toEqual(
      new Set(['alpha', 'beta', 'gamma', 'connection'])
    )
  })
  it('leave the arrows to the walkthrough when nothing is picked', () => {
    const s = setup(cards())
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    })
    s.el.dispatchEvent(event)
    expect(s.document.session.dirty).toBe(false)
  })
})

describe('a pinned card', () => {
  it('is picked but stays where it was put', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    await s.editor.controls.setPinned('alpha', true)
    expect(s.document.session.graph.nodes[0].abele?.pinned).toBe(true)
    pointer(s, 'pointerdown', 100, 80, { ...mouse, buttons: 1 })
    pointer(s, 'pointermove', 160, 120, { ...mouse, buttons: 1 })
    pointer(s, 'pointerup', 160, 120, mouse)
    expect(s.editor.controls.picked().ids).toEqual(['alpha'])
    expect(s.document.session.graph.nodes[0]).toMatchObject({ x: 0, y: 0 })
    await s.editor.controls.setPinned('alpha', false)
    expect(s.document.session.graph.nodes[0].abele?.pinned).toBeUndefined()
    expect(s.document.session.history.undo).toBe(2)
  })
})

describe('a note on the canvas', () => {
  it('shows a chosen part of itself, as one step', async () => {
    const graph: CanvasGraph = {
      nodes: [{ id: 'n', type: 'file', file: 'Sample.md', x: 0, y: 0, width: 300, height: 200 }],
      edges: [],
    }
    const s = setup(graph)
    await s.editor.controls.setSubpath('n', '#Sample part')
    expect(s.document.session.graph.nodes[0].subpath).toBe('#Sample part')
    await s.editor.controls.setSubpath('n', '')
    expect(s.document.session.graph.nodes[0].subpath).toBeUndefined()
  })
  it('reads on under the wheel before the canvas moves', () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    const scrolled: [string, number][] = []
    let room = true
    ;(s.viewer as unknown as { ports: { cards: Record<string, unknown> } }).ports.cards.scroll = (
      id: string,
      _dx: number,
      dy: number
    ) => {
      scrolled.push([id, dy])
      return room
    }
    // jsdom's WheelEvent carries no pointer position; a mouse event with the wheel's deltas does.
    const wheel = () =>
      s.viewer.stage.dispatchEvent(
        Object.assign(
          new MouseEvent('wheel', { clientX: 100, clientY: 80, bubbles: true, cancelable: true }),
          { deltaX: 0, deltaY: 40 }
        )
      )
    wheel()
    expect(scrolled).toEqual([['alpha', 40]])
    expect(s.viewer.camera.y).toBe(0)
    // At the end of its words the canvas moves on.
    room = false
    wheel()
    expect(s.viewer.camera.y).toBe(40)
  })
})

describe('an empty canvas', () => {
  it('opens at its own size rather than magnified', () => {
    const s = setup()
    Object.defineProperty(s.viewer.stage, 'clientWidth', { value: 390 })
    Object.defineProperty(s.viewer.stage, 'clientHeight', { value: 700 })
    s.viewer.fit(false)
    expect(s.viewer.camera.zoom).toBeLessThanOrEqual(1)
  })
})

describe('a card made by a double press near the edge', () => {
  it('is brought whole into view', async () => {
    const s = setup(cards())
    Object.defineProperty(s.viewer.stage, 'clientWidth', { value: 800 })
    Object.defineProperty(s.viewer.stage, 'clientHeight', { value: 600 })
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    await double(s, 790, 590)
    const id = s.editor.controls.editing()!,
      card = s.document.session.graph.nodes.find((n) => n.id === id)!,
      { x, y, zoom } = s.viewer.camera
    expect((card.x + card.width - x) * zoom).toBeLessThanOrEqual(800)
    expect((card.y + card.height - y) * zoom).toBeLessThanOrEqual(600)
  })
})

describe('a note inserted from the vault', () => {
  it('stands in a free place nearest the middle, not on a card there', async () => {
    const s = setup(cards())
    Object.defineProperty(s.viewer.stage, 'clientWidth', { value: 390 })
    Object.defineProperty(s.viewer.stage, 'clientHeight', { value: 700 })
    // A phone's view centred on beta, the middle card.
    s.viewer.setCamera({ x: 430 - 195, y: 80 - 350, zoom: 1 })
    s.button('Add note or attachment').click()
    await vi.waitFor(() => expect(s.document.session.graph.nodes).toHaveLength(4))
    const note = s.document.session.graph.nodes.find((n) => n.type === 'file')!
    for (const card of cards().nodes)
      expect(
        note.x + note.width <= card.x ||
          card.x + card.width <= note.x ||
          note.y + note.height <= card.y ||
          card.y + card.height <= note.y,
        card.id
      ).toBe(true)
  })
})
