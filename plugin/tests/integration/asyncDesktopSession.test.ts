// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  bridgedDesktopSession,
  type AsyncRemote,
  type MainSessionHost,
} from '@/sync/asyncDesktopSession'
import { desktopTransport } from '@/sync/desktopTransport'

function bridge(fetch: typeof globalThis.fetch) {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const events = new Set<() => void>()
  const owner = {
    id: 7,
    session: { fetch },
    once: (_: string, fn: () => void) => events.add(fn),
    removeListener: (_: string, fn: () => void) => events.delete(fn),
  }
  const main = {
    webContents: { fromId: () => owner },
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) =>
        handlers.set(channel, fn),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
  } as unknown as MainSessionHost
  const setup = vi.fn()
  const remote = {
    getCurrentWebContents: () => {
      setup()
      return owner
    },
    getGlobal: () => {
      setup()
      return Function
    },
    require: () => {
      setup()
      return main
    },
  } as unknown as AsyncRemote
  const calls: { operation: unknown; bytes?: number }[] = []
  const invoke = async (channel: string, ...args: unknown[]) => {
    const answer = await handlers.get(channel)!({ sender: { id: 7 } }, ...structuredClone(args))
    const value = (answer as { value?: Uint8Array })?.value
    calls.push({ operation: args[0], bytes: value?.buffer.byteLength })
    return structuredClone(answer)
  }
  return { remote, invoke, handlers, setup, calls, events }
}

it('runs the serialized main installer once and uses only async messages for HEAD and streamed bytes', async () => {
  const body = new Uint8Array(1024 * 1024).fill(9)
  const request = vi.fn<typeof fetch>(
    async (_input, init) =>
      new Response(init?.method === 'HEAD' ? null : body, {
        headers: { 'content-length': String(init?.method === 'HEAD' ? 0 : body.length) },
      })
  )
  const one = bridge(request)
  const host = bridgedDesktopSession(one.remote, one.invoke)
  const setup = one.setup.mock.calls.length
  const transport = desktopTransport(undefined, host)
  for (let i = 0; i < 100; i++)
    expect((await transport('https://sync.example/blob', { method: 'HEAD' })).status).toBe(200)
  expect(
    new Uint8Array(await (await transport('https://sync.example/blob')).arrayBuffer())
  ).toEqual(body)
  expect(one.setup).toHaveBeenCalledTimes(setup)
  expect(
    one.calls
      .filter((call) => call.operation === 'read')
      .every((call) => (call.bytes ?? 0) <= 64 * 1024)
  ).toBe(true)
  expect(request.mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true)
  expect(
    request.mock.calls.every(
      ([, init]) => init?.credentials === 'omit' && init.cache === 'no-store'
    )
  ).toBe(true)
  const [channel, handler] = [...one.handlers][0]!
  await expect(handler({ sender: { id: 8 } }, 'start', 'other', {})).rejects.toThrow(
    'another window'
  )
  bridgedDesktopSession(one.remote, one.invoke)
  expect(one.handlers.has(channel)).toBe(false)
  expect(one.handlers.size).toBe(1)
  for (const dispose of [...one.events]) dispose()
  expect(one.handlers.size).toBe(0)
})

it('aborts an in-flight native request and disposes its handler with the owning window', async () => {
  let signal: AbortSignal | undefined
  const one = bridge(async (_url, init) => {
    signal = init?.signal ?? undefined
    return new Promise((_resolve, reject) =>
      signal!.addEventListener('abort', () => reject(new Error('stopped')))
    )
  })
  const host = bridgedDesktopSession(one.remote, one.invoke)
  const controller = new AbortController()
  const work = host.session.fetch('https://sync.example/blob', { signal: controller.signal })
  const failed = expect(work).rejects.toThrow('stopped')
  await vi.waitFor(() => expect(signal).toBeDefined())
  controller.abort()
  await failed
  expect(signal?.aborted).toBe(true)
  for (const dispose of [...one.events]) dispose()
  expect(one.handlers.size).toBe(0)
})
