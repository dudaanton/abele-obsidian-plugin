import { expect, it, vi } from 'vitest'
import {
  MemoryStateStore,
  SyncEngine,
  selectiveDefaults,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { VaultSettingsSchema } from '@abele/sync-sdk/protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'

it('132 uploads an unannounced ledgered index-excluded edit by the default fallback at 33000-file scale', async () => {
  const path = 'Group-0/file-0.md'
  const app = buildFakeVault([{ path, content: 'a', mtime: 1, ctime: 1 }])
  const externalWrite = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  vi.spyOn(app.vault, 'getFiles').mockReturnValue([])
  const paths = Array.from({ length: 33000 }, (_, i) => `Group-${Math.floor(i / 330)}/file-${i}.md`)
  const folders = Array.from({ length: 100 }, (_, i) => `Group-${i}`)
  const listings = new Map(
    folders.map((folder, i) => [folder, paths.slice(i * 330, (i + 1) * 330)])
  )
  const originalList = app.vault.adapter.list.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'list').mockImplementation(async (folder) =>
    folder === ''
      ? { files: [], folders }
      : listings.has(folder)
        ? { files: listings.get(folder)!, folders: [] }
        : originalList(folder)
  )
  const originalStat = app.vault.adapter.stat.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (file) =>
    file !== path && file.includes('/file-')
      ? { type: 'file', size: 1, mtime: 1, ctime: 1 }
      : originalStat(file)
  )
  const state = new MemoryStateStore()
  const initialSha = await sha256(new TextEncoder().encode('a'))
  const editedSha = await sha256(new TextEncoder().encode('b'))
  for (const file of paths)
    await state.put({
      path: file,
      wirePath: file,
      fileId: file,
      versionId: 'saved',
      sha: initialSha,
      size: 1,
      mtime: 1,
      ctime: 1,
    })
  await state.setCursor(1)
  const fs = new ObsidianFileSystem(app as never, {
    ledger: state,
    prepareStartupInventory: async () => {},
  })
  // Previously discovered and snapshotted files; avoid discovery noise waking the
  // engine and concealing whether its real default fallback can catch the edit.
  Reflect.set(fs, 'verificationRoot', JSON.stringify(['']))
  const candidates = Reflect.get(fs, 'unindexedFiles') as Set<string>
  const signatures = Reflect.get(fs, 'verificationSignatures') as Map<string, string>
  for (const file of paths) {
    candidates.add(file)
    signatures.set(file, JSON.stringify([1, 1, 1, null, 1]))
  }
  let head = 1
  const uploaded = vi.fn(async () => {})
  const commitRaw = vi.fn(async (ops) => {
    head = 2
    return {
      replayed: false,
      body: {
        head_seq: head,
        results: ops.map((op: { sha: string; mtime: number; size: number }) => ({
          status: 'applied',
          seq: head,
          file_id: path,
          version_id: 'edited',
          path,
          sha: op.sha,
          size: op.size,
          mtime: op.mtime,
          kind: 'note',
        })),
      },
    }
  })
  const client = {
    state: async () => ({ head_seq: head, settings: VaultSettingsSchema.parse({}), usage: {} }),
    changes: async () => ({ items: [], head_seq: head, next_since: head }),
    subscribe: () => () => {},
    hasBlob: async () => false,
    putBlob: uploaded,
    commitRaw,
  } as unknown as EngineClient
  const completed = deferred<void>()
  const log = vi.fn()
  const realTimeout = setTimeout
  const yieldTask = () => new Promise<void>((resolve) => realTimeout(resolve, 0))
  const scheduler = Object.getOwnPropertyDescriptor(window, 'scheduler')
  Object.defineProperty(window, 'scheduler', { configurable: true, value: { yield: yieldTask } })
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  })
  vi.setSystemTime(0)
  let committedAt: number | undefined
  const engine = new SyncEngine({
    fs,
    state,
    client,
    selective: selectiveDefaults(),
    log,
    yieldTask,
    onSync: () => {
      if (commitRaw.mock.calls.length) {
        committedAt = Date.now()
        completed.resolve()
      }
    },
    onFail: (error) => completed.reject(error),
  })
  try {
    engine.start()
    await Reflect.get(engine, 'running')
    expect(engine.status.state).toBe('idle')
    expect(commitRaw).not.toHaveBeenCalled()
    // Inspect once to establish the target's snapshot and move the verification
    // cursor past it. All subsequent polls run at the real default 30 s cadence.
    expect(await Reflect.get(fs, Symbol.for('abele.sync.inspect-polled-v1')).call(fs)).toBe(true)
    await externalWrite(path, new TextEncoder().encode('b').buffer, { mtime: 2 })
    await vi.advanceTimersByTimeAsync(299999)
    expect(commitRaw).not.toHaveBeenCalled()
    expect(log.mock.calls.some(([line]) => line.includes('request watch'))).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await completed.promise
    expect(log.mock.calls.some(([line]) => line.includes('request fallback'))).toBe(true)
    expect(committedAt).toBeLessThanOrEqual(300000)
    expect(commitRaw).toHaveBeenCalledOnce()
    expect(commitRaw.mock.calls[0][0]).toEqual([
      expect.objectContaining({ op: 'modify', file_id: path, sha: editedSha }),
    ])
    expect((await state.get(path))?.sha).toBe(editedSha)
    expect(uploaded).toHaveBeenCalledOnce()
  } finally {
    await engine.stop()
    vi.useRealTimers()
    if (scheduler) Object.defineProperty(window, 'scheduler', scheduler)
    else delete (window as Window & { scheduler?: unknown }).scheduler
  }
}, 60000)
