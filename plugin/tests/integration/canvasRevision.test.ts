import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { TFile } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { createCanvasTools } from '@/ai/tools/CanvasTools'
import { ObsidianCanvasStore } from '@/canvas/obsidianStore'
import { parseCanvas } from '@/canvas/core/model'

const path = 'sample-revision.canvas'
const initial = {
  nodes: [
    { id: 'alpha', type: 'text', text: 'Original sample', x: 0, y: 0, width: 260, height: 160 },
  ],
  edges: [],
}
let app: ReturnType<typeof buildFakeVault>, scope: ScopeResolver
const call = (name: string, params: Record<string, unknown>) =>
  createCanvasTools()
    .find((t) => t.name === name)!
    .execute('sample-call', params, undefined, { scope, interactive: true })
beforeEach(() => {
  app = buildFakeVault([{ path, raw: JSON.stringify(initial) }])
  ;(GlobalStore.getInstance() as unknown as { _app: App })._app = app as unknown as App
  scope = new ScopeResolver()
  scope.setFullVaultAccess(true)
})
const read = async () => JSON.parse((await call('canvas_read', { path })).content[0].text)
const ops = [{ op: 'update', id: 'alpha', patch: { text: 'Agent sample' } }]

describe('canvas optimistic writes', () => {
  it.each(['canvas_edit', 'canvas_layout'])(
    'refuses stale %s without modifying a competing version',
    async (name) => {
      const snapshot = await read()
      const file = app.vault.getAbstractFileByPath(path) as TFile
      const updated = structuredClone(initial)
      updated.nodes[0].text = 'Owner sample'
      const bytes = JSON.stringify(updated)
      await app.vault.modify(file, bytes)
      await expect(
        call(name, {
          path,
          revision: snapshot.revision,
          ...(name === 'canvas_edit' ? { ops } : {}),
        })
      ).rejects.toThrow(/changed.*read|reread/i)
      expect(await app.vault.read(file)).toBe(bytes)
    }
  )
  it('refuses an unsaved native edit after the agent read, before any native save/history action', async () => {
    const data = structuredClone(initial),
      save = vi.fn(async () => {}),
      pushHistory = vi.fn()
    const file = app.vault.getAbstractFileByPath(path) as TFile
    Object.assign(app, {
      workspace: {
        getLeavesOfType: () => [
          {
            view: {
              file,
              save,
              canvas: {
                getData: () => data,
                pushHistory,
                history: { data: [initial], current: 0 },
                requestSave: vi.fn(),
                requestPushHistory: { cancel: vi.fn() },
              },
            },
          },
        ],
      },
    })
    const snapshot = await read()
    data.nodes[0].text = 'Unsaved owner sample'
    await expect(call('canvas_edit', { path, revision: snapshot.revision, ops })).rejects.toThrow(
      /changed.*read|reread/i
    )
    expect(data.nodes[0].text).toBe('Unsaved owner sample')
    expect(save).not.toHaveBeenCalled()
    expect(pushHistory).not.toHaveBeenCalled()
    expect(await app.vault.read(file)).toBe(JSON.stringify(initial))
  })
  it('checks the expected version inside vault.process, not just before it', async () => {
    const snapshot = await read(),
      file = app.vault.getAbstractFileByPath(path) as TFile
    const original = app.vault.process.bind(app.vault)
    const changed = structuredClone(initial)
    changed.nodes[0].text = 'Boundary owner sample'
    vi.spyOn(app.vault, 'process').mockImplementation(async (f, transform) => {
      await app.vault.modify(file, JSON.stringify(changed))
      return original(f, transform)
    })
    await expect(call('canvas_edit', { path, revision: snapshot.revision, ops })).rejects.toThrow(
      /changed.*read|reread/i
    )
    expect(parseCanvas(await app.vault.read(file)).nodes[0].text).toBe('Boundary owner sample')
  })
  it('accepts only one of two writes based on the same read', async () => {
    const snapshot = await read()
    const results = await Promise.allSettled([
      call('canvas_edit', { path, revision: snapshot.revision, ops }),
      call('canvas_edit', {
        path,
        revision: snapshot.revision,
        ops: [{ op: 'update', id: 'alpha', patch: { text: 'Second agent sample' } }],
      }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.message
    ).toMatch(/changed.*read|reread/i)
  })
  it('requires a revision and returns the new revision for a successful write', async () => {
    await expect(call('canvas_edit', { path, ops })).rejects.toThrow(/revision/i)
    const snapshot = await read()
    expect(snapshot.revision).toMatch(/^canvas-/)
    const result = JSON.parse(
      (await call('canvas_edit', { path, revision: snapshot.revision, ops })).content[0].text
    )
    expect(result.revision).toMatch(/^canvas-/)
    expect(result.revision).not.toBe(snapshot.revision)
    await expect(call('canvas_edit', { path, revision: snapshot.revision, ops })).rejects.toThrow(
      /changed.*read|reread/i
    )
    expect(await new ObsidianCanvasStore(app as unknown as App).read(path)).toMatchObject({
      nodes: [{ text: 'Agent sample' }],
    })
  })
})
