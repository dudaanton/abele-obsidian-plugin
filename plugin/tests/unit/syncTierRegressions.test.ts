import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { checkedVaultPort } from '@/sync/vaultPathLinks'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { ScanInterrupted } from '@/sync/conditionalFiles'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { tokenPoolMarkers } from '@/testing/tokenPoolMarkers'
import { EXTERNAL_ACTIVATION_KEY } from '@/sync/external/recovery'
import { RetainedShareCopies } from '@/sync/retainedShareCopies'
import { buildFakeVault } from '../helpers/fakeVault'

it('calls checked-lease timers with their owning window receiver on strict browser hosts', async () => {
  const start = setTimeout,
    stop = clearTimeout
  const owner = {
    setTimeout: function (this: unknown, ...args: Parameters<typeof start>) {
      if (this !== owner) throw new TypeError('wrong timer receiver')
      return start(...args)
    },
    clearTimeout: function (this: unknown, ...args: Parameters<typeof stop>) {
      if (this !== owner) throw new TypeError('wrong timer receiver')
      return stop(...args)
    },
  }
  vi.stubGlobal('window', owner)
  vi.stubGlobal('setTimeout', owner.setTimeout)
  vi.stubGlobal('clearTimeout', owner.clearTimeout)
  try {
    const app = buildFakeVault([])
    const port = checkedVaultPort(app.vault as never, app.vault.adapter as never, {
      ready() {},
      effect: (work) => work(),
    })
    const release = await port.acquire(['Notes/sample.md'])
    release()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('removes owned activation from durable host storage before a reset reload', async () => {
  const values = new Map<string, unknown>()
  const local = {
    loadLocalStorage: (key: string) => values.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, value)
    },
  }
  const factory = new IDBFactory()
  let host = await HostSyncStorage.open(factory, 'sample-reset', local)
  try {
    host.saveLocalStorage(EXTERNAL_ACTIVATION_KEY, {
      schema: 1,
      ledgers: [
        {
          ledgerId: 'owned',
          databaseName: 'owned',
          binding: { mode: 'token' },
        },
      ],
    })
    await host.flush()
    tokenPoolMarkers(local, ['owned'])()
    await host.flush()
    host.close()
    host = await HostSyncStorage.open(factory, 'sample-reset', local)
    expect(host.loadLocalStorage(EXTERNAL_ACTIVATION_KEY)).toBeNull()
  } finally {
    host.close()
  }
})

it('never adds private staging parents to the cached wire directory inventory', async () => {
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as never)
  const directories = () =>
    Reflect.get(fs, Symbol.for('abele.sync.inventory-directories-v1')).call(fs)
  await Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1')).call(fs, async () => {
    expect(await directories()).toEqual([])
    await fs.mkdir('.abele-sync/connections/sample/writes')
    expect(await directories()).toEqual([])
  })
})

it('projects expanded ledger rows into the declared retained-copy proof', async () => {
  const copies = new RetainedShareCopies(new MemoryStateStore())
  const row = {
    path: 'Notes/sample.md',
    wirePath: 'Notes/sample.md',
    fileId: 'sample-file',
    versionId: 'sample-version',
    sha: 'a'.repeat(64),
    size: 4,
    mtime: 10,
    ctime: 20,
  }
  await copies.remember(row)
  const { ctime: _ctime, ...base } = row
  expect(await copies.read()).toEqual([base])
})

it('does not retry an interrupted file inventory after stop', async () => {
  const abort = new AbortController()
  const fs = new ObsidianFileSystem(buildFakeVault([]) as never, {
    indexWaitSignal: () => abort.signal,
  })
  const cancelled = new Error('sample scan stopped')
  let attempts = 0
  Reflect.set(fs, 'listUnlocked', async function* () {
    yield* []
    if (++attempts > 1) throw new Error('retried after stop')
    abort.abort(cancelled)
    throw new ScanInterrupted('folder deletion crossed inventory')
  })
  await expect(Array.fromAsync(fs.list())).rejects.toBe(cancelled)
  expect(attempts).toBe(1)
})

it('cancels a listing waiting for unrelated conditional effects to settle', async () => {
  vi.useFakeTimers()
  const abort = new AbortController()
  const fs = new ObsidianFileSystem(buildFakeVault([]) as never, {
    indexWaitSignal: () => abort.signal,
  })
  const cancelled = new Error('sample waiting scan stopped')
  const active = Reflect.get(Reflect.get(fs, 'conditional'), 'host').active as Set<string>
  active.add('sample-pending-effect')
  let result: unknown
  const pending = Array.fromAsync(fs.list()).then(
    () => {
      result = 'completed'
    },
    (error: unknown) => {
      result = error
    }
  )
  try {
    await vi.advanceTimersByTimeAsync(1)
    abort.abort(cancelled)
    await vi.advanceTimersByTimeAsync(20)
    expect(result).toBe(cancelled)
    expect(active.size).toBe(1) // Cancelling a reader never abandons the writer's ownership.
  } finally {
    active.clear()
    await vi.advanceTimersByTimeAsync(20)
    await pending
    vi.useRealTimers()
  }
})
