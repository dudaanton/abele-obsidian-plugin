import { computed, ref, watch, type WatchStopHandle } from 'vue'
import { z } from 'zod'
import type { FakeStep, Prompt } from '@abele/node-client'
import type { ChatPresentationSession, ChatReference } from '@/ai/ChatPresentationSession'
import type { ChatDraft } from '@/ai/types'
import { reduceTranscript } from './NodeTranscriptReducer'
import type { NodeConnection } from './NodeService'
import type { NodeClientState } from './NodeClientStore'
import { nodeQueueView } from './presentation'
import { promptAnswerStates, type PromptAnswerState } from './promptAnswers'
import { FrameCodec } from '@abele/channel-protocol'
import { NodeFilesModel } from './NodeFilesModel'
import { PromptSchema, validateParams } from '@abele/node-protocol'

const NORMALIZED_ARTIFACT_EVENTS = new Set([
  'claude.message.final',
  'claude.tool.call',
  'claude.tool.result',
  'claude.thinking',
  'claude.block.delta',
])
/** Immutable bytes that cannot be projected; transport/storage failures are retryable. */
class UnusableArtifactError extends Error {}

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
  readonly answers = ref<Record<string, PromptAnswerState>>({})
  private readonly receipts = ref<NodeClientState['results']>({})
  readonly presentation = computed(() =>
    nodeQueueView(
      this.messages.value,
      this.queued.value,
      this.projection.value.queuedInputs,
      this.receipts.value
    )
  )
  readonly state = computed(() =>
    this.connection.state.value !== 'connected'
      ? 'offline'
      : this.queued.value.length
        ? 'queued'
        : this.projection.value.state
  )
  private filesModel?: NodeFilesModel
  private filesOpener?: (model: NodeFilesModel, path?: string) => void
  private stopEvent: () => void
  private stopWatch: WatchStopHandle
  private destroyed = false
  private refreshing?: Promise<void>
  private dirty = false
  private readonly unusableArtifacts = new Set<string>()

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
        const { history, pending, rejected, artifactData, receipts } =
          await client.store.transaction((raw) => {
            const state = raw as NodeClientState
            return {
              receipts: state.results,
              artifactData: state.artifactData ?? {},
              history: state.events[this.reference.sessionId] ?? [],
              pending: state.outbox,
              rejected: Object.entries(state.results)
                .filter(([, r]) => r.error && r.input?.sessionId === this.reference.sessionId)
                .map(([id, r]) => ({ id, text: r.input!.text, error: r.error! })),
            }
          })
        if (this.destroyed) return
        this.answers.value = promptAnswerStates(
          { outbox: pending, results: receipts },
          this.reference.sessionId
        )
        const hydrated = []
        for (const event of history) {
          const data = event.data as Record<string, unknown>
          const id = data?.artifact_id
          if (typeof id === 'string' && NORMALIZED_ARTIFACT_EVENTS.has(event.type)) {
            if (!artifactData[id] && client.connected && !this.unusableArtifacts.has(id)) {
              try {
                artifactData[id] = await this.cacheArtifact(id, await this.readArtifact(id))
              } catch (error) {
                if (error instanceof UnusableArtifactError) this.unusableArtifacts.add(id)
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
        this.receipts.value = receipts
        this.queued.value = pending
          .filter(
            (entry) =>
              ['session.send', 'review.submit'].includes(entry.method) &&
              (entry.params as { session_id?: string }).session_id === this.reference.sessionId
          )
          .map((entry) => ({
            id: entry.operation_id,
            text:
              entry.method === 'review.submit'
                ? 'Review batch'
                : (entry.params as { text: string }).text,
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
    const client = this.connection.client
    try {
      prompt = PromptSchema.parse(prompt)
      if (prompt.session_id !== this.reference.sessionId)
        throw new Error('Prompt belongs to another session')
      if (prompt.state !== 'pending') return
      if (!client.connected) throw new Error('Reconnect before answering a prompt')
      const { session_id, prompt_id, run_id, revision, action_digest } = prompt
      const params = validateParams('prompt.answer', {
        session_id,
        prompt_id,
        run_id,
        revision,
        action_digest,
        choice,
      })
      const operationId = crypto.randomUUID()
      FrameCodec.encode({
        kind: 'request',
        request_id: 'validation',
        operation_id: operationId,
        method: 'prompt.answer',
        params,
      })
      // Admission and duplicate check share the store's lock, including across windows/reloads.
      const admission = await client.store.transaction((raw) => {
        const state = raw as NodeClientState
        const answers = promptAnswerStates(state, session_id)
        if (answers[prompt_id]) return { queued: false, answers }
        if (state.node_id !== this.reference.nodeId)
          throw new Error('Node identity does not match this prompt')
        state.outbox.push({ operation_id: operationId, method: 'prompt.answer', params })
        return { queued: true, answers: promptAnswerStates(state, session_id) }
      })
      this.answers.value = admission.answers
      if (admission.queued) {
        await client.flush()
        const receipt = await client.operationResult(operationId)
        if (!receipt) throw new Error('Answer sent; waiting for confirmation')
        if (receipt.error) throw new Error(`Answer not accepted: ${receipt.error}`)
      }
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

  /** A node resource never passes through vault-path resolution. */
  openResource(path: string): void {
    this.openFiles(path)
  }
  setFilesOpener(opener: (model: NodeFilesModel, path?: string) => void): () => void {
    this.filesOpener = opener
    return () => {
      if (this.filesOpener === opener) this.filesOpener = undefined
    }
  }
  openFiles(path?: string): void {
    const workspace = this.workspaceId.value
    if (!workspace) {
      this.error.value = 'This session has no workspace'
      return
    }
    if (!this.filesModel || this.filesModel.workspaceId !== workspace)
      this.filesModel = new NodeFilesModel(
        this.connection.client,
        this.reference.nodeId,
        workspace,
        this.reference.sessionId
      )
    if (this.filesOpener) this.filesOpener(this.filesModel, path)
    else this.error.value = 'Open this session in the chat to browse its files'
  }

  async artifact(artifactId: string): Promise<string> {
    this.error.value = ''
    const text = await this.readArtifact(artifactId)
    const normalized = await this.connection.client.store.transaction((raw) =>
      (raw.events[this.reference.sessionId] ?? []).some(
        (event) =>
          NORMALIZED_ARTIFACT_EVENTS.has(event.type) &&
          (event.data as Record<string, unknown>)?.artifact_id === artifactId
      )
    )
    if (normalized) {
      await this.cacheArtifact(artifactId, text)
      this.unusableArtifacts.delete(artifactId)
      // Do not await our own in-flight refresh when a manual read overlaps it.
      if (this.refreshing) this.dirty = true
      else await this.refresh()
    }
    return text
  }

  private async cacheArtifact(id: string, text: string): Promise<Record<string, unknown>> {
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      throw new UnusableArtifactError('Invalid normalized artifact JSON')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new UnusableArtifactError('Invalid normalized artifact')
    const data = payload as Record<string, unknown>
    await this.connection.client.store.transaction((raw) => {
      ;((raw as NodeClientState).artifactData ??= {})[id] = data
    })
    return data
  }

  private async readArtifact(artifactId: string): Promise<string> {
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
        !result ||
        result.offset !== offset ||
        !Number.isSafeInteger(result.total) ||
        result.total < offset ||
        result.total > 1024 * 1024 ||
        typeof result.base64 !== 'string'
      )
        throw new UnusableArtifactError('Invalid node artifact')
      let bytes: Uint8Array
      try {
        bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))
      } catch {
        throw new UnusableArtifactError('Invalid artifact encoding')
      }
      if (
        bytes.length > 128 * 1024 ||
        offset + bytes.length > result.total ||
        (!bytes.length && offset < result.total)
      )
        throw new UnusableArtifactError('Incomplete node artifact')
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
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(all)
    } catch {
      throw new UnusableArtifactError('Invalid artifact encoding')
    }
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
