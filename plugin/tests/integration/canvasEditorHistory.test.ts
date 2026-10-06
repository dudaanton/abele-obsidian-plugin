import { describe, expect, it, vi } from 'vitest'
import { Notice, TFile, type App } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'
import { CanvasViewer } from '@/canvas/Viewer'
import { hostCanvasEditor } from '@/canvas/editorControls'
import { ObsidianCanvasStore } from '@/canvas/obsidianStore'
import { canvasDocuments } from '@/canvas/documentRegistry'
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
  it.each(['undo', 'redo'] as const)(
    'refuses %s if an earlier queued save changes the history after the click',
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
        expect(button.disabled).toBe(false)
        button.click()
        completion.resolve()
        await writing
        await canvasDocuments(host).flush(file)
        await vi.waitFor(() =>
          expect(
            el.querySelector<HTMLButtonElement>('[aria-label="Add text card"]')!.disabled
          ).toBe(false)
        )
        expect(historySpy).not.toHaveBeenCalled()
        await vi.waitFor(() =>
          expect(Notice.shown).toContainEqual(expect.stringMatching(/canvas changed.*try again/i))
        )
        expect(parseCanvas(await app.vault.read(file)).nodes[0].text).toBe('New agent command')
        expect(lease.document.session.history).toEqual({ undo: 2, redo: 0 })
      } finally {
        completion.resolve()
        await writing
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
