import { describe, expect, it, vi } from 'vitest'
import { Notice, TFile, type App } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'
import { CanvasViewer } from '@/canvas/Viewer'
import { hostCanvasEditor } from '@/canvas/editorControls'
import { ObsidianCanvasStore } from '@/canvas/obsidianStore'
import { parseCanvas, serializeCanvas } from '@/canvas/core/model'
import { planCanvasEdit } from '@/canvas/core/service'

const path = 'sample-history.canvas'
const graph = parseCanvas({
  nodes: [
    { id: 'sample-card', type: 'text', text: 'Initial', x: 0, y: 0, width: 200, height: 100 },
  ],
  edges: [],
})
const edit = (text: string) => (current: typeof graph) =>
  planCanvasEdit(current, [{ op: 'update', id: 'sample-card', patch: { text } }])

describe('human history click at the shared publication queue', () => {
  it('keeps an idle viewer and editor read-only and accepts the first agent write', async () => {
    const app = buildFakeVault([{ path, raw: serializeCanvas(graph) }]),
      host = app as unknown as App,
      store = new ObsidianCanvasStore(host),
      file = app.vault.getAbstractFileByPath(path) as TFile,
      owner = {}
    const lease = await store.open(file, owner)
    const el = document.createElement('div')
    document.body.append(el)
    const viewer = new CanvasViewer(el, {
      theme: () => ({}) as never,
      assets: async () => ({}),
      cards: { sync: () => new Set(), destroy: () => {} },
      openNode: () => {},
    })
    const editor = hostCanvasEditor(host, viewer, () => lease.document)
    lease.document.owners.set(owner, (current) => {
      viewer.load(current.session.graph)
      editor.refresh()
    })
    try {
      lease.document.notify()
      const snapshot = await store.snapshot(path)
      viewer.selection = new Set(['sample-card'])
      viewer.draw()
      editor.refresh()
      expect((await store.snapshot(path)).revision).toBe(snapshot.revision)
      expect(app.stats.modify).toBe(0)
      expect(lease.document.session.dirty).toBe(false)
      const result = await store.change(path, snapshot.revision, edit('First idle write'))
      expect(result.after.nodes[0].text).toBe('First idle write')
      expect(lease.document.session.history.undo).toBe(1)
    } finally {
      editor.destroy()
      viewer.destroy()
      el.remove()
      lease.release()
    }
  })

  it.each(['undo', 'redo'] as const)(
    '%s wins over an agent write not yet applied, which is refused, never undone',
    async (direction) => {
      const app = buildFakeVault([{ path, raw: serializeCanvas(graph) }])
      Object.assign(app, { workspace: { getLeavesOfType: () => [] } })
      const host = app as unknown as App,
        store = new ObsidianCanvasStore(host),
        file = app.vault.getAbstractFileByPath(path) as TFile,
        owner = {}
      const lease = await store.open(file, owner)
      let snapshot = await store.snapshot(path)
      let result = await store.change(path, snapshot.revision, edit('Seen command'))
      if (direction === 'redo') {
        result = await store.change(path, result.revision, edit('Seen later command'))
        await store.undo(path, result.revision)
      }
      const el = document.createElement('div')
      document.body.append(el)
      const viewer = new CanvasViewer(el, {
        theme: () => ({}) as never,
        assets: async () => ({}),
        cards: { sync: () => new Set(), destroy: () => {} },
        openNode: () => {},
      })
      const editor = hostCanvasEditor(host, viewer, () => lease.document)
      lease.document.owners.set(owner, (current) => {
        viewer.load(current.session.graph)
        editor.refresh()
      })
      lease.document.notify()
      const entered = deferred(),
        completion = deferred(),
        process = app.vault.process.bind(app.vault)
      const processSpy = vi
        .spyOn(app.vault, 'process')
        .mockImplementationOnce(async (target, transform) => {
          entered.resolve()
          await completion.promise
          return process(target, transform)
        })
      const historySpy = vi.spyOn(ObsidianCanvasStore.prototype, direction)
      Notice.shown.length = 0
      snapshot = await store.snapshot(path)
      const writing = store.change(path, snapshot.revision, edit('New agent command'))
      try {
        await entered.promise
        expect(lease.document.session.busy).toBe(false)
        const button = el.querySelector<HTMLButtonElement>(
          `[aria-label="${direction === 'undo' ? 'Undo' : 'Redo'} canvas change"]`
        )!
        // Undo runs in memory at once and wins over the agent write not yet applied, which is
        // refused as stale rather than landing under the person's undo.
        expect(button.disabled).toBe(false)
        button.click()
        completion.resolve()
        await expect(writing).rejects.toThrow(/stale|changed/i)
        expect(historySpy).not.toHaveBeenCalled()
        // Written with the next batch, after its pause.
        await vi.waitFor(() => expect(lease.document.session.dirty).toBe(false), { timeout: 5000 })
        const text = parseCanvas(await app.vault.read(file)).nodes[0].text
        expect(text).not.toBe('New agent command')
        expect(text).toBe(direction === 'undo' ? 'Initial' : 'Seen later command')
      } finally {
        completion.resolve()
        await writing.catch(() => undefined)
        processSpy.mockRestore()
        historySpy.mockRestore()
        editor.destroy()
        viewer.destroy()
        el.remove()
        lease.release()
      }
    }
  )
})
