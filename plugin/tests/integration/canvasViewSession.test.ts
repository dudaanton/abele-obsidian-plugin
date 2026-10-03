import { describe, expect, it, vi } from 'vitest'
import { TFile, WorkspaceLeaf, type App } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { CanvasView } from '@/canvas/CanvasView'
import { canvasDocuments } from '@/canvas/documentRegistry'
import { planCanvasEdit } from '@/canvas/core/service'
import { emptyCanvas, serializeCanvas } from '@/canvas/core/model'

vi.mock('obsidian', async (original) => {
  const api = await original<typeof import('../mocks/obsidian')>()
  return {
    ...api,
    FileView: class extends api.ItemView {
      app: unknown
      file: TFile | null = null
      contentEl = document.createElement('div')
      actions: string[] = []
      constructor(leaf: WorkspaceLeaf & { app: App }) {
        super(leaf)
        this.app = leaf.app
      }
      addAction(_icon: string, title: string) {
        this.actions.push(title)
      }
      async onClose() {}
      async onUnloadFile() {}
    },
  }
})
vi.mock('@/canvas/adapter', () => ({
  hostCanvasViewer: vi.fn(() => {
    const viewer = {
      graph: emptyCanvas(),
      load: vi.fn((graph) => {
        viewer.graph = graph
      }),
      destroy: vi.fn(),
      draw: vi.fn(),
      status: { setText: vi.fn() },
    }
    return viewer
  }),
}))

describe('Abele canvas leaf session lifecycle', () => {
  it('renders the shared session draft in both leaves and retains it across close/reopen without saving', async () => {
    const path = 'sample-leaves.canvas',
      graph = {
        nodes: [
          { id: 'sample', type: 'text', text: 'Original', x: 0, y: 0, width: 100, height: 80 },
        ],
        edges: [],
      }
    const app = buildFakeVault([{ path, raw: JSON.stringify(graph) }])
    Object.assign(app, {
      workspace: {
        getLeavesOfType: () => [],
        on: vi.fn(() => ({ id: 'sample-layout' })),
        offref: vi.fn(),
      },
    })
    const host = app as unknown as App,
      file = app.vault.getAbstractFileByPath(path) as TFile
    const make = async () => {
      const leaf = Object.assign(new WorkspaceLeaf(), { app: host })
      const view = new CanvasView(leaf)
      await view.onOpen()
      await view.onLoadFile(file)
      return view
    }
    const left = await make(),
      right = await make(),
      registry = canvasDocuments(host)
    const document = registry.find(file)!
    expect(document).toBeDefined()
    expect(document.owners.size).toBe(2)
    document.beginDraft()
    document.updateDraft((current) =>
      planCanvasEdit(current, [{ op: 'update', id: 'sample', patch: { text: 'Shared draft' } }])
    )
    expect(left.viewer!.graph.nodes[0].text).toBe('Shared draft')
    expect(right.viewer!.graph.nodes[0].text).toBe('Shared draft')
    await left.onUnloadFile(file)
    await left.onClose()
    expect(document.owners.size).toBe(1)
    expect(right.viewer!.graph.nodes[0].text).toBe('Shared draft')
    await right.onClose()
    const reopened = await make()
    expect(registry.find(file)).toBe(document)
    expect(reopened.viewer!.graph.nodes[0].text).toBe('Shared draft')
    expect(app.stats.modify).toBe(0)
    expect(await app.vault.read(file)).toBe(JSON.stringify(graph))
    document.discardDraft()
    await reopened.onClose()
    expect(registry.find(file)).toBeUndefined()
  })

  it('keeps the last graph and recoverable draft visible when a reload is malformed', async () => {
    const path = 'sample-invalid-reload.canvas'
    const app = buildFakeVault([{ path, raw: serializeCanvas(emptyCanvas()) }])
    Object.assign(app, {
      workspace: {
        getLeavesOfType: () => [],
        on: vi.fn(() => ({ id: 'sample-layout' })),
        offref: vi.fn(),
      },
    })
    const host = app as unknown as App,
      file = app.vault.getAbstractFileByPath(path) as TFile
    const view = new CanvasView(Object.assign(new WorkspaceLeaf(), { app: host }))
    await view.onOpen()
    await view.onLoadFile(file)
    const document = canvasDocuments(host).find(file)!
    document.beginDraft()
    document.updateDraft((graph) =>
      planCanvasEdit(graph, [
        { op: 'add_node', node: { id: 'sample', kind: 'text', label: 'Recoverable', x: 0, y: 0 } },
      ])
    )
    await app.vault.modify(file, '{malformed')
    app.emit('vault', 'modify', file)
    await canvasDocuments(host).flush(file)
    expect(view.viewer!.graph.nodes[0].text).toBe('Recoverable')
    expect(document.session.draft).not.toBeNull()
    expect(document.error).toBeTruthy()
    expect(view.viewer!.status.setText).toHaveBeenCalledWith(
      expect.stringMatching(/read|SyntaxError|JSON/i)
    )
    expect(await app.vault.read(file)).toBe('{malformed')
    await view.onClose()
  })
})
