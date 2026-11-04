import { expect, it, vi } from 'vitest'
import { nativeDiagnostics, nativeIoSnapshot, nativeSyscalls } from '@/sync/nativeDiagnostics'
import { ExchangeTrace } from '@/sync/exchangeTrace'
import { deferred } from '../helpers/deferred'

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
