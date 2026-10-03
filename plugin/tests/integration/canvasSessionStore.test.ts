import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'
import { canvasDocuments } from '@/canvas/documentRegistry'
import { ObsidianCanvasStore } from '@/canvas/obsidianStore'
import { planCanvasEdit } from '@/canvas/core/service'
import { parseCanvas, serializeCanvas } from '@/canvas/core/model'
import { createCanvasTools } from '@/ai/tools/CanvasTools'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '@/ai/ScopeResolver'

const path = 'sample-session.canvas'
const initial = parseCanvas({
  nodes: [
    {
      id: 'sample-card',
      type: 'text',
      text: 'Original',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      future: ['keep'],
    },
  ],
  edges: [],
  future: { value: 'preserve' },
})
const edit = (text: string) => (graph: typeof initial) =>
  planCanvasEdit(graph, [{ op: 'update', id: 'sample-card', patch: { text } }])
let app: ReturnType<typeof buildFakeVault>, host: App, store: ObsidianCanvasStore, file: TFile
let nativeLeaves: { view: unknown }[]
beforeEach(() => {
  app = buildFakeVault([{ path, raw: serializeCanvas(initial) }])
  nativeLeaves = []
  Object.assign(app, {
    workspace: { getLeavesOfType: (type: string) => (type === 'canvas' ? nativeLeaves : []) },
  })
  host = app as unknown as App
  store = new ObsidianCanvasStore(host)
  file = app.vault.getAbstractFileByPath(path) as TFile
})
const open = (listener = vi.fn()) => store.open(file, {}, listener)
const bytes = () => app.vault.read(file)
async function external(text: string) {
  await app.vault.modify(file, serializeCanvas(edit(text)(initial)))
  app.emit('vault', 'modify', file)
  await canvasDocuments(host).flush(file)
}
function native() {
  let data = initial
  const cancel = vi.fn(),
    pushHistory = vi.fn()
  const view = {
    file,
    requestSave: Object.assign(vi.fn(), { cancel }),
    canvas: {
      getData: () => data,
      requestPushHistory: { cancel: vi.fn() },
      pushHistory,
      history: { data: [initial], current: 0 },
    },
  }
  nativeLeaves.push({ view })
  return {
    view,
    cancel,
    pushHistory,
    set: (graph: typeof initial) => {
      data = graph
    },
  }
}

describe('shared canvas document storage', () => {
  it('shares one canonical session across leaves and does not write on open or reload', async () => {
    const left = await open(),
      right = await open()
    expect(left.document).toBe(right.document)
    expect(left.document.session.committed.graph).toEqual(initial)
    expect(app.stats.modify).toBe(0)
    left.document.beginDraft()
    left.document.updateDraft(edit('Pending text'))
    const snapshot = await store.snapshot(path)
    expect(snapshot.graph.nodes[0].text).toBe('Pending text')
    expect(snapshot.state).toMatchObject({ dirty: true, busy: true, conflict: false })
    await canvasDocuments(host).reload(file)
    expect(right.document.session.draft?.graph.nodes[0].text).toBe('Pending text')
    expect(app.stats.modify).toBe(0)
  })

  it('does not let a superseded lease for the same leaf unsubscribe its newer registration', async () => {
    const owner = {},
      firstListener = vi.fn(),
      secondListener = vi.fn()
    const first = await store.open(file, owner, firstListener)
    const second = await store.open(file, owner, secondListener)
    firstListener.mockClear()
    secondListener.mockClear()
    first.release()
    expect(second.document.owners.size).toBe(1)
    second.document.beginDraft()
    second.document.updateDraft(edit('Latest registration'))
    expect(secondListener).toHaveBeenCalled()
    expect(firstListener).not.toHaveBeenCalled()
    second.release()
    expect(canvasDocuments(host).find(file)).toBe(second.document)
  })

  it('blocks agent writes during active and finished human drafts, without implicitly committing text', async () => {
    const lease = await open()
    const before = await store.snapshot(path)
    lease.document.beginDraft()
    lease.document.updateDraft(edit('Human composition'))
    await expect(store.change(path, before.revision, edit('Agent'))).rejects.toThrow(
      /busy|pending|changed/i
    )
    lease.document.finishDraft()
    const draftRead = await store.snapshot(path)
    await expect(store.change(path, draftRead.revision, edit('Agent'))).rejects.toThrow(
      /busy|pending/i
    )
    expect(await bytes()).toBe(serializeCanvas(initial))
    expect(lease.document.session.history.undo).toBe(0)
  })

  it('invalidates delayed approval after a draft starts and is discarded even with identical graph bytes', async () => {
    const lease = await open()
    const approvedRead = await store.snapshot(path)
    lease.document.beginDraft()
    lease.document.discardDraft()
    const reread = await store.snapshot(path)
    expect(reread.graph).toEqual(approvedRead.graph)
    expect(reread.revision).not.toBe(approvedRead.revision)
    await expect(store.change(path, approvedRead.revision, edit('Delayed agent'))).rejects.toThrow(
      /changed|reread/i
    )
    expect(app.stats.modify).toBe(0)
  })

  it('publishes one human command and routes undo/redo through storage and one shared journal', async () => {
    const lease = await open(),
      second = await open()
    lease.document.beginDraft()
    lease.document.updateDraft(edit('First preview'))
    lease.document.updateDraft(edit('Final text'))
    lease.document.finishDraft()
    const written = await store.publishDraft(file)
    expect(written.after.nodes[0].text).toBe('Final text')
    expect(second.document.session.history).toEqual({ undo: 1, redo: 0 })
    expect(second.document.session.dirty).toBe(false)
    expect(parseCanvas(await bytes())).toEqual(written.after)
    const undone = await store.undo(path, written.revision)
    expect(parseCanvas(await bytes())).toEqual(initial)
    await store.redo(path, undone.revision)
    expect(parseCanvas(await bytes())).toEqual(written.after)
  })

  it('retains failed publication as a recoverable draft without advancing baseline or history', async () => {
    const lease = await open(),
      baseline = lease.document.session.committed
    const process = vi
      .spyOn(app.vault, 'process')
      .mockRejectedValueOnce(new Error('Sample storage unavailable'))
    const snapshot = await store.snapshot(path)
    await expect(store.change(path, snapshot.revision, edit('Recoverable batch'))).rejects.toThrow(
      'Sample storage unavailable'
    )
    expect(lease.document.session.committed).toEqual(baseline)
    expect(lease.document.session.draft?.graph.nodes[0].text).toBe('Recoverable batch')
    expect(lease.document.session.history.undo).toBe(0)
    expect(lease.document.session.busy).toBe(false)
    process.mockRestore()
    await store.publishDraft(file)
    expect(lease.document.session.history.undo).toBe(1)
  })

  it('rechecks draft generation at the final process boundary', async () => {
    const lease = await open(),
      snapshot = await store.snapshot(path)
    const original = app.vault.process.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementation(async (target, transform) => {
      lease.document.beginDraft()
      lease.document.updateDraft(edit('Human at boundary'))
      return original(target, transform)
    })
    await expect(store.change(path, snapshot.revision, edit('Agent'))).rejects.toThrow(
      /stale|changed|busy/i
    )
    expect(lease.document.session.draft?.graph.nodes[0].text).toBe('Human at boundary')
    expect(await bytes()).toBe(serializeCanvas(initial))
  })

  it('accepts only one concurrent batch using the same Abele read revision', async () => {
    const lease = await open(),
      snapshot = await store.snapshot(path)
    const results = await Promise.allSettled([
      store.change(path, snapshot.revision, edit('Agent one')),
      new ObsidianCanvasStore(host).change(path, snapshot.revision, edit('Agent two')),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(lease.document.session.history.undo).toBe(1)
    expect(lease.document.session.draft).toBeNull()
  })

  it('queues own modify observations until confirmation and never reloads over a pending draft', async () => {
    const listener = vi.fn(),
      lease = await open(listener)
    const original = app.vault.process.bind(app.vault),
      observed = deferred(),
      finish = deferred()
    vi.spyOn(app.vault, 'process').mockImplementation(async (target, transform) => {
      const result = await original(target, transform)
      app.emit('vault', 'modify', target)
      observed.resolve()
      await finish.promise
      return result
    })
    const snapshot = await store.snapshot(path)
    const writing = store.change(path, snapshot.revision, edit('Committed batch'))
    await observed.promise
    expect(lease.document.session.history.undo).toBe(0)
    expect(lease.document.session.busy).toBe(true)
    finish.resolve()
    await writing
    await canvasDocuments(host).flush(file)
    expect(lease.document.session.history.undo).toBe(1)
    expect(lease.document.session.conflict).toBe(false)
    lease.document.beginDraft()
    lease.document.updateDraft(edit('Later draft'))
    app.emit('vault', 'modify', file)
    await canvasDocuments(host).flush(file)
    expect(lease.document.session.draft?.graph.nodes[0].text).toBe('Later draft')
    expect(lease.document.session.conflict).toBe(false)
    expect(listener).toHaveBeenCalled()
  })

  it('returns the confirmed committed result if abort arrives after storage publication', async () => {
    const lease = await open(),
      snapshot = await store.snapshot(path),
      controller = new AbortController()
    const original = app.vault.process.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementation(async (target, transform) => {
      const result = await original(target, transform)
      controller.abort()
      return result
    })
    const result = await store.change(path, snapshot.revision, edit('Published'), controller.signal)
    expect(result.after.nodes[0].text).toBe('Published')
    expect(lease.document.session.history.undo).toBe(1)
    expect(lease.document.session.busy).toBe(false)
  })

  it('preserves an external conflict, blocks stale undo, and keeps dirty recovery after all leaves close', async () => {
    const lease = await open(),
      snapshot = await store.snapshot(path)
    const result = await store.change(path, snapshot.revision, edit('Local'))
    lease.document.beginDraft()
    lease.document.updateDraft(edit('Recovery draft'))
    await external('External version')
    expect(lease.document.session.conflict).toBe(true)
    expect(lease.document.session.draft?.graph.nodes[0].text).toBe('Recovery draft')
    lease.release()
    const reopened = await open()
    expect(reopened.document).toBe(lease.document)
    expect(reopened.document.session.draft?.graph.nodes[0].text).toBe('Recovery draft')
    expect(() => canvasDocuments(host).dispose()).toThrow(/draft|pending|dirty/i)
    reopened.document.discardDraft()
    await expect(store.undo(path, result.revision)).rejects.toThrow(/changed|conflict/i)
    expect(parseCanvas(await bytes()).nodes[0].text).toBe('External version')
    reopened.release()
    canvasDocuments(host).dispose()
  })

  it('retains canonical identity on rename and refuses an in-flight old-path publication', async () => {
    const lease = await open(),
      snapshot = await store.snapshot(path)
    const original = app.vault.process.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementationOnce(async (target, transform) => {
      await app.vault.rename(target, 'sample-renamed.canvas')
      app.emit('vault', 'rename', target, path)
      return original(target, transform)
    })
    await expect(store.change(path, snapshot.revision, edit('Old-path batch'))).rejects.toThrow(
      /renamed|changed/i
    )
    await canvasDocuments(host).flush(file)
    expect(file.path).toBe('sample-renamed.canvas')
    expect(lease.document.file).toBe(file)
    const reopened = await new ObsidianCanvasStore(host).open(file, {})
    expect(reopened.document).toBe(lease.document)
    expect(parseCanvas(await bytes())).toEqual(initial)
    expect(lease.document.session.draft?.graph.nodes[0].text).toBe('Old-path batch')
  })

  it('blocks a native editor that appears at publication without cancelling its pending save', async () => {
    const lease = await open(),
      snapshot = await store.snapshot(path)
    const original = app.vault.process.bind(app.vault)
    let nativeView: ReturnType<typeof native>
    vi.spyOn(app.vault, 'process').mockImplementation(async (target, transform) => {
      nativeView = native()
      return original(target, transform)
    })
    await expect(store.change(path, snapshot.revision, edit('Agent'))).rejects.toThrow(
      /native|writer|changed/i
    )
    expect(nativeView.cancel).not.toHaveBeenCalled()
    expect(nativeView.pushHistory).not.toHaveBeenCalled()
    expect(lease.document.session.draft?.graph.nodes[0].text).toBe('Agent')
    expect(await bytes()).toBe(serializeCanvas(initial))
  })

  it('reports a committed result when native reconciliation fails after storage success', async () => {
    const nativeView = native(),
      snapshot = await store.snapshot(path)
    const original = app.vault.process.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementation(async (target, transform) => {
      const result = await original(target, transform)
      vi.spyOn(nativeView.view.canvas, 'getData').mockImplementation(() => {
        throw new Error('Sample native reconciliation failure')
      })
      return result
    })
    const result = await store.change(path, snapshot.revision, edit('Confirmed native batch'))
    expect(result.after.nodes[0].text).toBe('Confirmed native batch')
    expect(result.warning).toMatch(/committed|reread/i)
    expect(parseCanvas(await bytes())).toEqual(result.after)
  })

  it('keeps native-only tools available while Abele leaves observe, but refuses dirty writer overlap', async () => {
    const nativeView = native(),
      lease = await open()
    expect(() => lease.document.beginDraft()).toThrow(/native/i)
    const snapshot = await store.snapshot(path)
    const original = app.vault.process.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementation(async (target, transform) => {
      const result = await original(target, transform)
      nativeView.set(parseCanvas(result))
      app.emit('vault', 'modify', target)
      return result
    })
    const result = await store.change(path, snapshot.revision, edit('Native batch'))
    expect(result.after.nodes[0].text).toBe('Native batch')
    expect(nativeView.cancel).toHaveBeenCalledOnce()
    expect(lease.document.session.history.undo).toBe(0)
    nativeLeaves.length = 0
    lease.document.beginDraft()
    lease.document.updateDraft(edit('Abele draft'))
    native()
    const pending = await store.snapshot(path)
    await expect(store.change(path, pending.revision, edit('Unsafe batch'))).rejects.toThrow(
      /native|writer|busy/i
    )
    expect(lease.document.session.draft?.graph.nodes[0].text).toBe('Abele draft')
  })

  it('exposes shared pending state through canvas_read without bypassing scope or write guards', async () => {
    const lease = await open()
    lease.document.beginDraft()
    lease.document.updateDraft(edit('Agent-visible human draft'))
    ;(GlobalStore.getInstance() as unknown as { _app: App })._app = host
    const scope = new ScopeResolver()
    scope.setFullVaultAccess(true)
    const tools = createCanvasTools(),
      read = tools.find((tool) => tool.name === 'canvas_read')!
    const result = JSON.parse(
      (
        await read.execute('sample-read', { path, detail: 'full' }, undefined, {
          scope,
          interactive: true,
        })
      ).content[0].text
    )
    expect(result.nodes[0].data.text).toBe('Agent-visible human draft')
    expect(result.state).toMatchObject({ dirty: true, busy: true })
    await expect(
      tools
        .find((tool) => tool.name === 'canvas_edit')!
        .execute(
          'sample-edit',
          {
            path,
            revision: result.revision,
            ops: [{ op: 'update', id: 'sample-card', patch: { text: 'Agent' } }],
          },
          undefined,
          { scope, interactive: true }
        )
    ).rejects.toThrow(/busy|pending/i)
  })

  it('does not acquire the human writer role when draft creation is refused during publication', async () => {
    const lease = await open(),
      snapshot = await store.snapshot(path)
    const original = app.vault.process.bind(app.vault),
      entered = deferred(),
      finish = deferred()
    vi.spyOn(app.vault, 'process').mockImplementation(async (target, transform) => {
      const result = await original(target, transform)
      entered.resolve()
      await finish.promise
      return result
    })
    const writing = store.change(path, snapshot.revision, edit('Agent publication'))
    await entered.promise
    let error: unknown
    try {
      lease.document.beginDraft()
    } catch (caught) {
      error = caught
    }
    let roleError: unknown
    try {
      lease.document.acquireWriter()
    } catch (caught) {
      roleError = caught
    }
    const writer = lease.document.writer
    finish.resolve()
    await writing
    expect(String(error)).toMatch(/busy/i)
    expect(String(roleError)).toMatch(/busy/i)
    expect(writer).toBe(false)
    expect(lease.document.session.history.undo).toBe(1)
  })

  it('pins canonical session identity when the final leaf closes during publication', async () => {
    const lease = await open(),
      snapshot = await store.snapshot(path)
    const original = app.vault.process.bind(app.vault),
      entered = deferred(),
      finish = deferred()
    vi.spyOn(app.vault, 'process').mockImplementation(async (target, transform) => {
      entered.resolve()
      await finish.promise
      return original(target, transform)
    })
    const writing = store.change(path, snapshot.revision, edit('Committed after close'))
    await entered.promise
    lease.release()
    const retained = canvasDocuments(host).find(file)
    let disposalError: unknown
    try {
      canvasDocuments(host).dispose()
    } catch (error) {
      disposalError = error
    }
    finish.resolve()
    const result = await writing
    expect(retained).toBe(lease.document)
    expect(String(disposalError)).toMatch(/pending|draft/i)
    expect(result.after.nodes[0].text).toBe('Committed after close')
    expect(lease.document.session.history.undo).toBe(1)
    expect(parseCanvas(await bytes())).toEqual(result.after)
    expect(canvasDocuments(host).find(file)).toBeUndefined()
  })

  it.each(['{malformed', JSON.stringify(JSON.stringify(initial))])(
    'does not hide invalid persisted bytes behind a valid native snapshot %#',
    async (raw) => {
      await app.vault.modify(file, raw)
      const nativeView = native()
      await expect(open()).rejects.toThrow()
      await expect(store.snapshot(path)).rejects.toThrow()
      expect(await bytes()).toBe(raw)
      expect(nativeView.cancel).not.toHaveBeenCalled()
      expect(nativeView.pushHistory).not.toHaveBeenCalled()
    }
  )

  it.each(['', '{}'])(
    'publishes the first explicit edit of native empty file bytes %j',
    async (raw) => {
      await app.vault.modify(file, raw)
      const lease = await open(),
        snapshot = await store.snapshot(path)
      expect(await bytes()).toBe(raw)
      const result = await store.change(path, snapshot.revision, (graph) =>
        planCanvasEdit(graph, [
          {
            op: 'add_node',
            node: { id: 'sample-first', kind: 'text', label: 'First explicit edit', x: 0, y: 0 },
          },
        ])
      )
      expect(result.after.nodes).toHaveLength(1)
      expect(parseCanvas(await bytes())).toEqual(result.after)
      expect(lease.document.session.history.undo).toBe(1)
    }
  )

  it.each(['', '{}', '  \n'])(
    'uses shared empty-file semantics without relaxing graph validation or rewriting bytes (%j)',
    async (raw) => {
      await app.vault.modify(file, raw)
      expect(() => parseCanvas(raw)).toThrow()
      if (raw === '' || raw === '{}') {
        const lease = await open()
        expect(lease.document.session.graph).toEqual({ nodes: [], edges: [] })
        expect((await store.snapshot(path)).graph).toEqual({ nodes: [], edges: [] })
      } else await expect(open()).rejects.toThrow()
      expect(await bytes()).toBe(raw)
    }
  )
})
