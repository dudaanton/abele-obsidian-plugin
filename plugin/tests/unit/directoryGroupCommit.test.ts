import { expect, it, vi } from 'vitest'
import { DirectEntryDurability } from '@/sync/directEntryDurability'
import { applyStaged, ExpectedWrites, MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import type { ChangeItem } from '@abele/sync-sdk/protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it.fails('BUG: R25-G1 a 32-file small pull shares folder publication barriers', async () => {
  const app = buildFakeVault([])
  withDesktopFs(app)
  await app.vault.adapter.mkdir('Shared')
  const native = Reflect.get(app.vault.adapter, 'fsPromises')
  const open = native.open.bind(native)
  let folderBarriers = 0
  native.open = async (path: string, flags: string) => {
    const handle = await open(path, flags)
    const sync = handle.sync.bind(handle)
    handle.sync = async () => {
      if (path === '/vault/Shared') folderBarriers++
      await sync()
    }
    return handle
  }
  const bytes = new Uint8Array([1, 2, 3]),
    sha = await sha256(bytes)
  const changes: ChangeItem[] = Array.from({ length: 32 }, (_, i) => ({
    seq: i + 1,
    file_id: `sample-${i}`,
    version_id: `version-${i}`,
    path: `Shared/sample-${i}.bin`,
    prev_path: null,
    op: 'create',
    kind: 'attachment',
    sha,
    size: bytes.length,
    mtime: 1000,
    at: '',
    actor: { kind: 'system', id: 'sample', name: 'Sample' },
  }))
  const state = new MemoryStateStore()
  const result = await applyStaged(
    {
      getBlob: async () => bytes,
      openVersion: async () => ({
        size: bytes.length,
        read: async (offset: number, length: number) => bytes.slice(offset, offset + length),
        assertUnchanged: async () => {},
        close: async () => {},
      }),
    } as Parameters<typeof applyStaged>[0],
    new ObsidianFileSystem(app as never),
    state,
    changes,
    {
      dirty: new Set(),
      expected: new ExpectedWrites(),
      filter: { excluded: () => false },
    }
  )
  expect(result.applied).toBe(32)
  for (const change of changes) {
    expect((await state.get(change.path))?.sha).toBe(sha)
    expect(new Uint8Array(await app.vault.adapter.readBinary(change.path))).toEqual(bytes)
  }
  // Shared folder only: up to three namespace phases, independent of participant count.
  // Stage data/public file barriers and private operation directories remain required.
  expect(folderBarriers).toBeLessThanOrEqual(3)
})

it('shares one directory barrier for 32 changes submitted before it starts', async () => {
  const state = new DirectEntryDurability()
  const flush = vi.fn(async () => {})
  await Promise.all(
    Array.from({ length: 32 }, (_, i) => {
      const path = `Shared/sample-${i}.bin`
      state.changed(path)
      return state.flushAncestors(path, flush)
    })
  )
  expect(flush.mock.calls).toEqual([['Shared']])
})

it('requires the next barrier for changes made during an outstanding barrier', async () => {
  const state = new DirectEntryDurability()
  const started = gate(),
    release = gate(),
    next = gate()
  const flush = vi.fn(async () => {
    if (flush.mock.calls.length === 1) {
      started.resolve()
      await release.promise
    } else await next.promise
  })
  state.changed('Shared/first.bin')
  const first = state.flushAncestors('Shared/first.bin', flush)
  await started.promise
  let acknowledged = false
  const later = Array.from({ length: 31 }, (_, i) => {
    const path = `Shared/later-${i}.bin`
    state.changed(path)
    return state.flushAncestors(path, flush)
  })
  const done = Promise.all(later).then(() => {
    acknowledged = true
  })
  release.resolve()
  await first
  expect(acknowledged).toBe(false)
  next.resolve()
  await done
  expect(flush).toHaveBeenCalledTimes(2)
})

it('rejects a failed cohort without stranding later participants or forgetting dirtiness', async () => {
  const state = new DirectEntryDurability()
  const started = gate(),
    release = gate()
  const flush = vi.fn(async () => {
    if (flush.mock.calls.length === 1) {
      started.resolve()
      await release.promise
      throw new Error('sample fsync failure')
    }
  })
  state.changed('Shared/first.bin')
  const first = expect(state.flushAncestors('Shared/first.bin', flush)).rejects.toThrow(
    'fsync failure'
  )
  await started.promise
  state.changed('Shared/second.bin')
  const second = state.flushAncestors('Shared/second.bin', flush)
  release.resolve()
  await Promise.all([first, second])
  expect(flush).toHaveBeenCalledTimes(2)
  await state.flushAncestors('Shared/first.bin', flush)
  expect(flush).toHaveBeenCalledTimes(2)
})

it('keeps a cancelled barrier dirty and allows independent directories and retries to finish', async () => {
  const state = new DirectEntryDurability()
  const started = gate(),
    release = gate()
  const controller = new AbortController()
  const cancelled = vi.fn(async () => {
    started.resolve()
    await release.promise
    controller.signal.throwIfAborted()
  })
  state.changed('Shared/cancelled.bin', 'Other/sample.bin')
  let acknowledged = false
  const pending = expect(
    state.flushAncestors('Shared/cancelled.bin', cancelled).then(() => {
      acknowledged = true
    })
  ).rejects.toThrow('sample cancellation')
  await started.promise
  const other = vi.fn(async () => {})
  await state.flushAncestors('Other/sample.bin', other)
  expect(other).toHaveBeenCalledExactlyOnceWith('Other')
  controller.abort(new Error('sample cancellation'))
  release.resolve()
  await pending
  expect(acknowledged).toBe(false)
  const retry = vi.fn(async () => {})
  await state.flushAncestors('Shared/cancelled.bin', retry)
  expect(retry).toHaveBeenCalledExactlyOnceWith('Shared')
})
