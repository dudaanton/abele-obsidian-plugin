import type { SessionFetch, SessionNet } from './desktopNet'

export type SessionInvoke = (operation: string, id: string, input?: unknown) => Promise<unknown>
interface Head {
  status: number
  statusText: string
  headers: [string, string][]
  body: boolean
}

/** Plain IPC messages: no remote response, reader, buffer or controller proxies. */
function headerPairs(headers: Headers): [string, string][] {
  const pairs: [string, string][] = []
  headers.forEach((value, name) => pairs.push([name, value]))
  return pairs
}
export function asyncDesktopSession(invoke: SessionInvoke): SessionNet {
  const session: SessionFetch = {
    fetch: async (input, init) => {
      const id = crypto.randomUUID()
      const signal = init?.signal
      const abort = () => {
        void invoke('cancel', id).catch(() => {})
      }
      const finish = () => signal?.removeEventListener('abort', abort)
      signal?.throwIfAborted()
      signal?.addEventListener('abort', abort, { once: true })
      try {
        const head = (await invoke('start', id, {
          url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          method: init?.method,
          headers: headerPairs(new Headers(init?.headers)),
          body: init?.body,
        })) as Head
        signal?.throwIfAborted()
        if (!head.body) {
          finish()
          return new Response(null, head)
        }
        return new Response(
          new ReadableStream<Uint8Array>(
            {
              async pull(controller) {
                try {
                  signal?.throwIfAborted()
                  const next = (await invoke('read', id)) as { done: boolean; value?: Uint8Array }
                  signal?.throwIfAborted()
                  if (next.done) {
                    finish()
                    controller.close()
                  } else controller.enqueue(next.value)
                } catch (error) {
                  finish()
                  abort()
                  controller.error(error)
                }
              },
              async cancel() {
                finish()
                await invoke('cancel', id)
              },
            },
            { highWaterMark: 0 }
          ),
          head
        )
      } catch (error) {
        finish()
        abort()
        throw error
      }
    },
  }
  return {
    session,
    controller: () => new AbortController(),
    bytes: (bytes) => new Uint8Array(bytes),
    body: (bytes) => new Uint8Array(bytes),
    headerEntries: headerPairs,
  }
}

interface MainOwner {
  id: number
  session: SessionFetch
  once(event: string, callback: () => void): void
  removeListener(event: string, callback: () => void): void
}
export interface MainSessionHost {
  webContents: { fromId(id: number): MainOwner }
  ipcMain: {
    handle(
      channel: string,
      handler: (
        event: { sender: { id: number } },
        operation: string,
        id: string,
        input?: unknown
      ) => Promise<unknown>
    ): void
    removeHandler(channel: string): void
  }
}

/** Self-contained main-process installer. Its compiled function is sent once at setup. */
export function installMainSession(host: MainSessionHost, channel: string, ownerId: number): void {
  const owner = host.webContents.fromId(ownerId)
  const key = Symbol.for('abele.sync.desktop-session-bridge-v1')
  const previous = Reflect.get(owner, key)
  if (typeof previous === 'function') previous()
  const requests = new Map<
    string,
    {
      controller: AbortController
      reader?: ReadableStreamDefaultReader<Uint8Array>
      tail?: Uint8Array
    }
  >()
  const dispose = () => {
    host.ipcMain.removeHandler(channel)
    for (const request of requests.values()) request.controller.abort()
    requests.clear()
    owner.removeListener('destroyed', dispose)
    if (Reflect.get(owner, key) === dispose) Reflect.deleteProperty(owner, key)
  }
  Reflect.set(owner, key, dispose)
  owner.once('destroyed', dispose)
  host.ipcMain.handle(channel, async (event, operation, id, input) => {
    if (event.sender.id !== ownerId) throw new Error('Desktop session belongs to another window')
    if (operation === 'cancel') {
      const request = requests.get(id)
      requests.delete(id)
      request?.controller.abort()
      await request?.reader?.cancel().catch(() => {})
      return null
    }
    if (operation === 'read') {
      const request = requests.get(id)
      if (!request?.reader) throw new Error('Desktop response is no longer available')
      try {
        const next = request.tail?.length
          ? { done: false, value: request.tail }
          : await request.reader.read()
        if (next.done) requests.delete(id)
        if (!next.value) return { done: true }
        request.tail = next.value.subarray(64 * 1024)
        return { done: false, value: next.value.slice(0, 64 * 1024) }
      } catch (error) {
        requests.delete(id)
        request.controller.abort()
        throw error
      }
    }
    if (operation !== 'start' || requests.has(id))
      throw new Error('Invalid desktop session operation')
    const request = input as {
      url: string
      method?: string
      headers: [string, string][]
      body?: BodyInit
    }
    const url = new URL(request.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Desktop session requires an HTTP URL without credentials')
    const active = {
      controller: new AbortController(),
      reader: undefined as ReadableStreamDefaultReader<Uint8Array> | undefined,
    }
    requests.set(id, active)
    try {
      const response = await owner.session.fetch(url.href, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal: active.controller.signal,
      })
      active.controller.signal.throwIfAborted()
      active.reader = response.body?.getReader()
      if (!active.reader) requests.delete(id)
      const headers: [string, string][] = []
      response.headers.forEach((value, name) => headers.push([name, value]))
      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        body: !!active.reader,
      }
    } catch (error) {
      requests.delete(id)
      active.controller.abort()
      throw error
    }
  })
}

export interface AsyncRemote {
  getCurrentWebContents(): { id: number }
  getGlobal(name: 'Function'): (...args: string[]) => (...args: unknown[]) => void
  require(name: string): unknown
}
export function bridgedDesktopSession(
  remote: AsyncRemote,
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
): SessionNet {
  const channel = 'abele-sync-session-' + crypto.randomUUID()
  const install = remote.getGlobal('Function')(
    'host',
    'channel',
    'ownerId',
    `return (${installMainSession.toString()})(host, channel, ownerId)`
  )
  install(remote.require('electron'), channel, remote.getCurrentWebContents().id)
  return asyncDesktopSession((operation, id, input) => invoke(channel, operation, id, input))
}
