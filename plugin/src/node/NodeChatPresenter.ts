import { computed, ref, watch, type WatchStopHandle } from 'vue'
import { z } from 'zod'
import type { FakeStep, Prompt } from '@abele/node-client'
import type { ChatPresentationSession, ChatReference } from '@/ai/ChatPresentationSession'
import type { ChatDraft } from '@/ai/types'
import { reduceTranscript } from './NodeTranscriptReducer'
import type { NodeConnection } from './NodeService'
import type { NodeClientState } from './NodeClientStore'

const NodeReferenceSchema = z
  .object({
    kind: z.literal('node-session'),
    nodeId: z.string().min(1).max(128),
    registrationId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    title: z.string().max(256),
  })
  .strict()

export class NodeChatPresenter implements ChatPresentationSession {
  readonly capabilities = {
    branches: false,
    rewind: false,
    editHistory: false,
    attachments: false,
    vaultResources: false,
  }
  readonly projection = ref(reduceTranscript([]))
  readonly messages = computed(() => this.projection.value.messages)
  readonly isStreaming = computed(() => this.projection.value.state === 'running')
  readonly label = computed(() => this.reference.title)
  readonly provider = computed(() => this.projection.value.session?.provider ?? 'fake')
  readonly workspaceId = computed(() => this.projection.value.session?.workspace_id)
  readonly nativeSessionId = computed(() => this.projection.value.session?.native_session_id)
  readonly draft = ref<ChatDraft>({ text: '', attachments: [] })
  readonly queued = ref<{ id: string; text: string }[]>([])
  readonly error = ref('')
  readonly rejected = ref<{ id: string; text: string; error: string }[]>([])
  readonly state = computed(() =>
    this.connection.state.value !== 'connected'
      ? 'offline'
      : this.queued.value.length
        ? 'queued'
        : this.projection.value.state
  )
  private stopEvent: () => void
  private stopWatch: WatchStopHandle
  private destroyed = false
  private refreshing?: Promise<void>
  private dirty = false
  private readonly failedArtifacts = new Set<string>()

  constructor(
    readonly reference: Extract<ChatReference, { kind: 'node-session' }>,
    readonly connection: NodeConnection
  ) {
    this.reference = NodeReferenceSchema.parse(reference)
    const expected = connection.client.target.expected_node_id
    if (expected && expected !== reference.nodeId)
      throw new Error('Node tab identity does not match its registration')
    this.stopEvent = connection.client.onEvent((event) => {
      if (event.stream_id === reference.sessionId)
        void this.refresh().catch((e: unknown) => this.report(e))
    })
    this.stopWatch = watch(connection.state, (state) => {
      if (state === 'connected')
        void connection.client
          .subscribe(reference.sessionId)
          .then(() => this.refresh())
          .catch((e: unknown) => this.report(e))
      else void this.refresh().catch((e: unknown) => this.report(e))
    })
  }
  get id(): string {
    return `node:${this.reference.registrationId}:${this.reference.sessionId}`
  }

  async load(): Promise<void> {
    await this.refresh()
    if (this.destroyed) return
    try {
      await this.connection.connect()
      if (this.destroyed) return
      await this.connection.client.subscribe(this.reference.sessionId)
      await this.refresh()
    } catch (error) {
      this.report(error)
    }
  }

  refresh(): Promise<void> {
    this.dirty = true
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      while (this.dirty && !this.destroyed) {
        this.dirty = false
        const client = this.connection.client
        const { history, pending, rejected, artifactData } = await client.store.transaction(
          (raw) => {
            const state = raw as NodeClientState
            return {
              artifactData: state.artifactData ?? {},
              history: state.events[this.reference.sessionId] ?? [],
              pending: state.outbox,
              rejected: Object.entries(state.results)
                .filter(([, r]) => r.error && r.input?.sessionId === this.reference.sessionId)
                .map(([id, r]) => ({ id, text: r.input!.text, error: r.error! })),
            }
          }
        )
        if (this.destroyed) return
        const hydrated = []
        for (const event of history) {
          const data = event.data as Record<string, unknown>
          const id = data?.artifact_id
          if (
            typeof id === 'string' &&
            [
              'claude.message.final',
              'claude.tool.call',
              'claude.tool.result',
              'claude.thinking',
              'claude.block.delta',
            ].includes(event.type)
          ) {
            if (!artifactData[id] && client.connected && !this.failedArtifacts.has(id)) {
              try {
                const payload: unknown = JSON.parse(await this.artifact(id))
                if (!payload || typeof payload !== 'object' || Array.isArray(payload))
                  throw new Error('Invalid normalized artifact')
                artifactData[id] = payload as Record<string, unknown>
                await client.store.transaction((raw) => {
                  ;((raw as NodeClientState).artifactData ??= {})[id] = artifactData[id]
                })
              } catch (error) {
                this.failedArtifacts.add(id)
                this.report(error)
              }
            }
            if (artifactData[id]) {
              hydrated.push({
                ...event,
                data: {
                  ...artifactData[id],
                  run_id: data.run_id,
                  ...(data.late ? { late: true } : {}),
                },
              })
              continue
            }
          }
          hydrated.push(event)
        }
        if (this.destroyed) return
        this.projection.value = reduceTranscript(hydrated)
        this.rejected.value = rejected
        this.queued.value = pending
          .filter(
            (entry) =>
              entry.method === 'session.send' &&
              (entry.params as { session_id?: string }).session_id === this.reference.sessionId
          )
          .map((entry) => ({
            id: entry.operation_id,
            text: (entry.params as { text: string }).text,
          }))
      }
    })().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  async send(text: string, script?: FakeStep[]): Promise<void> {
    this.error.value = ''
    const client = this.connection.client
    let previous: Set<string> | undefined
    try {
      previous = await client.store.transaction(
        (s) => new Set([...s.outbox.map((e) => e.operation_id), ...Object.keys(s.results)])
      )
      const result = await client.send(
        this.reference.sessionId,
        text,
        await client.cursor(this.reference.sessionId),
        script
      )
      const receipt = await client.operationResult(result.operation_id)
      if (receipt?.error) {
        this.error.value = `Not accepted: ${receipt.error}`
        this.draft.value.text = text
      }
    } catch (error) {
      this.report(error)
      const persisted = previous
        ? await client.store
            .transaction((s) =>
              [...s.outbox.map((e) => e.operation_id), ...Object.keys(s.results)].some(
                (id) => !previous!.has(id)
              )
            )
            .catch(() => true)
        : false
      // A failed local commit keeps the draft; an unknown remote outcome stays in the outbox.
      if (!persisted) this.draft.value.text = text
    } finally {
      await this.refresh().catch((error: unknown) => this.report(error))
    }
  }

  async answer(prompt: Prompt, choice: 'allow' | 'deny'): Promise<void> {
    this.error.value = ''
    try {
      await this.connection.client.answerPrompt(prompt, choice)
    } catch (error) {
      this.report(error)
    }
    await this.refresh()
  }

  async interrupt(runId: string): Promise<void> {
    try {
      await this.connection.client.interrupt(this.reference.sessionId, runId)
    } catch (error) {
      this.report(error)
    }
    await this.refresh()
  }

  async cancelInput(inputId: string): Promise<void> {
    try {
      await this.connection.client.cancelInput(this.reference.sessionId, inputId)
    } catch (error) {
      this.report(error)
    }
    await this.refresh()
  }

  /** File browsing is a later API. Never interpret node paths as vault paths. */
  openResource(_path: string): void {
    this.error.value =
      'Opening node files is not supported yet. Use the workspace status and diff preview.'
  }

  async artifact(artifactId: string): Promise<string> {
    const parts: Uint8Array[] = []
    let offset = 0
    while (true) {
      const result = (await this.connection.client.request('artifact.read', {
        session_id: this.reference.sessionId,
        artifact_id: artifactId,
        offset,
        length: 128 * 1024,
      })) as { offset: number; total: number; base64: string }
      if (
        result.offset !== offset ||
        !Number.isSafeInteger(result.total) ||
        result.total < offset ||
        result.total > 1024 * 1024 ||
        typeof result.base64 !== 'string'
      )
        throw new Error('Invalid node artifact')
      const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))
      if (
        bytes.length > 128 * 1024 ||
        offset + bytes.length > result.total ||
        (!bytes.length && offset < result.total)
      )
        throw new Error('Incomplete node artifact')
      parts.push(bytes)
      offset += bytes.length
      if (offset >= result.total) break
    }
    const all = new Uint8Array(offset)
    let start = 0
    for (const part of parts) {
      all.set(part, start)
      start += part.length
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(all)
  }

  private report(error: unknown): void {
    if (!this.destroyed)
      this.error.value = error instanceof Error ? error.message : 'Node request failed'
  }
  destroy(): void {
    this.destroyed = true
    this.stopEvent()
    this.stopWatch()
  }
}
