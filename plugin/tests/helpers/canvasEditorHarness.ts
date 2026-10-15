/** A canvas editor over a document in memory, with pointer events on its stage. */
import { afterEach, vi } from 'vitest'
import { CanvasEditor } from '@/canvas/Editor'
import { CanvasViewer } from '@/canvas/Viewer'
import { CanvasDocument } from '@/canvas/documentRegistry'
import { emptyCanvas, type CanvasGraph } from '@/canvas/core/model'
import { TFile } from 'obsidian'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((fn) => fn()))
/** `delay` holds every write open, as a vault write does, so actions can land during a save. */
export function setup(
  graph: CanvasGraph = emptyCanvas(),
  { delay = 0, schedule = { idle: 0, max: 0 } } = {}
) {
  const settle = () => (delay ? new Promise((resolve) => setTimeout(resolve, delay)) : undefined)
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
    await settle()
    session.acknowledge(token, { graph, revision: `saved-${session.generation}` })
    documentState.clearRecovery()
    documentState.notify()
  })
  const notice = vi.fn()
  const editor = new CanvasEditor(viewer, {
    document: () => documentState,
    publish,
    schedule,
    pickFile: async () => 'sample-note.md',
    pickLink: async () => 'https://sample.example',
    confirmDiscard: async () => true,
    handoffChoice: async () => 'retain',
    notice,
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
  return {
    el,
    viewer,
    editor,
    document: documentState,
    publish,
    notice,
    button,
    field,
    input,
    openNode,
  }
}

export const cards = (): CanvasGraph => ({
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
export function pointer(
  s: ReturnType<typeof setup>,
  type: string,
  x: number,
  y: number,
  extra = {}
) {
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
