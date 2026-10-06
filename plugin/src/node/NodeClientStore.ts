import type { ClientState, ClientStore } from '@abele/node-client'
import { NodeEventSchema, validateParams } from '@abele/node-protocol'
import { z } from 'zod'

export interface NodeClientState extends ClientState {
  results: Record<
    string,
    { result?: unknown; error?: string; input?: { sessionId: string; text: string } }
  >
}

const StateSchema = z
  .object({
    node_id: z.string().min(1).max(128).optional(),
    installation_id: z.string().min(1).max(128).optional(),
    cursors: z.record(z.string(), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
    events: z.record(z.string(), z.array(z.unknown())),
    outbox: z.array(
      z.object({ operation_id: z.string().min(1), method: z.string(), params: z.unknown() })
    ),
    results: z.record(
      z.string(),
      z.object({
        result: z.unknown().optional(),
        error: z.string().optional(),
        input: z
          .object({ sessionId: z.string().min(1).max(128), text: z.string().max(32768) })
          .optional(),
      })
    ),
  })
  .strict()

function readState(raw: unknown): NodeClientState {
  if (raw === undefined) return { cursors: {}, events: {}, outbox: [], results: {} }
  const state = StateSchema.parse(raw)
  const events = Object.fromEntries(
    Object.entries(state.events).map(([key, values]) => [
      key,
      values.map((e) => NodeEventSchema.parse(e)),
    ])
  )
  const outbox = state.outbox.map((entry) => ({
    ...entry,
    params: validateParams(entry.method, entry.params),
  }))
  return { ...state, events, outbox }
}

/** One database per enrolled installation, never a vault file or a transferable setting. */
export class NodeClientStore implements ClientStore {
  private database?: Promise<IDBDatabase>
  constructor(
    private readonly namespace: string,
    private readonly factory: IDBFactory = indexedDB
  ) {}

  private open(): Promise<IDBDatabase> {
    return (this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open(`abele-node-${this.namespace}`, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('client')
      }
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Close other windows using this node store'))
    }))
  }

  async transaction<T>(work: (state: NodeClientState) => T | Promise<T>): Promise<T> {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      // The readwrite lock isolates even separate plugin windows/handles. A keepalive read
      // prevents IndexedDB's automatic commit while an injected callback awaits work.
      const tx = db.transaction('client', 'readwrite', { durability: 'strict' })
      const store = tx.objectStore('client')
      let result: T
      let failure: unknown
      let pending = true
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => {
        const error = failure ?? tx.error
        reject(
          error instanceof Error
            ? error
            : new Error('Node store transaction aborted', { cause: error })
        )
      }
      tx.onerror = () => {
        failure ??= tx.error
      }
      const keepAlive = () => {
        if (!pending) return
        const request = store.get('state')
        request.onsuccess = keepAlive
      }
      const request = store.get('state')
      request.onsuccess = () => {
        keepAlive()
        void (async () => {
          try {
            const state = readState(request.result)
            const submitted = state.outbox.filter((entry) => entry.method === 'session.send')
            result = structuredClone(await work(state))
            for (const entry of submitted) {
              const receipt = state.results[entry.operation_id]
              if (receipt?.error) {
                const input = entry.params as { session_id: string; text: string }
                receipt.input = { sessionId: input.session_id, text: input.text }
              }
            }
            store.put(state, 'state')
            pending = false
          } catch (error) {
            failure = error
            pending = false
            tx.abort()
          }
        })()
      }
    })
  }

  close(): void {
    void this.database?.then((db) => db.close())
  }
}
