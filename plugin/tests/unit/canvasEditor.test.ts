import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasEditor } from '@/canvas/Editor'
import { CanvasViewer } from '@/canvas/Viewer'
import { CanvasDocument } from '@/canvas/documentRegistry'
import { emptyCanvas, type CanvasGraph } from '@/canvas/core/model'
import { TFile } from 'obsidian'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((fn) => fn()))
function setup(graph: CanvasGraph = emptyCanvas()) {
  const el = document.createElement('div')
  document.body.append(el)
  const openNode = vi.fn()
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
    cards: { sync: () => new Set(), destroy: () => {} },
    openNode,
  })
  const file = Object.assign(new TFile(), { path: 'sample.canvas' })
  let documentState: CanvasDocument
  const snapshot = { graph, revision: 'initial' }
  documentState = new CanvasDocument(
    file,
    snapshot,
    async () => snapshot,
    () => false,
    () => {}
  )
  const publish = vi.fn(async () => {
    const session = documentState.session,
      token = session.prepareDraft()
    const graph = session.apply(token, session.committed)
    session.acknowledge(token, { graph, revision: `saved-${session.generation}` })
    documentState.clearRecovery()
    documentState.notify()
  })
  const editor = new CanvasEditor(viewer, {
    document: () => documentState,
    publish,
    history: vi.fn(async (direction) => {
      const session = documentState.session,
        token = direction === 'undo' ? session.prepareUndo() : session.prepareRedo()
      const graph = session.apply(token, session.committed)
      session.acknowledge(token, { graph, revision: `history-${session.generation}` })
      documentState.notify()
    }),
    pickFile: async () => 'sample-note.md',
    pickLink: async () => 'https://sample.example',
    confirmDiscard: async () => true,
    handoffChoice: async () => 'retain',
    notice: vi.fn(),
  })
  documentState.owners.set(editor, (current) => {
    viewer.load(current.session.graph)
    editor.refresh()
  })
  documentState.notify()
  const button = (label: string) => el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
  const field = () => el.querySelector<HTMLTextAreaElement>('textarea')!
  const input = (text: string) => {
    field().value = text
    field().dispatchEvent(new Event('input', { bubbles: true }))
  }
  cleanups.push(() => {
    editor.destroy()
    viewer.destroy()
    el.remove()
  })
  return { el, viewer, editor, document: documentState, publish, button, field, input, openNode }
}

const cards = (): CanvasGraph => ({
  nodes: ['alpha', 'beta', 'gamma'].map((id, i) => ({
    id,
    type: 'text',
    text: id,
    x: i * 300,
    y: 0,
    width: 260,
    height: 160,
  })),
  edges: [{ id: 'connection', fromNode: 'alpha', toNode: 'beta' }],
})
function pointer(s: ReturnType<typeof setup>, type: string, x: number, y: number, extra = {}) {
  s.viewer.stage.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      bubbles: true,
      ...extra,
    })
  )
}

describe('human shapes and connections', () => {
  it('adds any of the eight shapes through the controls', async () => {
    const s = setup()
    const shape = s.el.querySelector<HTMLSelectElement>('[aria-label="Canvas shape"]')!
    expect(shape).not.toBeNull()
    expect(shape.options).toHaveLength(8)
    shape.value = 'diamond'
    s.button('Add canvas shape').click()
    s.input('Decision')
    s.button('Save text').click()
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    expect(s.document.session.graph.nodes[0]).toMatchObject({
      type: 'text',
      text: 'Decision',
      styleAttributes: { shape: 'diamond' },
    })
  })
  it('changes a selected shape and its native color in one undo item', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    pointer(s, 'pointerdown', 130, 80)
    pointer(s, 'pointerup', 130, 80)
    s.el.querySelector<HTMLSelectElement>('[aria-label="Canvas shape"]')!.value = 'circle'
    const color = s.el.querySelector<HTMLSelectElement>('[aria-label="Shape color"]')!
    expect(color).not.toBeNull()
    color.value = '4'
    s.button('Apply selected shape').click()
    await vi.waitFor(() => expect(s.document.session.history.undo).toBe(1))
    expect(s.document.session.graph.nodes[0]).toMatchObject({
      styleAttributes: { shape: 'circle' },
      color: '4',
    })
    s.button('Undo canvas change').click()
    await vi.waitFor(() => expect(s.document.session.graph).toEqual(cards()))
  })
  it('selects connections over group backgrounds, rather than dragging the group', () => {
    const graph = cards()
    graph.nodes.unshift({ id: 'frame', type: 'group', x: -40, y: -40, width: 920, height: 240 })
    const s = setup(graph)
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    pointer(s, 'pointerdown', 280, 80)
    pointer(s, 'pointerup', 280, 80)
    expect(s.viewer.selection.has('connection')).toBe(true)
    expect(s.publish).not.toHaveBeenCalled()
  })
  it('connects by touch with preview only, selects, reconnects and deletes an edge with atomic undo', async () => {
    const graph = cards()
    graph.edges = []
    const s = setup(graph)
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    s.button('Draw connection').click()
    pointer(s, 'pointerdown', 130, 80)
    pointer(s, 'pointermove', 280, 80)
    expect(s.document.session.busy).toBe(true)
    expect(s.document.session.graph.edges).toHaveLength(0)
    expect(s.publish).not.toHaveBeenCalled()
    pointer(s, 'pointerup', 430, 80)
    await vi.waitFor(() => expect(s.document.session.history.undo).toBe(1))
    const edge = s.document.session.graph.edges[0]
    expect(edge).toMatchObject({ fromNode: 'alpha', toNode: 'beta' })
    s.button('Select canvas objects').click()
    pointer(s, 'pointerdown', 280, 80)
    pointer(s, 'pointerup', 280, 80)
    expect(s.viewer.selection.has(edge.id)).toBe(true)
    const label = s.el.querySelector<HTMLInputElement>('[aria-label="Connection label"]')!
    label.value = 'Next step'
    s.button('Apply connection style').click()
    await vi.waitFor(() => expect(s.document.session.history.undo).toBe(2))
    expect(s.document.session.graph.edges[0].label).toBe('Next step')
    pointer(s, 'pointerdown', 300, 80)
    pointer(s, 'pointermove', 560, 80)
    pointer(s, 'pointerup', 730, 80)
    await vi.waitFor(() => expect(s.document.session.history.undo).toBe(3))
    expect(s.document.session.graph.edges[0]).toMatchObject({
      id: edge.id,
      toNode: 'gamma',
      label: 'Next step',
    })
    s.button('Delete selected card').click()
    await vi.waitFor(() => expect(s.document.session.graph.edges).toHaveLength(0))
    s.button('Undo canvas change').click()
    await vi.waitFor(() => expect(s.document.session.graph.edges[0]?.toNode).toBe('gamma'))
  })
  it.each(['empty release', 'pointercancel', 'second finger', 'source change'])(
    'cancels an incomplete connection on %s',
    (reason) => {
      const graph = cards()
      graph.edges = []
      const s = setup(graph)
      s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
      s.button('Draw connection').click()
      pointer(s, 'pointerdown', 130, 80)
      pointer(s, 'pointermove', 280, 80)
      if (reason === 'pointercancel') pointer(s, 'pointercancel', 280, 80)
      else if (reason === 'second finger') pointer(s, 'pointerdown', 400, 80, { pointerId: 2 })
      else if (reason === 'source change') {
        const external = cards()
        external.edges = []
        external.nodes[0].text = 'External'
        s.document.observe({ graph: external, revision: 'external' })
        pointer(s, 'pointerup', 430, 80)
      } else pointer(s, 'pointerup', 280, 80)
      expect(s.publish).not.toHaveBeenCalled()
      expect(s.document.session.dirty).toBe(false)
      expect(s.document.session.graph.edges).toHaveLength(0)
    }
  )
  it('refuses a free-line write into an incompatible extension without trapping an active draft', async () => {
    const graph = { ...emptyCanvas(), abele: { lines: { version: 9, payload: 'opaque' } } }
    const s = setup(graph)
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    s.button('Draw free arrow').click()
    pointer(s, 'pointerdown', 30, 30)
    pointer(s, 'pointermove', 130, 80)
    pointer(s, 'pointerup', 230, 130)
    await vi.waitFor(() => expect(s.document.session.busy).toBe(false))
    expect(s.document.session.dirty).toBe(false)
    expect(s.document.session.graph).toEqual(graph)
    expect(s.publish).not.toHaveBeenCalled()
  })
  it('applying an unchanged connection style does not write or add history', () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    pointer(s, 'pointerdown', 280, 80)
    pointer(s, 'pointerup', 280, 80)
    s.button('Apply connection style').click()
    expect(s.publish).not.toHaveBeenCalled()
    expect(s.document.session.dirty).toBe(false)
    expect(s.document.session.graph).toEqual(cards())
  })
  it('finishing a connection caption releases text focus for touch navigation', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    pointer(s, 'pointerdown', 280, 80)
    pointer(s, 'pointerup', 280, 80)
    const field = s.el.querySelector<HTMLInputElement>('[aria-label="Connection label"]')!
    field.focus()
    field.value = 'Caption'
    s.button('Apply connection style').click()
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    expect(document.activeElement).not.toBe(field)
    expect(s.document.session.graph.edges[0].label).toBe('Caption')
  })
  it('does not replace a changed connection with stale property input', () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    pointer(s, 'pointerdown', 280, 80)
    pointer(s, 'pointerup', 280, 80)
    const field = s.el.querySelector<HTMLInputElement>('[aria-label="Connection label"]')!
    field.focus()
    field.value = 'Local caption'
    const external = cards()
    external.edges[0].label = 'External caption'
    s.document.observe({ graph: external, revision: 'external' })
    s.button('Apply connection style').click()
    expect(s.publish).not.toHaveBeenCalled()
    expect(s.document.session.dirty).toBe(false)
    expect(s.document.session.graph.edges[0].label).toBe('External caption')
  })
  it('draws, moves and changes endpoints of a free arrow by touch', async () => {
    const s = setup()
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    s.button('Draw free arrow').click()
    pointer(s, 'pointerdown', 30, 30)
    pointer(s, 'pointermove', 180, 120)
    pointer(s, 'pointerup', 230, 130)
    await vi.waitFor(() => expect(s.document.session.history.undo).toBe(1))
    const line = (s.document.session.graph.abele?.lines as { id: string; toEnd: string }[])[0]
    expect(line.toEnd).toBe('arrow')
    s.button('Select canvas objects').click()
    pointer(s, 'pointerdown', 130, 80)
    pointer(s, 'pointerup', 130, 80)
    expect(s.viewer.selection.has(line.id)).toBe(true)
    pointer(s, 'pointerdown', 230, 130)
    pointer(s, 'pointermove', 250, 150)
    pointer(s, 'pointerup', 270, 170)
    await vi.waitFor(() => expect(s.document.session.history.undo).toBe(2))
    expect((s.document.session.graph.abele?.lines as { to: unknown }[])[0].to).toEqual({
      x: 270,
      y: 170,
    })
    pointer(s, 'pointerdown', 150, 100)
    pointer(s, 'pointermove', 170, 120)
    pointer(s, 'pointerup', 170, 120)
    await vi.waitFor(() => expect(s.document.session.history.undo).toBe(3))
    expect((s.document.session.graph.abele?.lines as { from: unknown }[])[0].from).toEqual({
      x: 50,
      y: 50,
    })
  })
})

describe('human canvas geometry', () => {
  it('previews a zoomed drag without publishing and completes exactly one shared history entry', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 2 })
    pointer(s, 'pointerdown', 60, 60)
    pointer(s, 'pointermove', 100, 100)
    pointer(s, 'pointermove', 140, 120)
    expect(s.document.session.busy).toBe(true)
    expect(s.viewer.graph.nodes[0]).toMatchObject({ x: 40, y: 30 })
    expect(s.document.session.committed.graph.nodes[0].x).toBe(0)
    expect(s.publish).not.toHaveBeenCalled()
    pointer(s, 'pointerup', 140, 120)
    await vi.waitFor(() => expect(s.publish).toHaveBeenCalledOnce())
    expect(s.document.session.graph.nodes[0]).toMatchObject({ x: 40, y: 30 })
    expect(s.document.session.history).toEqual({ undo: 1, redo: 0 })
    s.button('Undo canvas change').click()
    await vi.waitFor(() => expect(s.document.session.graph.nodes[0].x).toBe(0))
    s.button('Redo canvas change').click()
    await vi.waitFor(() => expect(s.document.session.graph.nodes[0].x).toBe(40))
  })

  it.each(['pointercancel', 'lostpointercapture', 'second finger', 'Escape', 'Fit', 'close'])(
    '%s cancels a geometry preview without an accidental move or history entry',
    (reason) => {
      const s = setup(cards())
      s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
      pointer(s, 'pointerdown', 30, 30)
      pointer(s, 'pointermove', 80, 70)
      expect(s.viewer.graph.nodes[0].x).toBe(50)
      if (reason === 'second finger') {
        pointer(s, 'pointerdown', 180, 100, { pointerId: 2 })
        pointer(s, 'pointermove', 200, 140, { pointerId: 2 })
        pointer(s, 'pointerup', 200, 140, { pointerId: 2 })
        pointer(s, 'pointermove', 120, 80)
        pointer(s, 'pointerup', 120, 80)
      } else if (reason === 'Escape')
        s.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      else if (reason === 'Fit') s.button('Fit diagram').click()
      else if (reason === 'close') s.editor.destroy()
      else pointer(s, reason, 80, 70)
      expect(s.document.session.graph).toEqual(cards())
      expect(s.document.session.dirty).toBe(false)
      expect(s.document.session.history.undo).toBe(0)
      expect(s.publish).not.toHaveBeenCalled()
    }
  )

  it('resizes a selected note with a screen-space corner target at zoom', async () => {
    const graph = cards()
    graph.nodes[0] = { ...graph.nodes[0], type: 'file', file: 'sample-note.md' }
    const s = setup(graph)
    s.viewer.setCamera({ x: 0, y: 0, zoom: 0.5 })
    pointer(s, 'pointerdown', 30, 30)
    pointer(s, 'pointerup', 30, 30)
    // 18 screen pixels beyond the corner is still within its touch target.
    pointer(s, 'pointerdown', 148, 98)
    pointer(s, 'pointermove', 178, 118)
    pointer(s, 'pointerup', 178, 118)
    await vi.waitFor(() => expect(s.publish).toHaveBeenCalledOnce())
    expect(s.document.session.graph.nodes[0]).toMatchObject({
      width: 320,
      height: 200,
      file: 'sample-note.md',
    })
    expect(s.openNode).not.toHaveBeenCalled()
  })

  it('selects three cards by touch, groups, moves descendants once, ungroups and undoes', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    s.button('Toggle multiple selection').click()
    for (const x of [30, 330, 630]) {
      pointer(s, 'pointerdown', x, 30)
      pointer(s, 'pointerup', x, 30)
    }
    expect([...s.viewer.selection]).toEqual(['alpha', 'beta', 'gamma'])
    s.button('Group selected cards').click()
    await vi.waitFor(() => expect(s.document.session.graph.nodes).toHaveLength(4))
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    expect(s.viewer.selection.size).toBe(1)
    s.button('Toggle multiple selection').click()
    pointer(s, 'pointerdown', 80, -20)
    pointer(s, 'pointermove', 130, 20)
    pointer(s, 'pointerup', 130, 20)
    await vi.waitFor(() => expect(s.document.session.history.undo).toBe(2))
    expect(s.document.session.graph.nodes.slice(0, 3).map((n) => [n.x, n.y])).toEqual([
      [50, 40],
      [350, 40],
      [650, 40],
    ])
    s.button('Ungroup selected group').click()
    await vi.waitFor(() => expect(s.document.session.graph.nodes).toHaveLength(3))
    s.button('Undo canvas change').click()
    await vi.waitFor(() => expect(s.document.session.graph.nodes).toHaveLength(4))
    s.button('Undo canvas change').click()
    await vi.waitFor(() => expect(s.document.session.graph.nodes[0].x).toBe(0))
  })

  it('keeps failed geometry as a visible ordinary human draft and retries it once', async () => {
    const s = setup(cards())
    s.publish.mockRejectedValueOnce(new Error('Sample unwritten save failure'))
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    pointer(s, 'pointerdown', 30, 30)
    pointer(s, 'pointermove', 80, 70)
    pointer(s, 'pointerup', 80, 70)
    await vi.waitFor(() => expect(s.button('Retry save').disabled).toBe(false))
    expect(s.document.session.committed.graph.nodes[0].x).toBe(0)
    expect(s.viewer.graph.nodes[0].x).toBe(50)
    expect(s.el.textContent).toContain('not saved')
    expect(s.document.session.history.undo).toBe(0)
    s.button('Retry save').click()
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    expect(s.document.session.graph.nodes[0].x).toBe(50)
    expect(s.document.session.history.undo).toBe(1)
  })
  it('does not publish a drag that returns to its start, preserving redo', async () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    pointer(s, 'pointerdown', 30, 30)
    pointer(s, 'pointermove', 80, 70)
    pointer(s, 'pointerup', 80, 70)
    await vi.waitFor(() => expect(s.document.session.history.undo).toBe(1))
    s.button('Undo canvas change').click()
    await vi.waitFor(() => expect(s.document.session.history.redo).toBe(1))
    s.publish.mockClear()
    pointer(s, 'pointerdown', 30, 30)
    pointer(s, 'pointermove', 80, 70)
    pointer(s, 'pointermove', 30, 30)
    pointer(s, 'pointerup', 30, 30)
    expect(s.publish).not.toHaveBeenCalled()
    expect(s.document.session.dirty).toBe(false)
    expect(s.document.session.history).toEqual({ undo: 0, redo: 1 })
  })
  it('box-selects by touch and Shift-click toggles without moving or publishing', () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    s.button('Toggle multiple selection').click()
    pointer(s, 'pointerdown', -30, -30)
    pointer(s, 'pointermove', 570, 190)
    pointer(s, 'pointerup', 570, 190)
    expect([...s.viewer.selection]).toEqual(['alpha', 'beta'])
    s.button('Toggle multiple selection').click()
    pointer(s, 'pointerdown', 330, 30, { pointerType: 'mouse', shiftKey: true })
    pointer(s, 'pointerup', 330, 30, { pointerType: 'mouse', shiftKey: true })
    expect([...s.viewer.selection]).toEqual(['alpha'])
    expect(s.document.session.dirty).toBe(false)
    expect(s.publish).not.toHaveBeenCalled()
  })
  it('refuses stale geometry when the source changes before the drag threshold', () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    pointer(s, 'pointerdown', 30, 30)
    const external = cards()
    external.nodes[0].width = 400
    external.nodes[0].text = 'External content'
    s.document.observe({ graph: external, revision: 'external' })
    pointer(s, 'pointermove', 80, 70)
    pointer(s, 'pointerup', 80, 70)
    expect(s.publish).not.toHaveBeenCalled()
    expect(s.document.session.graph).toEqual(external)
    expect(s.document.session.dirty).toBe(false)
  })
  it('refuses geometry publication if source changes during the gesture', () => {
    const s = setup(cards())
    s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
    pointer(s, 'pointerdown', 30, 30)
    pointer(s, 'pointermove', 80, 70)
    const external = cards()
    external.nodes[0].text = 'External content'
    s.document.observe({ graph: external, revision: 'external' })
    pointer(s, 'pointerup', 80, 70)
    expect(s.publish).not.toHaveBeenCalled()
    expect(s.document.session.graph).toEqual(external)
  })
})

describe('human canvas editor', () => {
  it('creates a text card and publishes completed text once, never its composition', async () => {
    const s = setup()
    s.button('Add text card').click()
    expect(s.field()).not.toBeNull()
    expect(document.activeElement).toBe(s.field())
    s.field().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    s.input('A composing card')
    s.button('Save text').click()
    expect(s.publish).not.toHaveBeenCalled()
    expect(s.document.session.committed.graph.nodes).toHaveLength(0)
    expect(s.document.session.graph.nodes[0].text).toBe('A composing card')
    s.field().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    s.input('Final card')
    s.button('Save text').click()
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    expect(s.publish).toHaveBeenCalledOnce()
    expect(s.document.session.history).toEqual({ undo: 1, redo: 0 })
    expect(s.document.session.graph.nodes[0].text).toBe('Final card')
  })

  it('does not steal shortcuts or arrow keys from the text input', () => {
    const s = setup()
    s.button('Add text card').click()
    for (const key of ['ArrowRight', 'Delete', 'Escape', 'z']) {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: key === 'z',
        bubbles: true,
        cancelable: true,
      })
      s.field().dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(s.document.session.draft?.active).toBe(true)
    expect(s.document.session.graph.nodes).toHaveLength(1)
  })

  it('inserts files and links through pickers; tapping selects, opening is a separate action', async () => {
    const s = setup()
    s.button('Add note or attachment').click()
    await vi.waitFor(() => expect(s.document.session.graph.nodes).toHaveLength(1))
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    const note = s.document.session.graph.nodes[0]
    s.viewer.setCamera({ x: note.x, y: note.y, zoom: 1 })
    for (const type of ['pointerdown', 'pointerup'])
      s.viewer.stage.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: 'touch',
          clientX: 40,
          clientY: 40,
          bubbles: true,
        })
      )
    expect(s.openNode).not.toHaveBeenCalled()
    expect(s.button('Edit card text').disabled).toBe(true)
    s.button('Open selected card').click()
    expect(s.openNode).toHaveBeenCalledWith(note)
    s.button('Add link').click()
    await vi.waitFor(() => expect(s.document.session.graph.nodes).toHaveLength(2))
    expect(s.document.session.graph.nodes[1].url).toBe('https://sample.example')
  })

  it('deletes and undoes through the shared history', async () => {
    const s = setup()
    s.button('Add text card').click()
    s.input('Keep through history')
    s.button('Save text').click()
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    s.button('Delete selected card').click()
    await vi.waitFor(() => expect(s.document.session.committed.graph.nodes).toHaveLength(0))
    s.button('Undo canvas change').click()
    await vi.waitFor(() =>
      expect(s.document.session.graph.nodes[0]?.text).toBe('Keep through history')
    )
    s.button('Redo canvas change').click()
    await vi.waitFor(() => expect(s.document.session.graph.nodes).toHaveLength(0))
  })

  it('retains failed text visibly, offers retry only on unchanged baseline and discards locally', async () => {
    const s = setup()
    s.publish.mockRejectedValueOnce(new Error('Sample storage unavailable'))
    s.button('Add text card').click()
    s.input('Unsaved card')
    s.button('Save text').click()
    await vi.waitFor(() => expect(s.button('Retry save').disabled).toBe(false))
    expect(s.el.textContent).toMatch(/not saved|unsaved/i)
    expect(s.document.session.graph.nodes[0].text).toBe('Unsaved card')
    expect(s.document.session.history.undo).toBe(0)
    s.document.observe({ graph: emptyCanvas(), revision: 'external' })
    expect(s.button('Retry save').disabled).toBe(true)
    s.button('Discard local draft').click()
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    expect(s.document.session.committed.revision).toBe('external')
    expect(s.publish).toHaveBeenCalledOnce()
  })

  it('does not publish a failed undo preview as a new text command through Retry save', async () => {
    const s = setup()
    s.button('Add text card').click()
    s.input('Saved card')
    s.button('Save text').click()
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    const token = s.document.session.prepareUndo()
    s.document.session.reject(token)
    s.document.notify()
    expect(s.button('Retry save').disabled).toBe(true)
    expect(s.el.textContent).toMatch(/history.*discard|discard.*history/i)
    expect(s.document.session.history).toEqual({ undo: 1, redo: 0 })
  })

  it.each(['undo', 'redo'] as const)(
    'does not turn a failed %s preview into a human text draft',
    async (direction) => {
      const s = setup()
      s.button('Add text card').click()
      s.input('First saved text')
      s.button('Save text').click()
      await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
      s.button('Edit card text').click()
      s.input('Second saved text')
      s.button('Save text').click()
      await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
      if (direction === 'redo') {
        s.button('Undo canvas change').click()
        await vi.waitFor(() => expect(s.document.session.history.redo).toBe(1))
      }
      const token =
        direction === 'undo' ? s.document.session.prepareUndo() : s.document.session.prepareRedo()
      s.document.session.reject(token)
      s.document.notify()
      const draft = s.document.session.draft,
        history = s.document.session.history,
        generation = s.document.session.generation
      s.publish.mockClear()
      expect(s.document.draftPath).toBeNull()
      expect(s.button('Edit card text').disabled).toBe(true)
      // The handler must also refuse a stale/programmatic activation, independently of the DOM flag.
      s.button('Edit card text').disabled = false
      s.button('Edit card text').click()
      expect(s.document.session.generation).toBe(generation)
      expect(s.document.session.draft).toEqual(draft)
      expect(s.document.draftPath).toBeNull()
      expect(s.document.session.history).toEqual(history)
      expect(s.publish).not.toHaveBeenCalled()
    }
  )

  it('still lets a retained human text draft be edited and completed', async () => {
    const s = setup()
    s.publish.mockRejectedValueOnce(new Error('Sample storage unavailable'))
    s.button('Add text card').click()
    s.input('Pending human text')
    s.button('Save text').click()
    await vi.waitFor(() => expect(s.button('Retry save').disabled).toBe(false))
    expect(s.button('Edit card text').disabled).toBe(false)
    s.button('Edit card text').click()
    s.input('Revised human text')
    s.button('Save text').click()
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    expect(s.document.session.committed.graph.nodes[0].text).toBe('Revised human text')
    expect(s.document.session.history).toEqual({ undo: 1, redo: 0 })
  })

  it.each(['untouched', 'restored'] as const)(
    'saving %s text publishes nothing and preserves redo',
    async (mode) => {
      const s = setup()
      s.button('Add text card').click()
      s.input('First text')
      s.button('Save text').click()
      await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
      s.button('Edit card text').click()
      s.input('Second text')
      s.button('Save text').click()
      await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
      s.button('Undo canvas change').click()
      await vi.waitFor(() => expect(s.document.session.history).toEqual({ undo: 1, redo: 1 }))
      const baseline = s.document.session.committed
      s.publish.mockClear()
      s.button('Edit card text').click()
      if (mode === 'restored') {
        s.input('Temporary typing')
        s.input('First text')
      }
      s.button('Save text').click()
      await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
      expect(s.publish).not.toHaveBeenCalled()
      expect(s.document.session.committed).toEqual(baseline)
      expect(s.document.session.history).toEqual({ undo: 1, redo: 1 })
      s.button('Redo canvas change').click()
      await vi.waitFor(() => expect(s.document.session.graph.nodes[0].text).toBe('Second text'))
    }
  )

  it('publishes a retained human addition even when its text field is unchanged', async () => {
    const s = setup()
    s.publish.mockRejectedValueOnce(new Error('Sample storage unavailable'))
    s.button('Add text card').click()
    s.input('Pending addition')
    s.button('Save text').click()
    await vi.waitFor(() => expect(s.button('Retry save').disabled).toBe(false))
    s.publish.mockClear()
    s.button('Edit card text').click()
    s.button('Save text').click()
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    expect(s.publish).toHaveBeenCalledOnce()
    expect(s.document.session.committed.graph.nodes[0].text).toBe('Pending addition')
    expect(s.document.session.history).toEqual({ undo: 1, redo: 0 })
  })

  it('still publishes the explicit creation of a blank text card', async () => {
    const s = setup()
    s.button('Add text card').click()
    s.button('Save text').click()
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    expect(s.publish).toHaveBeenCalledOnce()
    expect(s.document.session.committed.graph.nodes).toHaveLength(1)
    expect(s.document.session.history.undo).toBe(1)
  })

  it('does not silently discard an unchanged text draft after an external revision', async () => {
    const s = setup()
    s.button('Add text card').click()
    s.input('Saved text')
    s.button('Save text').click()
    await vi.waitFor(() => expect(s.document.session.dirty).toBe(false))
    s.publish.mockClear()
    s.button('Edit card text').click()
    s.document.observe({ graph: s.document.session.committed.graph, revision: 'external-revision' })
    s.button('Save text').click()
    expect(s.publish).not.toHaveBeenCalled()
    expect(s.document.session.dirty).toBe(true)
    expect(s.document.session.conflict).toBe(true)
    expect(s.document.session.graph.nodes[0].text).toBe('Saved text')
  })

  it('explicitly retains active text before native handoff, without silently saving it', async () => {
    const s = setup()
    s.button('Add text card').click()
    s.input('Retained for later')
    expect(await s.editor.prepareNative()).toBe(true)
    expect(s.document.session.draft?.active).toBe(false)
    expect(s.document.session.graph.nodes[0].text).toBe('Retained for later')
    expect(s.document.writer).toBe(false)
    expect(s.publish).not.toHaveBeenCalled()
  })

  it('refuses a second leaf editing the active human draft and retains it on close', () => {
    const s = setup()
    s.button('Add text card').click()
    s.input('Active draft')
    expect(() => s.document.beginDraft()).toThrow(/busy/i)
    s.editor.destroy()
    expect(s.document.session.draft?.active).toBe(false)
    expect(s.document.session.graph.nodes[0].text).toBe('Active draft')
    expect(s.publish).not.toHaveBeenCalled()
  })
})
