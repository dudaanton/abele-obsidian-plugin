import { describe, expect, it, vi } from 'vitest'
import { TFile, WorkspaceLeaf, Menu, Modal, type App } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { createCanvasTools } from '@/ai/tools/CanvasTools'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'
import { CanvasView } from '@/canvas/CanvasView'
import { CanvasPublicationReviewModal } from '@/canvas/CanvasPublicationReviewModal'
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
      actionHandlers = new Map<string, (event: MouseEvent) => unknown>()
      constructor(leaf: WorkspaceLeaf & { app: App }) {
        super(leaf)
        this.app = leaf.app
      }
      addAction(_icon: string, title: string, handler: (event: MouseEvent) => unknown) {
        this.actions.push(title)
        this.actionHandlers.set(title, handler)
      }
      async onClose() {}
      async onUnloadFile() {}
    },
  }
})
vi.mock('@/canvas/editorControls', () => ({
  hostCanvasEditor: vi.fn(() => ({ refresh: vi.fn(), destroy: vi.fn() })),
}))
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

function repairScenario(raw = '{malformed') {
  const path = 'sample-repair.canvas'
  const app = buildFakeVault([{ path, raw }])
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
  const graph = planCanvasEdit(emptyCanvas(), [
    { op: 'add_node', node: { id: 'sample', kind: 'text', label: 'Repaired content', x: 0, y: 0 } },
  ])
  return { app, host, file, view, graph, registry: canvasDocuments(host) }
}

describe('Abele canvas leaf session lifecycle', () => {
  it('revokes a local choice synchronously before the host finishes its close animation', () => {
    const { host } = repairScenario(serializeCanvas(emptyCanvas())),
      keep = vi.fn()
    const modal = new CanvasPublicationReviewModal(
      host,
      {
        source: { bytes: '{}', graph: emptyCanvas(), error: null, revision: 'sample-source' },
        evidence: {
          outcome: 'unknown',
          baseline: { graph: emptyCanvas(), revision: 'sample-baseline' },
          proposed: emptyCanvas(),
          kind: 'command',
        },
        native: false,
      },
      keep,
      async () => {}
    )
    const close = vi.spyOn(Modal.prototype, 'close').mockImplementation(() => {
      // The host can defer onClose and removal while its mobile sheet animates away.
    })
    try {
      modal.open()
      modal.close()
      expect(keep).toHaveBeenCalledOnce()
      modal.onClose()
      expect(keep).toHaveBeenCalledOnce()
    } finally {
      close.mockRestore()
      modal.containerEl.remove()
    }
  })

  it.each(['persisted-rejection', 'unpersisted-rejection', 'digest-failure'] as const)(
    'reviews %s through the registered action, keeping or discarding only local work',
    async (fault) => {
      const graph = planCanvasEdit(emptyCanvas(), [
        {
          op: 'add_node',
          node: { id: 'sample', kind: 'text', label: 'Original source', x: 0, y: 0 },
        },
      ])
      const { app, host, file, view, registry } = repairScenario(serializeCanvas(graph))
      await view.onOpen()
      await view.onLoadFile(file)
      ;(GlobalStore.getInstance() as unknown as { _app: App })._app = host
      const scope = new ScopeResolver()
      scope.setFullVaultAccess(true)
      const ctx = { scope, interactive: true },
        tools = createCanvasTools(),
        read = async () =>
          JSON.parse(
            (
              await tools
                .find((t) => t.name === 'canvas_read')!
                .execute('sample-read', { path: file.path, detail: 'full' }, undefined, ctx)
            ).content[0].text
          ),
        approved = await read(),
        originalProcess = app.vault.process.bind(app.vault)
      let digest: ReturnType<typeof vi.spyOn> | undefined
      const process = vi
        .spyOn(app.vault, 'process')
        .mockImplementationOnce(async (target, transform) => {
          if (fault === 'unpersisted-rejection') {
            transform(await app.vault.read(target))
            throw new Error('Sample unsettled source')
          }
          const result = await originalProcess(target, transform)
          if (fault === 'persisted-rejection') throw new Error('Sample unsettled source')
          digest = vi
            .spyOn(crypto.subtle, 'digest')
            .mockRejectedValueOnce(new Error('Sample local digest failure'))
          return result
        })
      try {
        await expect(
          tools
            .find((t) => t.name === 'canvas_edit')!
            .execute(
              'sample-edit',
              {
                path: file.path,
                revision: approved.revision,
                ops: [{ op: 'update', id: 'sample', patch: { text: 'Retained pending copy' } }],
              },
              undefined,
              ctx
            )
        ).rejects.toThrow()
      } finally {
        digest?.mockRestore()
      }
      const current = registry.find(file)!,
        session = current.session,
        retained = {
          draft: session.draft,
          evidence: session.publicationEvidence,
          baseline: session.committed,
          history: session.history,
          generation: session.generation,
        },
        before = await app.vault.read(file),
        acknowledge = vi.spyOn(session, 'acknowledge'),
        action = (
          view as unknown as { actionHandlers: Map<string, (event: MouseEvent) => unknown> }
        ).actionHandlers.get('Recover failed canvas change')!,
        click = (text: string) => {
          const button = [
            ...document.querySelectorAll<HTMLButtonElement>(
              '.abele-canvas-publication-review button'
            ),
          ].find((value) => value.textContent === text)
          expect(button).toBeTruthy()
          button!.click()
        },
        unchanged = () => {
          expect({
            draft: session.draft,
            evidence: session.publicationEvidence,
            baseline: session.committed,
            history: session.history,
            generation: session.generation,
          }).toEqual(retained)
        }
      process.mockClear()
      action(new MouseEvent('click'))
      await vi.waitFor(() =>
        expect(document.querySelector('.abele-canvas-publication-review')).not.toBeNull()
      )
      const modal = document.querySelector('.abele-canvas-publication-review')!
      expect(modal.textContent).toContain('Current persisted source')
      expect([...modal.querySelectorAll('summary')].at(-1)?.textContent).toBe(
        'Original baseline (historical)'
      )
      expect(modal.textContent).toContain('1 node, 0 connections.')
      expect(modal.querySelector('[data-review="source"]')?.textContent).toBe(before)
      expect(modal.querySelector('[data-review="proposed"]')?.textContent).toContain(
        'Retained pending copy'
      )
      expect(modal.querySelector('[data-review="baseline"]')?.textContent).toContain(
        'Original source'
      )
      expect(modal.textContent).toMatch(
        fault === 'digest-failure' ? /write was confirmed/i : /outcome is uncertain/i
      )
      unchanged()
      click('Keep retained work')
      expect(document.querySelector('.abele-canvas-publication-review')).toBeNull()
      unchanged()
      action(new MouseEvent('click'))
      await vi.waitFor(() =>
        expect(document.querySelector('.abele-canvas-publication-review')).not.toBeNull()
      )
      click('Discard local pending copy…')
      expect(document.querySelector('.abele-canvas-publication-review')!.textContent).toMatch(
        /does not undo/i
      )
      click('Cancel')
      expect(document.querySelector('.abele-canvas-publication-review')).toBeNull()
      unchanged()
      action(new MouseEvent('click'))
      await vi.waitFor(() =>
        expect(document.querySelector('.abele-canvas-publication-review')).not.toBeNull()
      )
      click('Discard local pending copy…')
      click('Discard local pending copy')
      await vi.waitFor(() => expect(session.dirty).toBe(false))
      expect(session.publicationEvidence).toBeNull()
      expect(session.history).toEqual(retained.history)
      expect(await app.vault.read(file)).toBe(before)
      expect(process).not.toHaveBeenCalled()
      expect(acknowledge).not.toHaveBeenCalled()
      const fresh = await read()
      await tools
        .find((t) => t.name === 'canvas_edit')!
        .execute(
          'sample-fresh',
          {
            path: file.path,
            revision: fresh.revision,
            ops: [{ op: 'update', id: 'sample', patch: { text: 'New independently chosen edit' } }],
          },
          undefined,
          ctx
        )
      expect(session.history.undo).toBe(1)
      expect(JSON.parse(await app.vault.read(file)).nodes[0].text).toBe(
        'New independently chosen edit'
      )
      await view.onClose()
    }
  )

  it.each(['retry', 'discard'] as const)(
    'exposes supported local %s recovery through the registered view action',
    async (action) => {
      const graph = planCanvasEdit(emptyCanvas(), [
        { op: 'add_node', node: { id: 'sample', kind: 'text', label: 'Original', x: 0, y: 0 } },
      ])
      const { app, host, file, view, registry } = repairScenario(serializeCanvas(graph))
      await view.onOpen()
      await view.onLoadFile(file)
      ;(GlobalStore.getInstance() as unknown as { _app: App })._app = host
      const scope = new ScopeResolver()
      scope.setFullVaultAccess(true)
      const ctx = { scope, interactive: true },
        tools = createCanvasTools()
      const read = JSON.parse(
        (
          await tools
            .find((tool) => tool.name === 'canvas_read')!
            .execute('sample-read', { path: file.path }, undefined, ctx)
        ).content[0].text
      )
      vi.spyOn(app.vault, 'process').mockRejectedValueOnce(new Error('Sample storage failure'))
      await expect(
        tools
          .find((tool) => tool.name === 'canvas_edit')!
          .execute(
            'sample-edit',
            {
              path: file.path,
              revision: read.revision,
              ops: [{ op: 'update', id: 'sample', patch: { text: 'Explicitly recovered' } }],
            },
            undefined,
            ctx
          )
      ).rejects.toThrow('Sample storage failure')
      const menus: Menu[] = []
      vi.spyOn(Menu.prototype, 'showAtMouseEvent').mockImplementation(function () {
        menus.push(this)
      })
      const handlers = (
        view as unknown as { actionHandlers: Map<string, (event: MouseEvent) => unknown> }
      ).actionHandlers
      handlers.get('Recover failed canvas change')!(new MouseEvent('click'))
      await vi.waitFor(() => expect(menus).toHaveLength(1))
      const items = (
        menus[0] as unknown as { items: { title: string; handler: () => Promise<void> }[] }
      ).items
      expect(items.map((item) => item.title)).toEqual([
        'Retry failed change',
        'Reapply failed change to current diagram',
        'Discard failed change',
      ])
      await items
        .find(
          (item) =>
            item.title === (action === 'retry' ? 'Retry failed change' : 'Discard failed change')
        )!
        .handler()
      const document = registry.find(file)!
      expect(document.session.dirty).toBe(false)
      expect(document.session.history.undo).toBe(action === 'retry' ? 1 : 0)
      expect(JSON.parse(await app.vault.read(file)).nodes[0].text).toBe(
        action === 'retry' ? 'Explicitly recovered' : 'Original'
      )
      await view.onClose()
    }
  )
  it('attaches an initially invalid leaf on ordinary own-file repair without reopening or writing', async () => {
    const { app, file, view, graph, registry } = repairScenario()
    await view.onOpen()
    await view.onLoadFile(file)
    expect(registry.find(file)).toBeUndefined()
    expect(view.viewer!.status.setText).toHaveBeenCalledWith(
      expect.stringMatching(/could not be read/i)
    )
    const raw = serializeCanvas(graph)
    await app.vault.modify(file, raw)
    app.emit('vault', 'modify', file)
    await vi.waitFor(() => expect(view.viewer!.graph).toEqual(graph))
    expect(registry.find(file)?.owners.size).toBe(1)
    expect(app.stats.modify).toBe(1)
    expect(await app.vault.read(file)).toBe(raw)
    await view.onClose()
  })

  it('ignores late initialization after close and does not reattach a closed invalid leaf on repair', async () => {
    const { app, file, view, graph, registry } = repairScenario()
    await view.onOpen()
    const entered = deferred(),
      finish = deferred<string>()
    vi.spyOn(app.vault, 'read').mockImplementationOnce(async () => {
      entered.resolve()
      return finish.promise
    })
    const opening = view.onLoadFile(file)
    await entered.promise
    await view.onClose()
    finish.resolve(serializeCanvas(graph))
    await opening
    await registry.flush(file)
    expect(view.viewer).toBeNull()
    expect(registry.find(file)).toBeUndefined()
    await app.vault.modify(file, serializeCanvas(graph))
    app.emit('vault', 'modify', file)
    await registry.flush(file)
    expect(registry.find(file)).toBeUndefined()
  })

  it('supersedes a delayed invalid initialization on repair and keeps later modify subscriptions alive', async () => {
    const { app, file, view, graph, registry } = repairScenario()
    await view.onOpen()
    const entered = deferred(),
      finish = deferred<string>()
    vi.spyOn(app.vault, 'read').mockImplementationOnce(async () => {
      entered.resolve()
      return finish.promise
    })
    const opening = view.onLoadFile(file)
    await entered.promise
    await app.vault.modify(file, serializeCanvas(graph))
    app.emit('vault', 'modify', file)
    finish.resolve('{malformed')
    await opening
    await vi.waitFor(() => expect(view.viewer!.graph).toEqual(graph))
    const next = planCanvasEdit(graph, [
      { op: 'update', id: 'sample', patch: { text: 'Later external change' } },
    ])
    await app.vault.modify(file, serializeCanvas(next))
    app.emit('vault', 'modify', file)
    await registry.flush(file)
    await vi.waitFor(() => expect(view.viewer!.graph).toEqual(next))
    expect(registry.find(file)?.owners.size).toBe(1)
    await view.onClose()
  })

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
