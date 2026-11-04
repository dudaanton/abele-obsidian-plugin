import { expect, it, vi } from 'vitest'
import { nativeDiagnostics, nativeIoSnapshot, nativeSyscalls } from '@/sync/nativeDiagnostics'
import { ExchangeTrace } from '@/sync/exchangeTrace'
import { deferred } from '../helpers/deferred'

it('identifies the original filesystem promise port separately from the desktop module wrapper', async () => {
  const original = { lstat: async () => ({ size: 3 }) }
  vi.stubGlobal('window', {
    require: (name: string) => ({ promises: name === 'original-fs' ? original : {} }),
  })
  try {
    await nativeSyscalls(original, 'path-validation').lstat()
    const snapshot = Reflect.get(new ExchangeTrace().snapshot(), 'nativeLstat')
    expect(snapshot.recent).toContainEqual(
      expect.objectContaining({
        source: 'host-original-fs.promises',
        site: 'path-validation',
        outcome: 'fulfilled',
      })
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

it('distinguishes an issued lstat promise from its eventual rejection without losing settlement', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const release = deferred<never>()
  const host = { lstat: vi.fn(() => release.promise) }
  const port = nativeSyscalls(host)
  const work = port.lstat()
  const rejected = expect(work).rejects.toThrow('sample failure')
  const snapshot = () => Reflect.get(new ExchangeTrace().snapshot(), 'nativeLstat')
  try {
    now.mockReturnValue(112000)
    expect(snapshot()).toMatchObject({
      pending: [
        {
          source: 'adapter',
          startedAt: 1000,
          returnedAt: 1000,
          settledAt: null,
          outcome: 'pending',
        },
      ],
    })
    expect(host.lstat).toHaveBeenCalledOnce()
  } finally {
    release.reject(new Error('sample failure'))
    await rejected
    now.mockRestore()
  }
  expect(snapshot().pending).toEqual([])
  expect(snapshot().recent).toContainEqual(
    expect.objectContaining({
      startedAt: 1000,
      returnedAt: 1000,
      settledAt: 112000,
      outcome: 'rejected',
    })
  )
})

it('records synchronous lstat throws without inventing a returned promise', async () => {
  const port = nativeSyscalls({
    lstat() {
      throw new Error('sample synchronous failure')
    },
  })
  await expect(port.lstat()).rejects.toThrow('sample synchronous failure')
  const snapshot = Reflect.get(new ExchangeTrace().snapshot(), 'nativeLstat')
  expect(snapshot.pending).toEqual([])
  expect(snapshot.recent).toContainEqual(
    expect.objectContaining({
      returnedAt: null,
      settledAt: expect.any(Number),
      outcome: 'threw',
    })
  )
})

it('bounds completed lstat evidence and keeps snapshots detached from later completion', async () => {
  const port = nativeSyscalls({ lstat: async () => ({ size: 3 }) })
  const snapshot = Reflect.get(new ExchangeTrace().snapshot(), 'nativeLstat')
  const saved = JSON.stringify(snapshot)
  for (let n = 0; n < 100; n++) await port.lstat()
  const after = Reflect.get(new ExchangeTrace().snapshot(), 'nativeLstat')
  expect(after.pending).toEqual([])
  expect(after.recent).toHaveLength(16)
  expect(after.slow.length).toBeLessThanOrEqual(8)
  expect(after.recent).not.toBe(snapshot.recent)
  expect(JSON.stringify(snapshot)).toBe(saved)
})

it('reports four long pending native sync calls by kind in a live exchange snapshot', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const release = deferred()
  const handles = nativeDiagnostics({ sync: () => release.promise }, () => {})
  const jobs = Array.from({ length: 4 }, () => handles.sync())
  try {
    now.mockReturnValue(12000)
    expect(Reflect.get(new ExchangeTrace().snapshot(), 'nativeIo')).toMatchObject({
      guarded: {
        pending: 4,
        longPending: 4,
        byKind: {
          sync: { pending: 4, longPending: 4, oldestMs: 11000 },
        },
      },
    })
  } finally {
    release.resolve()
    await Promise.all(jobs)
    now.mockRestore()
  }
  expect(Reflect.get(new ExchangeTrace().snapshot(), 'nativeIo').guarded.pending).toBe(0)
})

it('distinguishes guarded opens from their syscall and tracks handle sync and failed reads', async () => {
  const opening = deferred<{ sync(): Promise<void>; read(): Promise<void> }>()
  const syncing = deferred()
  const host = { open: () => opening.promise }
  const original = host.open
  const syscalls = nativeSyscalls(host)
  expect(nativeSyscalls(host)).toBe(syscalls)
  expect(nativeSyscalls(syscalls)).toBe(syscalls)
  const port = nativeDiagnostics(syscalls, () => {})
  const work = port.open()
  try {
    expect(nativeIoSnapshot()).toMatchObject({
      guarded: { pending: 1, byKind: { open: { pending: 1 } } },
      syscall: { pending: 1, byKind: { open: { pending: 1 } } },
    })
  } finally {
    opening.resolve({
      sync: () => syncing.promise,
      read: async () => {
        throw Error('sample I/O')
      },
    })
  }
  const handle = await work
  const sync = handle.sync()
  try {
    expect(nativeIoSnapshot()).toMatchObject({
      guarded: { pending: 1, byKind: { sync: { pending: 1 } } },
      syscall: { pending: 1, byKind: { sync: { pending: 1 } } },
    })
  } finally {
    syncing.resolve()
    await sync
  }
  await expect(handle.read()).rejects.toThrow('sample I/O')
  expect(nativeIoSnapshot()).toEqual({
    guarded: { pending: 0, longPending: 0, byKind: {} },
    syscall: { pending: 0, longPending: 0, byKind: {} },
  })
  expect(host.open).toBe(original)
})

it('counts native calls and handle calls without wrapping the host object itself', async () => {
  const calls: string[] = []
  const handle = { write: async () => {}, close: async () => {} }
  const host = { open: async (_path: string, _flags: string) => handle }
  const wrapped = nativeDiagnostics(host, (operation) => calls.push(operation))
  const result = await wrapped.open('sample.tmp', 'wx')
  await result.write()
  await result.close()
  expect(calls).toEqual(['native open wx', 'native write', 'native close'])
  expect(await host.open('sample.tmp', 'wx')).toBe(handle)
})

it('retains the owning file path for native handle reads and closes', async () => {
  const paths: (readonly string[] | undefined)[] = []
  const wrapped = nativeDiagnostics(
    {
      open: async (_path: string, _flags: string) => ({
        read: async () => {},
        close: async () => {},
      }),
    },
    (_operation, _startedAt, _outcome, names) => paths.push(names)
  )
  const handle = await wrapped.open('/vault/Notes/sample.md', 'r')
  await handle.read()
  await handle.close()
  expect(paths).toEqual([
    ['/vault/Notes/sample.md'],
    ['/vault/Notes/sample.md'],
    ['/vault/Notes/sample.md'],
  ])
})
