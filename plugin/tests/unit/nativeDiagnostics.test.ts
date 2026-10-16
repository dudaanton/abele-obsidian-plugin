import { expect, it } from 'vitest'
import { nativeDiagnostics } from '@/sync/nativeDiagnostics'

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
