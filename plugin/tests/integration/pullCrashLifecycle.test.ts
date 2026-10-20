// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  applyStaged,
  ExpectedWrites,
  MemoryStateStore,
  recoverPendingPullWrites,
  sha256,
} from '@abele/sync-sdk/core'
import type { AtomicStage, EngineClient } from '@abele/sync-sdk/core'
import type { ChangeItem } from '@abele/sync-sdk/protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { coordinatedFileSystem, PathCoordinator } from '@/sync/pathCoordinator'
import { JOURNAL_KEY, RECOVERED_WRITES_KEY } from '@/sync/writeJournal'
import { buildFakeVault } from '../helpers/fakeVault'

const CHUNK = 1024 * 1024
type Window = 'before-stage' | 'partial' | 'complete' | 'moved' | 'published' | 'ledger'
type Operation = 'new' | 'replace' | 'move' | 'case'

async function scenario(
  operation: Operation,
  window: Window,
  edited: boolean,
  entryPoint: 'take' | 'recover',
  small = false,
  bounded = false,
  failure?: 'network' | 'stage' | 'publish' | 'recreated-source' | 'recreated-source-same'
) {
  const app = buildFakeVault([]),
    state = new MemoryStateStore()
  await app.vault.adapter.mkdir('Shared')
  const rawRead = app.vault.adapter.readBinary.bind(app.vault.adapter)
  const rawWrite = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  Object.assign(app.vault.adapter, {
    appendBinary: async (path: string, chunk: ArrayBuffer, options?: { mtime?: number }) => {
      const before = new Uint8Array(await rawRead(path))
      const bytes = new Uint8Array(before.length + chunk.byteLength)
      bytes.set(before)
      bytes.set(new Uint8Array(chunk), before.length)
      await rawWrite(path, bytes.buffer, options)
    },
  })
  if (bounded)
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => path,
      fsPromises: {
        open: async (path: string, flags: string) => {
          if (flags === 'wx') await rawWrite(path, new ArrayBuffer(0))
          return {
            read: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
              expect(buffer.length).toBeLessThanOrEqual(CHUNK)
              const bytes = new Uint8Array(await rawRead(path)).subarray(
                position,
                position + length
              )
              buffer.set(bytes, offset)
              return { bytesRead: bytes.length }
            },
            write: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
              expect(buffer.buffer.byteLength).toBeLessThanOrEqual(CHUNK)
              const before = new Uint8Array(await rawRead(path))
              const bytes = new Uint8Array(Math.max(before.length, position + length))
              bytes.set(before)
              bytes.set(buffer.subarray(offset, offset + length), position)
              await rawWrite(path, bytes.buffer)
              return { bytesWritten: length }
            },
            sync: async () => {},
            close: async () => {},
          }
        },
        utimes: async (path: string, _atime: number, mtime: number) =>
          rawWrite(path, await rawRead(path), { mtime: mtime * 1000 }),
      },
    })
  const wholeRead = vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (path) => {
    const size = (await app.vault.adapter.stat(path))?.size ?? 0
    if (size > CHUNK) throw new Error('Whole multi-chunk read forbidden')
    return rawRead(path)
  })
  const incoming = new Uint8Array(small ? 1024 : CHUNK * 2 + 17).fill(17)
  let served = incoming
  const ranges: number[] = []
  const client = {
    getBlob: vi.fn(async () => {
      throw new Error('Whole download forbidden')
    }),
    openVersion: vi.fn(async () => ({
      size: served.length,
      read: async (offset: number, length: number) => {
        expect(length).toBeLessThanOrEqual(CHUNK)
        ranges.push(offset)
        return served.slice(offset, offset + length)
      },
      assertUnchanged: async () => {},
      close: async () => {},
    })),
  }
  const expected = new ExpectedWrites()
  const engineClient = client as unknown as EngineClient
  const opts = () => ({ dirty: new Set<string>(), expected, filter: { excluded: () => false } })
  let disk = new ObsidianFileSystem(app as never)
  let crash: Window | null = null
  const fs = () => {
    const coordinated = coordinatedFileSystem(disk, new PathCoordinator())
    return new Proxy(coordinated, {
      get(target, key) {
        if (key === 'beginAtomicWrite')
          return async (...args: Parameters<typeof disk.beginAtomicWrite>) => {
            const source = args[0].startsWith('.abele-sync/placement-inbox/')
            if (!source && crash === 'before-stage') throw new Error('Sample process killed')
            const stage = await target.beginAtomicWrite!(...args)
            if (source) return stage
            return new Proxy(stage, {
              get(one, name) {
                if (name === 'append' || name === 'seal')
                  return async (...values: unknown[]) => {
                    await Reflect.get(one, name).apply(one, values)
                    if (
                      (name === 'append' && crash === 'partial') ||
                      (name === 'seal' && crash === 'complete')
                    )
                      throw new Error('Sample process killed')
                  }
                if (name === 'commit' && crash === 'moved')
                  return async () => {
                    throw new Error('Sample process killed')
                  }
                return Reflect.get(one, name)
              },
            }) as AtomicStage
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  const original: ChangeItem = {
    seq: 1,
    file_id: 'sample-file',
    version_id: 'base',
    path: 'Shared/sample.bin',
    prev_path: null,
    op: 'create',
    kind: 'attachment',
    sha: await sha256(incoming),
    size: incoming.length,
    mtime: 10,
    actor: { kind: 'system', id: 'sample', name: 'Sample' },
    at: '',
  }
  if (operation !== 'new') {
    if (operation === 'replace') served = incoming.map(() => 11)
    await applyStaged(
      engineClient,
      fs(),
      state,
      [{ ...original, sha: await sha256(served) }],
      opts()
    )
    served = incoming
  }
  const change: ChangeItem = {
    ...original,
    seq: 2,
    version_id: 'incoming',
    path:
      operation === 'case'
        ? 'Shared/SAMPLE.bin'
        : operation === 'move'
          ? 'Shared/moved.bin'
          : original.path,
    prev_path: operation === 'move' || operation === 'case' ? original.path : null,
    op: operation === 'new' ? 'create' : operation === 'replace' ? 'modify' : 'move',
  }
  crash = window
  let committedIntent: string | null = null
  if (window === 'ledger') {
    const save = state.setMeta.bind(state)
    vi.spyOn(state, 'setMeta').mockImplementation(async (key, value) => {
      if (key === 'pull-write:sample-file' && value !== null) committedIntent = value
      await save(key, value)
    })
  }
  if (window === 'published')
    vi.spyOn(state, 'transaction').mockRejectedValueOnce(new Error('Sample process killed'))
  if (window === 'ledger') await applyStaged(engineClient, fs(), state, [change], opts())
  else
    await expect(applyStaged(engineClient, fs(), state, [change], opts())).rejects.toThrow('killed')
  if (window === 'ledger') {
    expect(committedIntent).not.toBeNull()
    await state.setMeta('pull-write:sample-file', committedIntent)
  }
  crash = null
  const local = new Uint8Array(
    failure === 'recreated-source-same' ? incoming.length : small ? CHUNK * 2 : incoming.length
  ).fill(failure === 'recreated-source-same' ? 17 : 33)
  if (edited)
    await rawWrite(change.path, local.buffer, {
      mtime: (await app.vault.adapter.stat(change.path))?.mtime ?? 10,
    })
  if (failure === 'recreated-source' || failure === 'recreated-source-same') {
    if (await app.vault.adapter.exists(change.path)) await app.vault.adapter.remove(change.path)
    if (await app.vault.adapter.exists(original.path)) await app.vault.adapter.remove(original.path)
    await rawWrite(original.path, local.buffer, { mtime: 10 })
  }
  // A fresh adapter identity and filesystem lose all live receipts, just as a process exit does.
  app.vault.adapter = new Proxy(app.vault.adapter, {})
  disk = new ObsidianFileSystem(app as never)
  await disk.recover()
  expected.clear(change.path)
  expected.clear(original.path)
  if (failure === 'network') {
    served = incoming.slice()
    served[0] ^= 1
  }
  if (failure === 'stage') {
    const journal = app.loadLocalStorage(JOURNAL_KEY) as { temp: string }[]
    const stage = journal[0].temp,
      bytes = new Uint8Array(await rawRead(stage))
    bytes[0] ^= 1
    await rawWrite(stage, bytes.buffer, { mtime: (await app.vault.adapter.stat(stage))!.mtime })
  }
  if (failure === 'publish')
    vi.spyOn(app.vault.adapter, 'rename').mockRejectedValueOnce(
      new Error('Sample publication failed')
    )
  client.openVersion.mockClear()
  const intentBeforeRecovery = await state.getMeta('pull-write:sample-file')
  const moves = vi.spyOn(disk, 'move')
  ranges.length = 0
  wholeRead.mockClear()
  let error: unknown = null
  let report: Awaited<ReturnType<typeof applyStaged>> | undefined
  const log = vi.fn()
  try {
    if (entryPoint === 'recover') {
      await recoverPendingPullWrites(fs(), state, [change.file_id], engineClient)
      if (window === 'before-stage' || window === 'ledger')
        await applyStaged(engineClient, fs(), state, [change], opts())
    } else report = await applyStaged(engineClient, fs(), state, [change], { ...opts(), log })
  } catch (caught) {
    error = caught
  }
  return {
    app,
    state,
    change,
    original,
    incoming,
    local,
    rawRead,
    client,
    ranges,
    wholeRead,
    error,
    expected,
    log,
    report,
    intentBeforeRecovery,
    moves,
    retry: () => applyStaged(engineClient, fs(), state, [change], { ...opts(), log }),
    recover: () => recoverPendingPullWrites(fs(), state, [change.file_id], engineClient),
  }
}

it.each(
  [false, true].flatMap((bounded) =>
    [false, true].flatMap((small) =>
      [false, true].flatMap((sameBytes) =>
        (small
          ? (['published'] as const)
          : (['partial', 'complete', 'published'] as const)
        ).flatMap((window) =>
          (['take', 'recover'] as const).map((entryPoint) => ({
            bounded,
            entryPoint,
            small,
            sameBytes,
            window,
          }))
        )
      )
    )
  )
)(
  'preserves a recreated move source with a missing destination (window=$window, bounded=$bounded, small=$small, sameBytes=$sameBytes, entry=$entryPoint)',
  async ({ bounded, entryPoint, small, sameBytes, window }) => {
    const debug = vi.spyOn(console, 'debug')
    try {
      const result = await scenario(
        'move',
        window,
        false,
        entryPoint,
        small,
        bounded,
        sameBytes ? 'recreated-source-same' : 'recreated-source'
      )
      expect(await sha256(new Uint8Array(await result.rawRead(result.original.path)))).toBe(
        await sha256(result.local)
      )
      if (entryPoint === 'recover') {
        expect(result.error).toBeNull()
        expect(await sha256(new Uint8Array(await result.rawRead(result.change.path)))).toBe(
          await sha256(result.incoming)
        )
        expect((await result.state.byFileId('sample-file'))?.path).toBe(result.change.path)
        expect(await result.state.getMeta('pull-write:sample-file')).toBeNull()
        expect(result.moves).not.toHaveBeenCalled()
        expect(result.app.loadLocalStorage(RECOVERED_WRITES_KEY) ?? []).toEqual([])
        expect(result.wholeRead).not.toHaveBeenCalled()
        await result.recover()
        return
      }
      expect(await result.app.vault.adapter.exists(result.change.path)).toBe(false)
      expect((await result.state.byFileId('sample-file'))?.versionId).toBe('base')
      expect(result.intentBeforeRecovery).not.toBeNull()
      expect(await result.state.getMeta('pull-write:sample-file')).toBe(result.intentBeforeRecovery)
      expect(result.moves).not.toHaveBeenCalled()
      expect(result.app.loadLocalStorage(RECOVERED_WRITES_KEY) ?? []).toEqual([])
      if (entryPoint === 'take') {
        expect(result.report?.held).toEqual([result.change])
        expect(result.log).toHaveBeenCalledWith(
          expect.stringContaining('source may have been recreated')
        )
      }
      const again = await result.retry()
      expect(again.held).toEqual([result.change])
      expect(result.moves).not.toHaveBeenCalled()
      expect(await result.state.getMeta('pull-write:sample-file')).toBe(result.intentBeforeRecovery)
      expect(await sha256(new Uint8Array(await result.rawRead(result.original.path)))).toBe(
        await sha256(result.local)
      )
      if (window !== 'published') return
      // Model a later ordinary reconciliation acknowledging the server's current binding.
      // Recovery must then retire its stale intent as metadata only, never move the local copy.
      await result.state.transaction(async () => {
        await result.state.delete(result.original.path)
        await result.state.put({
          path: result.change.path,
          wirePath: result.change.path,
          fileId: result.change.file_id,
          versionId: result.change.version_id,
          sha: result.change.sha!,
          size: result.change.size!,
          mtime: result.change.mtime!,
        })
      })
      expect((await result.retry()).skipped).toBe(1)
      expect(await result.state.getMeta('pull-write:sample-file')).toBeNull()
      expect(await result.app.vault.adapter.exists(result.change.path)).toBe(false)
      expect(await sha256(new Uint8Array(await result.rawRead(result.original.path)))).toBe(
        await sha256(result.local)
      )
    } finally {
      debug.mockRestore()
    }
  }
)

it.each(['take', 'recover'] as const)(
  'respells an interrupted case-only stream through %s',
  async (entryPoint) => {
    const result = await scenario('case', 'partial', false, entryPoint)
    expect(result.error).toBeNull()
    expect((await result.app.vault.adapter.list('Shared')).files).toContain(result.change.path)
    expect((await result.state.byFileId('sample-file'))?.path).toBe(result.change.path)
    expect(await result.state.getMeta('pull-write:sample-file')).toBeNull()
  }
)

it.each(['take', 'recover'] as const)(
  'retains an edited stage-less publication through %s',
  async (entryPoint) => {
    const result = await scenario('new', 'published', true, entryPoint, true)
    expect(result.error).toBeNull()
    expect((await result.state.byFileId('sample-file'))?.versionId).toBe('incoming')
    expect(await result.state.getMeta('pull-write:sample-file')).toBeNull()
    const retained = result.app.loadLocalStorage(RECOVERED_WRITES_KEY) as { backup: string }[]
    expect(retained).toHaveLength(1)
    expect(await sha256(new Uint8Array(await result.rawRead(retained[0].backup)))).toBe(
      await sha256(result.local)
    )
    expect(await sha256(new Uint8Array(await result.rawRead(result.change.path)))).toBe(
      await sha256(result.incoming)
    )
    expect(result.app.loadLocalStorage(JOURNAL_KEY) ?? []).toEqual([])
  }
)

const matrix = (
  ['before-stage', 'partial', 'complete', 'moved', 'published', 'ledger'] as const
).flatMap((window) =>
  (['new', 'replace', 'move', 'case'] as const).flatMap((operation) =>
    [false, true].flatMap((bounded) =>
      [false, true].flatMap((edited) =>
        (['take', 'recover'] as const).map((entryPoint) => ({
          window,
          operation,
          bounded,
          edited,
          entryPoint,
        }))
      )
    )
  )
)

it.each(
  (['new', 'replace', 'move', 'case'] as const).flatMap((operation) =>
    [false, true].flatMap((bounded) =>
      [false, true].flatMap((edited) =>
        (['take', 'recover'] as const).map((entryPoint) => ({
          operation,
          bounded,
          edited,
          entryPoint,
        }))
      )
    )
  )
)(
  'stage-less publication: $operation / bounded=$bounded / edited=$edited / $entryPoint',
  async ({ operation, bounded, edited, entryPoint }) => {
    const result = await scenario(operation, 'published', edited, entryPoint, true, bounded)
    expect(result.error).toBeNull()
    expect((await result.state.byFileId('sample-file'))?.versionId).toBe('incoming')
    expect((await result.app.vault.adapter.list('Shared')).files).toContain(result.change.path)
    expect(await result.state.getMeta('pull-write:sample-file')).toBeNull()
    expect(await sha256(new Uint8Array(await result.rawRead(result.change.path)))).toBe(
      await sha256(result.incoming)
    )
    if (edited) {
      const retained = result.app.loadLocalStorage(RECOVERED_WRITES_KEY) as { backup: string }[]
      expect(retained).toHaveLength(1)
      expect(await sha256(new Uint8Array(await result.rawRead(retained[0].backup)))).toBe(
        await sha256(result.local)
      )
    }
    expect(new Set(result.ranges).size).toBe(result.ranges.length)
  }
)

it.each(matrix)(
  'crash matrix: $window / $operation / bounded=$bounded / edited=$edited / $entryPoint',
  async ({ window, operation, bounded, edited, entryPoint }) => {
    const result = await scenario(operation, window, edited, entryPoint, false, bounded)
    const held =
      window === 'before-stage'
        ? edited || (!bounded && operation !== 'new')
        : (window === 'partial' || window === 'complete') &&
          operation === 'move' &&
          (edited || entryPoint === 'take')
    if (held) {
      expect((await result.state.byFileId('sample-file'))?.versionId).not.toBe('incoming')
      if (edited)
        expect(await sha256(new Uint8Array(await result.rawRead(result.change.path)))).toBe(
          await sha256(result.local)
        )
      if (operation === 'move')
        expect(await result.app.vault.adapter.exists(result.original.path)).toBe(true)
      if (window !== 'before-stage') {
        expect(await result.state.getMeta('pull-write:sample-file')).not.toBeNull()
        if (entryPoint === 'recover')
          expect(result.error).toMatchObject({ reason: 'recovery-required' })
      }
    } else {
      expect(result.error).toBeNull()
      expect((await result.state.byFileId('sample-file'))?.versionId).toBe('incoming')
      expect(await result.state.getMeta('pull-write:sample-file')).toBeNull()
      expect((await result.app.vault.adapter.list('Shared')).files).toContain(result.change.path)
      expect(await sha256(new Uint8Array(await result.rawRead(result.change.path)))).toBe(
        await sha256(window === 'ledger' && edited ? result.local : result.incoming)
      )
      if (edited && window !== 'ledger') {
        const retained = result.app.loadLocalStorage(RECOVERED_WRITES_KEY) as { backup: string }[]
        expect(retained).toHaveLength(1)
        expect(await sha256(new Uint8Array(await result.rawRead(retained[0].backup)))).toBe(
          await sha256(result.local)
        )
      }
      expect(result.app.loadLocalStorage(JOURNAL_KEY) ?? []).toEqual([])
    }
    expect(result.client.getBlob).not.toHaveBeenCalled()
    expect(result.wholeRead).not.toHaveBeenCalled()
    expect(new Set(result.ranges).size).toBe(result.ranges.length)
    if (window === 'ledger') expect(result.client.openVersion).not.toHaveBeenCalled()
  },
  10000
)

it('clears echo suppression when a recovered publication fails through take', async () => {
  const result = await scenario('new', 'partial', false, 'take', false, false, 'publish')
  expect(result.error).not.toBeNull()
  expect(await result.state.getMeta('pull-write:sample-file')).not.toBeNull()
  expect(await result.app.vault.adapter.exists(result.change.path)).toBe(false)
  expect(result.expected.has(result.change.path)).toBe(false)
})

it.each([false, true])(
  'never publishes corrupt recovery bytes through real entry points (bounded=%s)',
  async (bounded) => {
    for (const entryPoint of ['take', 'recover'] as const) {
      const result = await scenario('new', 'partial', false, entryPoint, false, bounded, 'network')
      expect(result.error).not.toBeNull()
      expect(await result.state.getMeta('pull-write:sample-file')).not.toBeNull()
      expect(await result.app.vault.adapter.exists(result.change.path)).toBe(false)
      expect(await result.state.byFileId('sample-file')).toBeNull()
    }
  }
)

it.each([false, true])(
  'does not respell a case-only move when recovery bytes are corrupt (bounded=%s)',
  async (bounded) => {
    for (const entryPoint of ['take', 'recover'] as const) {
      const result = await scenario('case', 'partial', false, entryPoint, false, bounded, 'network')
      expect(result.error).not.toBeNull()
      expect((await result.app.vault.adapter.list('Shared')).files).toContain(result.original.path)
      expect((await result.app.vault.adapter.list('Shared')).files).not.toContain(
        result.change.path
      )
      expect(await sha256(new Uint8Array(await result.rawRead(result.original.path)))).toBe(
        await sha256(result.incoming)
      )
      expect((await result.state.byFileId('sample-file'))?.versionId).toBe('base')
      expect(await result.state.getMeta('pull-write:sample-file')).not.toBeNull()
    }
  }
)

it.each([false, true])(
  'revalidates a corrupted private stage after restart (bounded=%s)',
  async (bounded) => {
    for (const entryPoint of ['take', 'recover'] as const) {
      const result = await scenario('new', 'complete', false, entryPoint, false, bounded, 'stage')
      if (bounded) {
        expect(result.error).not.toBeNull()
        expect(await result.app.vault.adapter.exists(result.change.path)).toBe(false)
        expect(await result.state.getMeta('pull-write:sample-file')).not.toBeNull()
      } else {
        expect(result.error).toBeNull()
        expect(await sha256(new Uint8Array(await result.rawRead(result.change.path)))).toBe(
          await sha256(result.incoming)
        )
      }
    }
  }
)
