import { afterEach, expect, it, vi } from 'vitest'
import { guardedVaultAdapter, checkedVaultPort } from '@/sync/vaultPathLinks'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import { ExchangeTrace } from '@/sync/exchangeTrace'
import { VaultWriter, waitForAdapterWrite, adapterWriteInFlight } from '@/sync/vaultWrites'
import { WriteJournal } from '@/sync/writeJournal'
import { requireExternalEnrollmentSafety } from '@/sync/external/pluginSafety'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('cancels a recovery reader waiting for a live backup without cancelling that writer', async () => {
  const held = deferred<void>(),
    abort = new AbortController()
  const writer = new VaultWriter({} as never)
  const writing = writer.holding('sample.old', () => held.promise)
  let failure: unknown
  const waiting = waitForAdapterWrite('sample.old', abort.signal).catch((error) => {
    failure = error
  })
  abort.abort(new Error('sample stopped'))
  await new Promise((resolve) => setTimeout(resolve, 20))
  try {
    expect(failure).toMatchObject({ message: 'sample stopped' })
    expect(adapterWriteInFlight('sample.old')).toBe(true)
  } finally {
    held.resolve()
    await Promise.all([writing, waiting])
  }
})

it.each(['list', 'stat', 'readBinary'] as const)(
  'abandons a lost mobile %s without replaying it',
  async (method) => {
    vi.useFakeTimers()
    const app = buildFakeVault([])
    const lost = deferred<never>()
    const call = vi.spyOn(app.vault.adapter, method).mockImplementation(() => lost.promise)
    const disk = guardedVaultAdapter(app.vault.adapter as never)
    let failure: unknown
    const waiting = Promise.resolve(Reflect.get(disk, method).call(disk, 'sample')).catch(
      (error) => {
        failure = error
      }
    )
    await vi.advanceTimersByTimeAsync(15000)
    expect(Reflect.get(new ExchangeTrace().snapshot(), 'portableIo')).toMatchObject({
      pending: expect.arrayContaining([
        expect.objectContaining({ operation: method, path: 'sample', returned: true }),
      ]),
    })
    expect(failure).toMatchObject({ code: 'offline', retryable: true })
    expect(call).toHaveBeenCalledOnce()
    await waiting
    lost.reject(new Error('sample late host failure'))
    await Promise.resolve()
  }
)

it('abandons a lost pre-publication queue wait without releasing the host writer', async () => {
  vi.useFakeTimers()
  const app = buildFakeVault([])
  const held = deferred<void>()
  Reflect.set(app.vault.adapter, 'promise', held.promise)
  const port = checkedVaultPort(app.vault as never, app.vault.adapter as never, {
    ready() {},
    effect: (work) => work(),
  })
  let failure: unknown
  const waiting = port.wait('sample.md').catch((error) => {
    failure = error
  })
  await vi.advanceTimersByTimeAsync(15000)
  expect(failure).toMatchObject({ code: 'offline', retryable: true })
  expect(Reflect.get(app.vault.adapter, 'promise')).toBe(held.promise)
  held.resolve()
  await waiting
})

it('drains a blocked portable publication and resumes its exact receipt without losing bytes', async () => {
  vi.useFakeTimers()
  const app = buildFakeVault([]),
    hostQueue = deferred<void>()
  Reflect.set(app.vault.adapter, 'promise', hostQueue.promise)
  const fs = new ObsidianFileSystem(app as never)
  const effect = {
    kind: 'write' as const,
    bytes: new TextEncoder().encode('incoming bytes'),
    mtime: 1000,
    receipt: 'sample-delayed',
  }
  let failure: unknown
  const placement = pathCoordinatorOf(app.vault)
    .run(['Shared/sample.md'], () =>
      fs.conditionalFile({ path: 'Shared/sample.md', expected: null, effect })
    )
    .catch((error) => {
      failure = error
    })
  await vi.advanceTimersByTimeAsync(15000)
  expect(failure).toMatchObject({ code: 'offline', retryable: true })
  await placement
  const [entry] = await new WriteJournal(app).currentEntries()
  expect(await app.vault.adapter.read(entry.temp!)).toBe('incoming bytes')
  expect(await app.vault.adapter.exists('Shared/sample.md')).toBe(false)
  hostQueue.resolve()
  Reflect.deleteProperty(app.vault.adapter, 'promise')
  const restarted = new ObsidianFileSystem(app as never)
  await restarted.recover()
  await expect(
    restarted.conditionalFile({ path: 'Shared/sample.md', expected: null, effect })
  ).resolves.toBe(true)
  await restarted.discardInstallation(effect.receipt)
  expect(await app.vault.adapter.read('Shared/sample.md')).toBe('incoming bytes')
  await expect(requireExternalEnrollmentSafety(app as never)).resolves.toBeUndefined()
})

it('cancels a recovery scan queued behind another connection without entering it later', async () => {
  const app = buildFakeVault([]),
    held = deferred<void>(),
    abort = new AbortController()
  const gate = pathCoordinatorOf(app.vault)
  const writer = gate.run(['Shared/sample.md'], () => held.promise)
  const fs = new ObsidianFileSystem(app as never, { indexWaitSignal: () => abort.signal })
  let outcome: unknown
  const scan = Array.fromAsync(fs.list()).catch((error) => {
    outcome = error
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(new ExchangeTrace().snapshot().pathWaits).toEqual(
    expect.arrayContaining([
      // Coordinator diagnostics expose the normalized exclusion keys.
      expect.objectContaining({
        kind: 'placement',
        active: [expect.objectContaining({ paths: ['shared/sample.md'] })],
        waiting: [expect.objectContaining({ paths: [''] })],
      }),
    ])
  )
  abort.abort(new Error('sample stopped'))
  await new Promise((resolve) => setTimeout(resolve, 20))
  try {
    expect(outcome).toMatchObject({ message: 'sample stopped' })
  } finally {
    held.resolve()
    await writer
    await scan
  }
})

it('never abandons a mobile mutation or releases an active placement on cancellation', async () => {
  vi.useFakeTimers()
  const app = buildFakeVault([]),
    held = deferred<void>(),
    abort = new AbortController()
  const original = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'writeBinary').mockImplementation(async (path, bytes) => {
    await held.promise
    await original(path, bytes)
  })
  const disk = guardedVaultAdapter(app.vault.adapter as never),
    gate = pathCoordinatorOf(app.vault)
  let done = false,
    next = false
  const first = gate.run(
    ['sample.md'],
    async () => {
      await disk.writeBinary('sample.md', new TextEncoder().encode('incoming').buffer)
      done = true
    },
    () => {},
    abort.signal
  )
  const second = gate.run(['sample.md'], async () => {
    next = true
  })
  abort.abort()
  await vi.advanceTimersByTimeAsync(30000)
  expect(done).toBe(false)
  expect(next).toBe(false)
  held.resolve()
  await Promise.all([first, second])
  expect(await disk.read('sample.md')).toBe('incoming')
  expect(next).toBe(true)
})
