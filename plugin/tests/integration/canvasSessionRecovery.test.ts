import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { ObsidianCanvasStore } from '@/canvas/obsidianStore'
import { canvasDocuments } from '@/canvas/documentRegistry'
import { createCanvasTools } from '@/ai/tools/CanvasTools'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { parseCanvas, serializeCanvas } from '@/canvas/core/model'
import { planCanvasEdit } from '@/canvas/core/service'

const path = 'sample-recovery.canvas'
const original = parseCanvas({
  nodes: [
    {
      id: 'sample',
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
  future: { keep: true },
})
const ops = [{ op: 'update', id: 'sample', patch: { text: 'Recovered change' } }]
let app: ReturnType<typeof buildFakeVault>,
  host: App,
  file: TFile,
  store: ObsidianCanvasStore,
  scope: ScopeResolver
beforeEach(() => {
  app = buildFakeVault([{ path, raw: serializeCanvas(original) }])
  host = app as unknown as App
  file = app.vault.getAbstractFileByPath(path) as TFile
  store = new ObsidianCanvasStore(host)
  ;(GlobalStore.getInstance() as unknown as { _app: App })._app = host
  scope = new ScopeResolver()
  scope.setFullVaultAccess(true)
})
async function call(
  name: string,
  params: Record<string, unknown>,
  agentId = 'sample-agent',
  selectedScope = scope
) {
  return createCanvasTools()
    .find((tool) => tool.name === name)!
    .execute('sample-call', params, undefined, { scope: selectedScope, interactive: true, agentId })
}
const read = async () =>
  JSON.parse((await call('canvas_read', { path, detail: 'full' })).content[0].text)
async function fail(name = 'canvas_edit', input: Record<string, unknown> = { ops }) {
  const snapshot = await read()
  vi.spyOn(app.vault, 'process').mockRejectedValueOnce(new Error('Sample write failure'))
  await expect(call(name, { path, revision: snapshot.revision, ...input })).rejects.toThrow(
    'Sample write failure'
  )
  return read()
}

describe('supported canvas recovery and approval lifetime', () => {
  it.each(
    (['native-viewer', 'native-only', 'closed'] as const).flatMap((mode) =>
      [
        ['canvas_edit', { ops }],
        ['canvas_layout', { algorithm: 'grid' }],
        [
          'canvas_steps',
          {
            ops: [
              { op: 'replace', steps: [{ id: 'sample-step', reveal: ['sample'], say: 'Sample' }] },
            ],
          },
        ],
      ].map(([tool, input]) => ({ mode, tool: tool as string, input: input as object }))
    )
  )(
    'reports uncertain $tool publication in $mode and refuses the old revision',
    async ({ mode, tool, input }) => {
      if (mode !== 'closed') {
        const leaves = [
          {
            view: {
              file,
              canvas: {
                getData: () => original,
                requestPushHistory: { cancel: vi.fn() },
                pushHistory: vi.fn(),
                history: { data: [original], current: 0 },
              },
            },
          },
        ]
        Object.assign(app, { workspace: { getLeavesOfType: () => leaves } })
      }
      if (mode === 'native-viewer') await store.open(file, {})
      const approved = await read(),
        process = app.vault.process.bind(app.vault)
      const writes = vi
        .spyOn(app.vault, 'process')
        .mockImplementationOnce(async (target, transform) => {
          await process(target, transform)
          throw new Error('Sample uncertain tool publication')
        })
      await expect(
        call(tool, { path, revision: approved.revision, ...input })
      ).rejects.toMatchObject({
        outcome: 'unknown',
        message: expect.stringMatching(/uncertain.*canvas_read.*compare.*before.*edit/i),
      })
      const persisted = await app.vault.read(file)
      expect(persisted).not.toBe(serializeCanvas(original))
      const pending = await read()
      if (mode === 'native-viewer') {
        expect(pending.state).toMatchObject({ publicationOutcome: 'unknown', dirty: true })
        expect(pending.state.recovery).toBeUndefined()
      } else expect(pending.state).toBeUndefined()
      await expect(call(tool, { path, revision: approved.revision, ...input })).rejects.toThrow(
        /changed|reread/i
      )
      expect(writes).toHaveBeenCalledOnce()
      expect(await app.vault.read(file)).toBe(persisted)
    }
  )

  it.each([
    'persisted-rejection',
    'transform-returned-rejection',
    'confirmed-digest-failure',
  ] as const)(
    'reports %s through the public edit tool without offering a known-no-write proposal',
    async (fault) => {
      const lease = await store.open(file, {}),
        approved = await read(),
        baseline = lease.document.session.committed,
        process = app.vault.process.bind(app.vault),
        reject = vi.spyOn(lease.document.session, 'reject')
      let digest: ReturnType<typeof vi.spyOn> | undefined
      vi.spyOn(app.vault, 'process').mockImplementationOnce(async (target, transform) => {
        if (fault === 'transform-returned-rejection') {
          transform(await app.vault.read(target))
          throw new Error('Sample unconfirmed write outcome')
        }
        const published = await process(target, transform)
        if (fault === 'persisted-rejection') throw new Error('Sample unconfirmed write outcome')
        digest = vi
          .spyOn(crypto.subtle, 'digest')
          .mockRejectedValueOnce(new Error('Sample local digest failure'))
        return published
      })
      const outcome =
        fault === 'confirmed-digest-failure' ? 'written-acknowledgment-pending' : 'unknown'
      try {
        await expect(
          call('canvas_edit', { path, revision: approved.revision, ops })
        ).rejects.toMatchObject({ outcome })
      } finally {
        digest?.mockRestore()
      }
      expect(await app.vault.read(file)).toBe(
        fault === 'transform-returned-rejection'
          ? serializeCanvas(original)
          : serializeCanvas(planCanvasEdit(original, ops))
      )
      expect(reject).not.toHaveBeenCalled()
      expect(lease.document.session.committed).toEqual(baseline)
      expect(lease.document.session.history).toEqual({ undo: 0, redo: 0 })
      const pending = await read()
      expect(pending.state).toMatchObject({
        publicationOutcome: outcome,
        conflict: true,
        dirty: true,
        busy: false,
      })
      expect(pending.state.recovery).toBeUndefined()
      expect(pending.nodes[0].data.text).toBe('Recovered change')
      await expect(
        call('canvas_edit', {
          path,
          revision: pending.revision,
          recovery: 'retry',
          proposal: 'sample-obsolete',
        })
      ).rejects.toThrow(/proposal|recovery/i)
      await expect(call('canvas_edit', { path, revision: pending.revision, ops })).rejects.toThrow(
        /conflict/i
      )
    }
  )

  it('revokes an owned retry proposal if the retry returns bytes but storage then rejects', async () => {
    const lease = await store.open(file, {}),
      pending = await fail(),
      process = app.vault.process.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementationOnce(async (target, transform) => {
      await process(target, transform)
      throw new Error('Sample uncertain retry outcome')
    })
    await expect(
      call('canvas_edit', {
        path,
        revision: pending.revision,
        recovery: 'retry',
        proposal: pending.state.recovery.proposal,
      })
    ).rejects.toMatchObject({ outcome: 'unknown' })
    expect(parseCanvas(await app.vault.read(file)).nodes[0].text).toBe('Recovered change')
    expect(lease.document.session.history.undo).toBe(0)
    const current = await read()
    expect(current.state.recovery).toBeUndefined()
    expect(current.state.publicationOutcome).toBe('unknown')
    await expect(
      call('canvas_edit', {
        path,
        revision: current.revision,
        recovery: 'reapply',
        proposal: pending.state.recovery.proposal,
      })
    ).rejects.toThrow(/proposal|recovery/i)
  })

  it.each(['canvas_edit', 'canvas_layout', 'canvas_steps'])(
    'keeps %s provider parameters an object with discoverable recovery fields',
    (name) => {
      const parameters = createCanvasTools().find((tool) => tool.name === name)!
        .parameters as Record<string, unknown>
      expect(parameters.type).toBe('object')
      expect(parameters.properties).toHaveProperty('path')
      expect(parameters.properties).toHaveProperty('recovery')
      expect(parameters.required).toEqual(expect.arrayContaining(['path', 'revision']))
    }
  )
  it.each([
    ['canvas_edit', { ops }],
    ['canvas_layout', { algorithm: 'grid' }],
    [
      'canvas_steps',
      {
        ops: [
          {
            op: 'replace',
            steps: [{ id: 'sample-step', reveal: ['sample'], say: 'Sample narration' }],
          },
        ],
      },
    ],
  ] as const)(
    'recovers a failed %s through its existing production tool after close/reopen',
    async (name, input) => {
      const lease = await store.open(file, {})
      const pending = await fail(name, input)
      expect(pending.state.recovery).toMatchObject({
        tool: name,
        actions: expect.arrayContaining(['retry', 'reapply', 'discard']),
      })
      expect(pending.state.recovery.proposal).toBeTruthy()
      expect(await app.vault.read(file)).toBe(serializeCanvas(original))
      await expect(call(name, { path, revision: pending.revision, ...input })).rejects.toThrow(
        /busy|pending/i
      )
      lease.release()
      const reopened = await store.open(file, {})
      expect(reopened.document).toBe(lease.document)
      const current = await read()
      await call(name, {
        path,
        revision: current.revision,
        recovery: 'retry',
        proposal: current.state.recovery.proposal,
      })
      expect(reopened.document.session.dirty).toBe(false)
      expect(reopened.document.session.history.undo).toBe(1)
      expect((await read()).state.recovery).toBeUndefined()
      await expect(
        call(name, {
          path,
          revision: current.revision,
          recovery: 'retry',
          proposal: current.state.recovery.proposal,
        })
      ).rejects.toThrow(/changed|proposal|reread/i)
    }
  )

  it('retains owned recovery after a second known no-write failure at the publication boundary', async () => {
    const lease = await store.open(file, {}),
      pending = await fail()
    const apply = vi.spyOn(lease.document.session, 'apply')
    vi.spyOn(app.vault, 'process').mockImplementationOnce(async () => {
      // No output reached storage: ordinary retry remains valid for this attempt.
      throw new Error('Sample boundary persistence failure')
    })
    await expect(
      call('canvas_edit', {
        path,
        revision: pending.revision,
        recovery: 'retry',
        proposal: pending.state.recovery.proposal,
      })
    ).rejects.toThrow('Sample boundary persistence failure')
    const second = await read()
    expect(apply).not.toHaveBeenCalled()
    expect(second.state.recovery.proposal).not.toBe(pending.state.recovery.proposal)
    expect(lease.document.session.history.undo).toBe(0)
    expect(lease.document.session.busy).toBe(false)
    expect(await app.vault.read(file)).toBe(serializeCanvas(original))
    await call('canvas_edit', {
      path,
      revision: second.revision,
      recovery: 'retry',
      proposal: second.state.recovery.proposal,
    })
    expect(lease.document.session.history.undo).toBe(1)
  })

  it('does not label a human draft arriving at the storage boundary as failed agent recovery', async () => {
    const lease = await store.open(file, {}),
      approved = await read()
    const process = app.vault.process.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementationOnce(async (target, transform) => {
      lease.document.beginDraft()
      lease.document.updateDraft((graph) =>
        planCanvasEdit(graph, [
          { op: 'update', id: 'sample', patch: { text: 'Human boundary draft' } },
        ])
      )
      return process(target, transform)
    })
    await expect(call('canvas_edit', { path, revision: approved.revision, ops })).rejects.toThrow(
      /stale|changed/i
    )
    const pending = await read()
    expect(pending.state.recovery).toBeUndefined()
    expect(pending.nodes[0].data.text).toBe('Human boundary draft')
    expect(await app.vault.read(file)).toBe(serializeCanvas(original))
  })

  it('requires rereading and semantic reapplication after external change, preserving new extensions', async () => {
    const lease = await store.open(file, {})
    const pending = await fail()
    const external = {
      ...original,
      future: { keep: true, external: 'new' },
      nodes: original.nodes.map((node) => ({ ...node, x: 42 })),
    }
    await app.vault.modify(file, serializeCanvas(external))
    app.emit('vault', 'modify', file)
    await canvasDocuments(host).flush(file)
    const recovery = await read(),
      proposal = recovery.state.recovery.proposal
    await expect(
      call('canvas_edit', { path, revision: pending.revision, recovery: 'reapply', proposal })
    ).rejects.toThrow(/changed|reread/i)
    await expect(
      call('canvas_edit', { path, revision: recovery.revision, recovery: 'retry', proposal })
    ).rejects.toThrow(/conflict|changed/i)
    expect(await app.vault.read(file)).toBe(serializeCanvas(external))
    await call('canvas_edit', { path, revision: recovery.revision, recovery: 'reapply', proposal })
    const graph = parseCanvas(await app.vault.read(file))
    expect(graph.nodes[0].text).toBe('Recovered change')
    expect(graph.nodes[0].x).toBe(42)
    expect(graph.future).toEqual(external.future)
    expect(lease.document.session.history.undo).toBe(1)
  })

  it('explicitly discards only the owned failed proposal without a storage write and unblocks a fresh batch', async () => {
    const lease = await store.open(file, {})
    const pending = await fail(),
      before = await app.vault.read(file)
    const writes = vi.spyOn(app.vault, 'process')
    writes.mockClear()
    await call('canvas_edit', {
      path,
      revision: pending.revision,
      recovery: 'discard',
      proposal: pending.state.recovery.proposal,
    })
    expect(writes).not.toHaveBeenCalled()
    expect(await app.vault.read(file)).toBe(before)
    expect(lease.document.session.dirty).toBe(false)
    expect(lease.document.session.history.undo).toBe(0)
    await call('canvas_edit', { path, revision: (await read()).revision, ops })
    expect(lease.document.session.history.undo).toBe(1)
  })

  it('does not let another agent, another tool, or an out-of-scope call recover the proposal', async () => {
    const lease = await store.open(file, {})
    const pending = await fail(),
      request = {
        path,
        revision: pending.revision,
        recovery: 'discard',
        proposal: pending.state.recovery.proposal,
      }
    await expect(call('canvas_edit', request, 'sample-other-agent')).rejects.toThrow(
      /owner|belongs/i
    )
    await expect(call('canvas_layout', request)).rejects.toThrow(/tool|belongs/i)
    const denied = new ScopeResolver()
    await expect(call('canvas_edit', request, 'sample-agent', denied)).rejects.toThrow(
      /scope|denied/i
    )
    expect(lease.document.session.draft?.graph.nodes[0].text).toBe('Recovered change')
    expect(await app.vault.read(file)).toBe(serializeCanvas(original))
  })

  it('never claims a later human draft as recoverable agent work', async () => {
    const lease = await store.open(file, {})
    const pending = await fail(),
      proposal = pending.state.recovery.proposal
    lease.document.beginDraft()
    lease.document.updateDraft((graph) =>
      planCanvasEdit(graph, [{ op: 'update', id: 'sample', patch: { text: 'Human draft' } }])
    )
    lease.document.finishDraft()
    const current = await read()
    expect(current.state.recovery).toBeUndefined()
    await expect(
      call('canvas_edit', { path, revision: current.revision, recovery: 'discard', proposal })
    ).rejects.toThrow(/proposal|human|recovery/i)
    expect(lease.document.session.draft?.graph.nodes[0].text).toBe('Human draft')
    expect(await app.vault.read(file)).toBe(serializeCanvas(original))
  })

  it('retains the original structured operation rather than caller mutations after failure', async () => {
    await store.open(file, {})
    const input = { ops: [{ op: 'update', id: 'sample', patch: { abele: { sampleValues: [1] } } }] }
    const pending = await fail('canvas_edit', input)
    input.ops[0].patch.abele.sampleValues.push(2)
    await call('canvas_edit', {
      path,
      revision: pending.revision,
      recovery: 'reapply',
      proposal: pending.state.recovery.proposal,
    })
    expect(parseCanvas(await app.vault.read(file)).nodes[0].abele?.sampleValues).toEqual([1])
  })

  it('keeps a failed semantic reapplication recoverable rather than replacing unrelated external content', async () => {
    await store.open(file, {})
    await fail()
    const external = { nodes: [], edges: [], future: { current: true } }
    await app.vault.modify(file, serializeCanvas(external))
    app.emit('vault', 'modify', file)
    await canvasDocuments(host).flush(file)
    const pending = await read()
    await expect(
      call('canvas_edit', {
        path,
        revision: pending.revision,
        recovery: 'reapply',
        proposal: pending.state.recovery.proposal,
      })
    ).rejects.toThrow(/unknown id/i)
    expect(await app.vault.read(file)).toBe(serializeCanvas(external))
    expect((await read()).state.recovery.proposal).toBe(pending.state.recovery.proposal)
  })

  it('never revives an old public approval revision after begin/discard, last-lease pruning and reopening', async () => {
    const lease = await store.open(file, {}),
      approved = await read()
    lease.document.beginDraft()
    lease.document.discardDraft()
    lease.release()
    expect(canvasDocuments(host).find(file)).toBeUndefined()
    const reopened = await store.open(file, {}),
      current = await read()
    expect(current.nodes).toEqual(approved.nodes)
    expect(current.revision).not.toBe(approved.revision)
    await expect(call('canvas_edit', { path, revision: approved.revision, ops })).rejects.toThrow(
      /changed|reread/i
    )
    expect(reopened.document.session.history.undo).toBe(0)
    expect(await app.vault.read(file)).toBe(serializeCanvas(original))
  })

  it.each(['sample#1.canvas', 'sample[board].canvas', 'sample^draft.canvas'])(
    'opens and internally publishes canonical imported name %s while keeping agent path guards',
    async (name) => {
      await app.vault.rename(file, name)
      const lease = await store.open(file, {})
      expect(lease.document.session.graph).toEqual(original)
      await expect(store.snapshot(name)).rejects.toThrow(/safe|path/i)
      lease.document.beginDraft()
      lease.document.updateDraft((graph) => planCanvasEdit(graph, ops))
      lease.document.finishDraft()
      await store.publishDraft(file)
      expect(parseCanvas(await app.vault.read(file)).nodes[0].text).toBe('Recovered change')
      const next = 'sample#renamed[board]^2.canvas'
      await app.vault.rename(file, next)
      app.emit('vault', 'rename', file, name)
      await canvasDocuments(host).flush(file)
      expect((await store.open(file, {})).document).toBe(lease.document)
      expect(lease.document.file.path).toBe(next)
    }
  )
})
