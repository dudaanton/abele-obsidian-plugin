import type { ClientState, ClientStore } from '@abele/node-client'
import { NodeEventSchema, TargetChangedRefusalSchema, validateParams } from '@abele/node-protocol'
import { chatMovedNotice } from './expectedTarget'
import { z } from 'zod'
import { retainPromptAnswerIdentity } from './promptAnswers'
import { FileDraftSchema, type FileDraft } from './fileDrafts'
import { DelegationStorageSchema, type DelegationStorage } from './delegation'
import { NodeMutationRecordSchema, type NodeMutationRecord } from '@/ai/tools/node/mutations'
import { trimWindows } from './sessionWindow'

export interface NodeClientState extends ClientState {
  chatMutations?: Record<string, NodeMutationRecord>
  delegation?: DelegationStorage
  fileDrafts?: Record<string, FileDraft>
  /** Unsent composer text is local only; reconnect never admits it to the outbox. */
  chatDrafts?: Record<string, { text: string; notice: string }>
  /** Exact submitted bytes stay hidden until a guarded turn has a terminal receipt. */
  turnDrafts?: Record<string, { sessionId: string; text: string }>
  /** Owner folder/worktree intents retain one operation ID until a typed receipt is known. */
  nodePathIntents?: Record<string, { id: string; method: string; params: unknown }>
  /** Replaceable artifact payload cache; journal references remain untouched. */
  artifactData?: Record<string, Record<string, unknown>>
  /** Streams kept as a window of their latest events (`sessionWindow.ts`): how many. */
  windows?: Record<string, number>
  results: Record<
    string,
    {
      result?: unknown
      error?: string
      request?: { method: string; params: unknown }
      input?: { sessionId: string; text: string }
      answer?: { sessionId: string; promptId: string; choice: 'allow' | 'deny'; value?: string }
    }
  >
}

const StateSchema = z
  .object({
    operationRequests: z
      .record(z.string(), z.object({ method: z.string(), params: z.unknown() }).strict())
      .optional(),
    chatMutations: z.record(z.string(), NodeMutationRecordSchema).optional(),
    delegation: DelegationStorageSchema.optional(),
    fileDrafts: z.record(z.string(), FileDraftSchema).optional(),
    chatDrafts: z
      .record(z.string(), z.object({ text: z.string(), notice: z.string() }).strict())
      .optional(),
    turnDrafts: z
      .record(
        z.string(),
        z.object({ sessionId: z.string().min(1).max(128), text: z.string() }).strict()
      )
      .optional(),
    nodePathIntents: z
      .record(
        z.string(),
        z
          .object({ id: z.string().min(1).max(128), method: z.string(), params: z.unknown() })
          .strict()
      )
      .optional(),
    artifactData: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    windows: z.record(z.string(), z.number().int().positive().max(100000)).optional(),
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
        request: z.object({ method: z.string(), params: z.unknown() }).optional(),
        answer: z
          .object({
            sessionId: z.string().min(1).max(128),
            promptId: z.string().min(1).max(128),
            choice: z.enum(['allow', 'deny']),
            value: z.string().max(32768).optional(),
          })
          .optional(),
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
  for (const request of Object.values(state.operationRequests ?? {}))
    validateParams(request.method, request.params)
  for (const intent of Object.values(state.nodePathIntents ?? {}))
    validateParams(intent.method, intent.params)
  const outbox = state.outbox.map((entry) => {
    validateParams(entry.method, entry.params)
    // Validation may add defaults in a newer protocol. Never rewrite a retry's body.
    return entry
  })
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
            const submitted = state.outbox.slice()
            result = structuredClone(await work(state))
            retainPromptAnswerIdentity(state, submitted)
            // Retain controller receipts, including approvals that settle after UI disconnection.
            for (const entry of submitted.filter(
              (e) => e.method.startsWith('delegation.') || e.method === 'workspace.remove'
            )) {
              const receipt = state.results[entry.operation_id]
              if (receipt) receipt.request = { method: entry.method, params: entry.params }
            }
            for (const entry of submitted.filter((entry) =>
              ['session.send', 'review.submit'].includes(entry.method)
            )) {
              const receipt = state.results[entry.operation_id]
              if (receipt?.error) {
                const input = entry.params as { session_id: string; text: string }
                receipt.input = {
                  sessionId: input.session_id,
                  text: entry.method === 'review.submit' ? 'Review batch' : input.text,
                }
              }
            }
            for (const [id, draft] of Object.entries(state.turnDrafts ?? {})) {
              const receipt = state.results[id]
              if (!receipt) continue
              if (TargetChangedRefusalSchema.safeParse(receipt.result).success) {
                state.chatDrafts ??= {}
                if (!state.chatDrafts[draft.sessionId]?.text)
                  state.chatDrafts[draft.sessionId] = { text: draft.text, notice: chatMovedNotice }
              }
              delete state.turnDrafts?.[id]
            }
            // A long session's journal stays on the node; the device keeps its latest window.
            trimWindows(state)
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
