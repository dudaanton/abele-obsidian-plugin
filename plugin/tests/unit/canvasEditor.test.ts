import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasEditor } from '@/canvas/Editor'
import { CanvasViewer } from '@/canvas/Viewer'
import { CanvasDocument } from '@/canvas/documentRegistry'
import { emptyCanvas } from '@/canvas/core/model'
import { TFile } from 'obsidian'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((fn) => fn()))
function setup() {
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
  const snapshot = { graph: emptyCanvas(), revision: 'initial' }
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
