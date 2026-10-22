import { expect, it, vi } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  pull,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it.each([false, true].flatMap((config) => [false, true].map((cached) => ({ config, cached }))))(
  'uses the sibling observation clock for a later local write (config=$config, cached=$cached)',
  async ({ config, cached }) => {
    const paths = config ? ['.obsidian/a.json', '.obsidian/b.json'] : ['a.md', 'b.md']
    const content = 'sample local bytes'
    const bytes = new TextEncoder().encode(content)
    const sha = await sha256(bytes)
    const app = buildFakeVault([{ path: paths[0], content }])
    const fs = new ObsidianFileSystem(app as never)
    const state = new MemoryStateStore()
    await state.setCursor(1)
    const byFileId = state.byFileId.bind(state)
    let injected = false
    vi.spyOn(state, 'byFileId').mockImplementation(async (id) => {
      if (id === (cached ? 'sample-0' : 'sample-1') && !injected) {
        injected = true
        await app.vault.adapter.write(paths[1], content)
        // Config writes deliberately have no vault event.
        if (!config) app.emit('vault', 'create', { path: paths[1] })
      }
      return byFileId(id)
    })
    const items = paths.map((path, i) => ({
      seq: i + 2,
      file_id: `sample-${i}`,
      version_id: 'created',
      path,
      prev_path: null,
      op: 'create',
      sha,
      size: bytes.length,
      mtime: 1000,
      kind: 'note',
      at: '',
      actor: { kind: 'system', id: 'sample', name: 'Sample' },
    }))
    const openVersion = vi.fn(async () => {
      throw new Error('Content offline')
    })
    const getBlob = vi.fn(async () => {
      throw new Error('Content offline')
    })
    const stage = vi.spyOn(fs, 'beginAtomicWrite')
    await Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1')).call(fs, async () => {
      if (cached) await fs.listChildren(config ? '.obsidian' : '')
      return pull(
        {
          changes: async () => ({ items, head_seq: 3, next_since: 3 }),
          openVersion,
          getBlob,
        } as unknown as EngineClient,
        fs,
        state,
        { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } }
      )
    })
    expect(injected).toBe(true)
    expect(openVersion).not.toHaveBeenCalled()
    expect(getBlob).not.toHaveBeenCalled()
    expect(stage).not.toHaveBeenCalled()
    for (const item of items) {
      expect(await fs.read(item.path)).toEqual(bytes)
      expect(await state.byFileId(item.file_id)).toMatchObject({ path: item.path, sha })
    }
    expect(await state.getCursor()).toBe(3)
  }
)

it.each(
  [true, false].flatMap((signal) =>
    (['before-request', 'open-failure', 'read-failure', 'cancelled'] as const).map((boundary) => ({
      signal,
      boundary,
    }))
  )
)(
  'adopts a same-page local write with content offline ($boundary, signal=$signal)',
  async ({ boundary, signal }) => {
    const fs = new MemoryFileSystem()
    const state = new MemoryStateStore()
    const bytes = new TextEncoder().encode('sample local content')
    const sha = await sha256(bytes)
    await state.setCursor(1)
    await fs.writeAtomic('b.md', bytes, 1000)
    const stat = fs.stat.bind(fs)
    let injected = false
    const inject = async () => {
      await fs.writeAtomic('a.md', bytes, 1000)
      injected = true
    }
    const stage = vi.fn(async () => {
      throw new Error('Local content must not be staged')
    })
    Object.assign(fs, {
      ...(signal
        ? {
            [Symbol.for('abele.sync.local-change-revision-v1')]: (path: string) =>
              path === 'a.md' && injected ? 1 : 0,
          }
        : {}),
      beginAtomicWrite: stage,
      reopenStage: stage,
      stat: async (path: string) => {
        if (path === 'b.md' && boundary === 'before-request' && !injected) await inject()
        return stat(path)
      },
    })
    const close = vi.fn(async () => {})
    const openVersion = vi.fn(async () => {
      await inject()
      if (boundary === 'before-request' || boundary === 'open-failure')
        throw new Error('Content offline')
      const controller = new AbortController()
      if (boundary === 'cancelled') controller.abort(new Error('Content cancelled'))
      return {
        size: bytes.length,
        signal: controller.signal,
        read: async () => {
          throw new Error('Content offline')
        },
        assertUnchanged: async () => {},
        close,
      }
    })
    const getBlob = vi.fn(async () => {
      throw new Error('Content offline')
    })
    const items = ['a.md', 'b.md'].map((path, i) => ({
      seq: i + 2,
      file_id: `sample-${i}`,
      version_id: 'created',
      path,
      prev_path: null,
      op: 'create',
      sha,
      size: bytes.length,
      mtime: 1000,
      kind: 'note',
      at: '',
      actor: { kind: 'system', id: 'sample', name: 'Sample' },
    }))
    await pull(
      {
        changes: async () => ({ items, head_seq: 3, next_since: 3 }),
        openVersion,
        getBlob,
      } as unknown as EngineClient,
      fs,
      state,
      { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } }
    )
    expect(injected).toBe(true)
    expect(openVersion).toHaveBeenCalledTimes(boundary === 'before-request' && signal ? 0 : 1)
    expect(close).toHaveBeenCalledTimes(
      boundary === 'read-failure' || boundary === 'cancelled' ? 1 : 0
    )
    expect(getBlob).not.toHaveBeenCalled()
    expect(stage).not.toHaveBeenCalled()
    for (const item of items) {
      expect(await fs.read(item.path)).toEqual(bytes)
      expect(await state.byFileId(item.file_id)).toMatchObject({
        path: item.path,
        versionId: item.version_id,
        sha,
      })
    }
    expect(await state.getCursor()).toBe(3)
  }
)
