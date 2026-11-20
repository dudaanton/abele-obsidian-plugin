import { expect, it, vi } from 'vitest'
import { MemoryStateStore, scan, sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { ignoreFor } from '@/sync/scope'

async function tracked(path: string, content = 'original') {
  const state = new MemoryStateStore()
  await state.put({
    path,
    wirePath: path,
    fileId: 'sample-file',
    versionId: 'sample-version',
    sha: await sha256(new TextEncoder().encode(content)),
    size: content.length,
    mtime: 1000,
  })
  return state
}

it('133 cancels an incomplete index without publishing absence and retries from the same ledger', async () => {
  const app = buildFakeVault([{ path: 'Notes/sample.md', content: 'original', mtime: 1000 }])
  let clean = false
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => clean })
  const state = await tracked('Notes/sample.md')
  const controller = new AbortController()
  const waiting = vi.fn()
  const make = (signal: AbortSignal) =>
    new ObsidianFileSystem(app as never, {
      prepareStartupInventory: async () => {},
      indexWaitSignal: () => signal,
      onIndexWait: waiting,
      ledger: state,
    })
  const list = vi.spyOn(app.vault.adapter, 'list')
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  const first = scan(make(controller.signal), state, { excluded: () => false })
  const rejected = expect(first).rejects.toThrow('sample shutdown')
  await vi.waitFor(() => expect(waiting).toHaveBeenCalledWith(true))
  controller.abort(new Error('sample shutdown'))
  await rejected
  expect(list).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
  expect((await state.get('Notes/sample.md'))?.versionId).toBe('sample-version')
  clean = true
  const restarted = await scan(make(new AbortController().signal), state, { excluded: () => false })
  expect(restarted.ops).toEqual([])
  expect(waiting).toHaveBeenLastCalledWith(false)
})

async function changedHiddenFile(path: string) {
  const app = buildFakeVault([{ path, content: 'original', mtime: 1000 }])
  const state = await tracked(path)
  expect(app.vault.getFiles().map((file) => file.path)).not.toContain(path)
  await app.vault.adapter.writeBinary(path, new TextEncoder().encode('new saved content').buffer, {
    mtime: 2000,
  })
  const fs = new ObsidianFileSystem(app as never, { ledger: state })
  const ignore = ignoreFor('.obsidian', null)
  const found = await scan(fs, state, { excluded: (path) => ignore.ignores(path) })
  expect(found.ops).toEqual([
    expect.objectContaining({
      op: 'modify',
      file_id: 'sample-file',
      sha: await sha256(new TextEncoder().encode('new saved content')),
    }),
  ])
  expect(await app.vault.adapter.read(path)).toBe('new saved content')
}

it('131 discovers a changed unindexed configuration file after restart', async () => {
  await changedHiddenFile('.obsidian/app.json')
})

it.each([true, false])(
  '131 excludes nested hidden files without inferring deletion, present=%s',
  async (present) => {
    const path = 'Notes/.hidden/sample.json'
    const app = buildFakeVault(present ? [{ path, content: 'local saved bytes', mtime: 2000 }] : [])
    const state = await tracked(path)
    const ignore = ignoreFor('.obsidian', null)
    expect(ignore.ignores(path)).toBe(true)
    const fs = new ObsidianFileSystem(app as never, { ledger: state })
    const found = await scan(fs, state, { excluded: (path) => ignore.ignores(path) })
    expect(found.ops).toEqual([])
    expect((await state.get(path))?.versionId).toBe('sample-version')
    if (present) expect(await app.vault.adapter.read(path)).toBe('local saved bytes')
    else expect(await app.vault.adapter.exists(path)).toBe(false)
  }
)

it('128 trusts an equal-size equal-mtime indexed replacement without reading content', async () => {
  const path = 'Notes/sample.md'
  const app = buildFakeVault([{ path, content: 'original', mtime: 1000 }])
  const state = await tracked(path)
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  await app.vault.adapter.writeBinary(path, new TextEncoder().encode('replaced').buffer, {
    mtime: 1000,
  })
  const fs = new ObsidianFileSystem(app as never, {
    ledger: state,
    prepareStartupInventory: async () => {},
  })
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  const found = await scan(fs, state, { excluded: () => false })
  expect(found.ops).toEqual([])
  expect(read).not.toHaveBeenCalled()
  expect((await state.get(path))?.sha).toBe(await sha256(new TextEncoder().encode('original')))
  expect(await app.vault.adapter.read(path)).toBe('replaced')
})

it('132 keeps a tracked host-excluded file eligible under the sync filter', async () => {
  const path = 'Excluded/sample.md'
  const app = buildFakeVault([{ path, content: 'original', mtime: 1000 }])
  const state = await tracked(path)
  vi.spyOn(app.vault, 'getFiles').mockReturnValue([])
  await app.vault.adapter.writeBinary(
    path,
    new TextEncoder().encode('changed outside the host index').buffer,
    { mtime: 2000 }
  )
  const fs = new ObsidianFileSystem(app as never, { ledger: state })
  const found = await scan(fs, state, { excluded: () => false })
  expect(found.ops).toEqual([
    expect.objectContaining({
      op: 'modify',
      file_id: 'sample-file',
      sha: await sha256(new TextEncoder().encode('changed outside the host index')),
    }),
  ])
  expect((await state.get(path))?.versionId).toBe('sample-version')
})

// BUG: a new ordinary file omitted by the host index has no ledger candidate, so
// the inventory cannot discover it even though the sync filter permits it.
it.fails('132 discovers a new host-excluded file without a prior ledger entry', async () => {
  const path = 'Excluded/sample.md'
  const app = buildFakeVault([{ path, content: 'new saved content', mtime: 1000 }])
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  vi.spyOn(app.vault, 'getFiles').mockReturnValue([])
  const state = new MemoryStateStore()
  const ignore = ignoreFor('.obsidian', null)
  expect(ignore.ignores(path)).toBe(false)
  const fs = new ObsidianFileSystem(app as never, {
    ledger: state,
    prepareStartupInventory: async () => {},
  })
  const found = await scan(fs, state, { excluded: (path) => ignore.ignores(path) })
  expect(found.ops).toEqual([expect.objectContaining({ op: 'create', path })])
})

it('126/129 discards a partial rebuild inventory and sends only the latest indexed edit', async () => {
  const path = 'Notes/sample.md'
  const app = buildFakeVault([{ path, content: 'original', mtime: 1000 }])
  const state = await tracked(path)
  let clean = true
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => clean })
  const indexed = app.vault.getFiles.bind(app.vault)
  vi.spyOn(app.vault, 'getFiles')
    .mockImplementationOnce(() => {
      clean = false
      return []
    })
    .mockImplementation(indexed)
  const waiting = vi.fn()
  const controller = new AbortController()
  const fs = new ObsidianFileSystem(app as never, {
    ledger: state,
    prepareStartupInventory: async () => {},
    indexWaitSignal: () => controller.signal,
    onIndexWait: waiting,
  })
  const list = vi.spyOn(app.vault.adapter, 'list')
  const reading = scan(fs, state, { excluded: () => false })
  try {
    await vi.waitFor(() => expect(waiting).toHaveBeenCalledWith(true))
    expect(list).not.toHaveBeenCalled()
    expect((await state.get(path))?.versionId).toBe('sample-version')
    await app.vault.adapter.writeBinary(
      path,
      new TextEncoder().encode('latest saved edit').buffer,
      { mtime: 2000 }
    )
    clean = true
    const found = await reading
    expect(found.ops).toEqual([
      expect.objectContaining({
        op: 'modify',
        file_id: 'sample-file',
        sha: await sha256(new TextEncoder().encode('latest saved edit')),
      }),
    ])
  } finally {
    controller.abort(new Error('sample teardown'))
    await reading.catch(() => {})
  }
})
