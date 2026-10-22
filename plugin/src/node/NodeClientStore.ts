import type { ClientState, ClientStore } from '@abele/node-client'
import { NodeEventSchema, TargetChangedRefusalSchema, validateParams } from '@abele/node-protocol'
import { chatMovedNotice } from './expectedTarget'
import { z } from 'zod'
import { retainPromptAnswerIdentity } from './promptAnswers'
import { FileDraftSchema, type FileDraft } from './fileDrafts'
import { DelegationStorageSchema, type DelegationStorage } from './delegation'
import { NodeMutationRecordSchema, type NodeMutationRecord } from '@/ai/tools/node/mutations'
import { ManagerOperationSchema, type ManagerOperation } from './NodeManagerController'
import { ClientJournal } from './clientJournal'
import { ClientArtifacts } from './clientArtifacts'
import { NodeLetterSchema, activeNodeLetters, type NodeLetter } from './nodeChatLetters'
import type { ObsidianExecutionReceipt } from './NodeObsidianExecutor'

export interface NodeClientState extends ClientState {
  nodeLetters?: Record<string, NodeLetter>

  obsidianSessions?: Record<string, string>
  /** Local execution evidence. Reconnect resends outcomes, never handler effects. */
  obsidianExecutions?: Record<string, ObsidianExecutionReceipt>
  managerOperations?: Record<string, ManagerOperation>
  chatMutations?: Record<string, NodeMutationRecord>
  delegation?: DelegationStorage
  fileDrafts?: Record<string, FileDraft>
  /** Unsent composer text is local only; reconnect never admits it to the outbox. */
  chatDrafts?: Record<string, { text: string; notice: string }>
  /** Exact submitted bytes stay hidden until a guarded turn has a terminal receipt. */
  turnDrafts?: Record<string, { sessionId: string; text: string }>
  /** Owner intents retain unknown operations and successful mkdir paths pending registration. */
  nodePathIntents?: Record<string, { id: string; method: string; params: unknown; result?: string }>
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
    nodeLetters: z.record(z.string(), NodeLetterSchema).optional(),

    obsidianSessions: z.record(z.string(), z.string()).optional(),
    obsidianExecutions: z
      .record(
        z.string(),
        z
          .object({
            state: z.enum(['executing', 'succeeded', 'failed', 'outcome_unknown']),
            sessionId: z.string().optional(),
            runId: z.string().optional(),
            at: z.number().optional(),
            result: z.record(z.string(), z.unknown()),
          })
          .strict()
      )
      .optional(),
    operationRequests: z
      .record(z.string(), z.object({ method: z.string(), params: z.unknown() }).strict())
      .optional(),
    managerOperations: z.record(z.string(), ManagerOperationSchema).optional(),
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
          .object({
            id: z.string().min(1).max(128),
            method: z.string(),
            params: z.unknown(),
            result: z.string().min(1).optional(),
          })
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

/** Everything but the streamed journal and caches: what must reach the disk before it counts. */
function intentOf(state: NodeClientState): string {
  return JSON.stringify(metadataOf(state, ['cursors']))
}

function metadataOf(state: NodeClientState, omit: string[] = []) {
  return Object.fromEntries(
    Object.keys(state)
      .filter((key) => !['events', 'artifactData', ...omit].includes(key))
      .map((key) => [key, state[key as keyof NodeClientState]])
  )
}

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
  const abandoned = new Set(
    Object.entries(state.nodeLetters ?? {})
      .filter(([id, letter]) => letter.status === 'pending' && !activeNodeLetters.has(id))
      .map(([id, letter]) => {
        letter.status = 'interrupted'
        return id
      })
  )
  return { ...state, events, outbox: outbox.filter((entry) => !abandoned.has(entry.operation_id)) }
}

/**
 * A look at the store that changes nothing: a read-only transaction where the store has one,
 * which neither writes the state back nor waits for the disk. A chat reads the store after every
 * event; doing that through `transaction` rewrote and flushed the whole state each time.
 */
export function readStore<T>(store: ClientStore, look: (state: NodeClientState) => T): Promise<T> {
  return store instanceof NodeClientStore
    ? store.read(look)
    : store.transaction((state) => look(state as NodeClientState))
}

/** One database per enrolled installation, never a vault file or a transferable setting. */
export class NodeClientStore implements ClientStore {
  private database?: Promise<IDBDatabase>
  private readonly journal = new ClientJournal()
  private readonly artifacts = new ClientArtifacts()
  constructor(
    private readonly namespace: string,
    private readonly factory: IDBFactory = indexedDB
  ) {}

  private open(): Promise<IDBDatabase> {
    return (this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open(`abele-node-${this.namespace}`, 2)
      request.onupgradeneeded = (event) => {
        const db = request.result
        if (!db.objectStoreNames.contains('client')) db.createObjectStore('client')
        db.createObjectStore('journal')
        if (event.oldVersion === 1) {
          const tx = request.transaction!
          const legacy = tx.objectStore('client').get('state')
          legacy.onsuccess = () => {
            try {
              ClientJournal.migrate(tx, readState(legacy.result))
            } catch {
              tx.abort()
            }
          }
        }
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
      // The readwrite lock isolates even separate plugin windows/handles. A key count
      // prevents automatic commit across an asynchronous callback without cloning history.
      // Relaxed first: most transactions only add the events a node streamed, which this device
      // reads again from the node if a crash loses them. One that changed anything else (what
      // was sent, receipts, drafts) completes only after a strict flush, below.
      const tx = db.transaction(['client', 'journal'], 'readwrite', { durability: 'relaxed' })
      let intent = false
      let executionIntent = false
      const store = tx.objectStore('client')
      let result: T
      let failure: unknown
      let pending = true
      let finish: (() => void) | undefined
      let journal: Awaited<ReturnType<ClientJournal['load']>> | undefined
      let artifacts: Awaited<ReturnType<ClientArtifacts['load']>> | undefined
      tx.oncomplete = () => {
        journal?.committed()
        artifacts?.committed()
        if (!intent) return resolve(result)
        // A strict commit after it puts this one on disk too: transactions commit in order.
        let flush: IDBTransaction
        try {
          flush = db.transaction('client', 'readwrite', { durability: 'strict' })
        } catch (error) {
          // A handler may start only after its receipt has reached a strict commit.
          if (executionIntent)
            return reject(
              error instanceof Error
                ? error
                : new Error('Node receipt flush failed', { cause: error })
            )
          // The store is closing: the commit happened, the flush is up to the browser now.
          return resolve(result)
        }
        flush.objectStore('client').put(Date.now(), 'flushed')
        flush.oncomplete = () => resolve(result)
        flush.onabort = flush.onerror = () =>
          reject(flush.error ?? new Error('Node store flush failed'))
      }
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
        if (finish) {
          try {
            finish()
            pending = false
          } catch (error) {
            failure = error
            pending = false
            tx.abort()
          }
          return
        }
        const request = store.count('state')
        request.onsuccess = keepAlive
      }
      const request = store.get('state')
      request.onsuccess = () => {
        keepAlive()
        void (async () => {
          try {
            const state = readState(request.result)
            const metadataBefore = JSON.stringify(metadataOf(request.result ?? state))
            ;[journal, artifacts] = await Promise.all([
              this.journal.load(tx, state),
              this.artifacts.load(tx, state),
            ])
            const before = intentOf(state)
            const executionsBefore = JSON.stringify(state.obsidianExecutions)
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
            intent = intentOf(state) !== before
            executionIntent = JSON.stringify(state.obsidianExecutions) !== executionsBefore
            // An awaited callback may finish in a timer/network task, where IndexedDB is
            // inactive even with pending requests. Commit in the next count success handler.
            finish = () => {
              journal!.save()
              artifacts!.save()
              const metadata = metadataOf(state)
              if (
                request.result === undefined ||
                JSON.stringify(metadata) !== metadataBefore ||
                request.result?.artifactData
              )
                store.put({ ...metadata, events: {} }, 'state')
            }
          } catch (error) {
            failure = error
            pending = false
            tx.abort()
          }
        })()
      }
    })
  }

  async read<T>(look: (state: NodeClientState) => T): Promise<T> {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['client', 'journal'], 'readonly')
      const request = tx.objectStore('client').get('state')
      let result: T
      let journal: Awaited<ReturnType<ClientJournal['load']>> | undefined
      let artifacts: Awaited<ReturnType<ClientArtifacts['load']>> | undefined
      request.onsuccess = () => {
        void (async () => {
          try {
            const state = readState(request.result)
            ;[journal, artifacts] = await Promise.all([
              this.journal.load(tx, state),
              this.artifacts.load(tx, state),
            ])
            result = look(state)
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)))
            tx.abort()
          }
        })()
      }
      tx.oncomplete = () => {
        journal?.committed()
        artifacts?.committed()
        resolve(result)
      }
      tx.onerror = () => reject(tx.error ?? new Error('Node store read failed'))
    })
  }

  close(): void {
    void this.database?.then((db) => db.close())
  }
}
