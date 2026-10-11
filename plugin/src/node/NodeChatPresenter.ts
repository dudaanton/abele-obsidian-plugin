import { computed, ref, watch, type WatchStopHandle } from 'vue'
import { z } from 'zod'
import type { FakeStep, Prompt } from '@abele/node-client'
import type { ChatPresentationSession, ChatReference } from '@/ai/ChatPresentationSession'
import type { ChatDraft } from '@/ai/types'
import { mobileBackground } from '@/ai/mobileBackground'
import { reduceTranscript } from './NodeTranscriptReducer'
import type { NodeConnection } from './NodeService'
import type { NodeClientState } from './NodeClientStore'
import { nodeQueueView } from './presentation'
import { promptAnswerStates, type PromptAnswerState } from './promptAnswers'
import { FrameCodec } from '@abele/channel-protocol'
import { NodeFilesModel, nodeResourceTarget, type CodeLineRange } from './NodeFilesModel'
import { PromptSchema, validateParams } from '@abele/node-protocol'
import type { PathTarget } from './NodePathModel'
import { wirePathTarget } from './nodePathChat'
import { nodeProviders, nodeDebuggerSupported } from './providers'

const NORMALIZED_ARTIFACT_EVENTS = new Set([
  'claude.message.final',
  'claude.tool.call',
  'claude.tool.result',
  'claude.thinking',
  'claude.block.delta',
  'pi.message.start',
  'pi.message.delta',
  'pi.message.final',
  'pi.tool.call',
  'pi.tool.update',
  'pi.tool.result',
])
/** Immutable bytes that cannot be projected; transport/storage failures are retryable. */
class UnusableArtifactError extends Error {}
class OfflineTurnError extends Error {}

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
  readonly providerReports = ref<ReturnType<typeof nodeProviders>>([])
  readonly nodeDescription = ref<unknown>()
  readonly debuggerAvailable = computed(
    () =>
      this.connection.state.value === 'connected' &&
      nodeDebuggerSupported(this.nodeDescription.value)
  )
  private descriptionGeneration = 0
  private descriptionRequested = false
  readonly providerReport = computed(() =>
    this.providerReports.value.find((p) => p.provider === this.provider.value)
  )
  readonly workspaceId = computed(() => this.projection.value.session?.workspace_id)
  readonly nativeSessionId = computed(() => this.projection.value.session?.native_session_id)
  readonly draft = ref<ChatDraft>({ text: '', attachments: [] })
  readonly draftNotice = ref('')
  private draftLoaded = false
  private draftRevision = 0
  private restoringDraft = false
  private draftWrite: Promise<void> = Promise.resolve()
  private stopDraftWatch: WatchStopHandle
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
  private filesOpener?: (model: NodeFilesModel, path?: string, range?: CodeLineRange) => void
  private stopEvent: () => void
  private stopWatch: WatchStopHandle
  private destroyed = false
  private refreshing?: Promise<void>
  private dirty = false
  private readonly unusableArtifacts = new Set<string>()
  private readonly interruptingRuns = new Set<string>()
  private readonly backgroundStoppedRuns = new Set<string>()
  private endBackgroundTurn?: () => void

  constructor(
    readonly reference: Extract<ChatReference, { kind: 'node-session' }>,
    readonly connection: NodeConnection
  ) {
    this.reference = NodeReferenceSchema.parse(reference)
    const expected = connection.client.target.expected_node_id
    if (expected && expected !== reference.nodeId)
      throw new Error('Node tab identity does not match its registration')
    this.stopDraftWatch = watch(
      () => [this.draft.value.text, this.draftNotice.value],
      () => {
        if (this.restoringDraft) return
        ++this.draftRevision
        this.persistDraft()
      },
      { flush: 'sync' }
    )
    this.stopEvent = connection.client.onEvent((event) => {
      if (event.stream_id === reference.sessionId)
        void this.refresh().catch((e: unknown) => this.report(e))
    })
    this.stopWatch = watch(connection.state, (state) => {
      ++this.descriptionGeneration
      this.nodeDescription.value = undefined
      if (state === 'connected' && this.descriptionRequested)
        void this.describe().catch((e: unknown) => this.report(e))
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
      await this.describe()
      await this.refresh()
    } catch (error) {
      this.report(error)
    }
  }

  private async describe(): Promise<void> {
    this.descriptionRequested = true
    const generation = ++this.descriptionGeneration
    const description = await this.connection.client.describe()
    if (
      this.destroyed ||
      generation !== this.descriptionGeneration ||
      this.connection.state.value !== 'connected'
    )
      return
    this.nodeDescription.value = description
    this.providerReports.value = nodeProviders(description)
  }

  refresh(): Promise<void> {
    this.dirty = true
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      while (this.dirty && !this.destroyed) {
        this.dirty = false
        const client = this.connection.client
        const draftRevision = this.draftRevision
        const { history, pending, rejected, artifactData, receipts, draft } =
          await client.store.transaction((raw) => {
            const state = raw as NodeClientState
            return {
              draft: state.chatDrafts?.[this.reference.sessionId],
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
        if (!this.draftLoaded) {
          this.draftLoaded = true
          // A delayed read must not replace text entered while reopening the chat.
          if (draft && this.draftRevision === draftRevision && this.draftRevision === 0) {
            this.restoringDraft = true
            this.draft.value.text = draft.text
            this.draftNotice.value = draft.notice
            this.restoringDraft = false
          }
        }
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
        this.updateBackgroundTurn()
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

  /** An open chat owns its remote run's audio; queue/connection state is not a run. */
  private updateBackgroundTurn(): void {
    const runs = this.projection.value.activeRuns
    for (const run of this.backgroundStoppedRuns)
      if (!runs.includes(run)) this.backgroundStoppedRuns.delete(run)
    const active = !this.destroyed && runs.some((run) => !this.backgroundStoppedRuns.has(run))
    if (active && !this.endBackgroundTurn) {
      console.debug('[Abele node] background audio turn acquired')
      this.endBackgroundTurn = mobileBackground.beginTurn()
    } else if (!active) this.releaseBackgroundTurn()
  }

  private releaseBackgroundTurn(): void {
    if (!this.endBackgroundTurn) return
    console.debug('[Abele node] background audio turn released')
    const end = this.endBackgroundTurn
    this.endBackgroundTurn = undefined
    end()
  }

  private persistDraft(onlyIfVacant = false): void {
    const saved = { text: this.draft.value.text, notice: this.draftNotice.value }
    this.draftWrite = this.draftWrite
      .catch(() => {})
      .then(() =>
        this.connection.client.store.transaction((raw) => {
          const state = raw as NodeClientState
          state.chatDrafts ??= {}
          const current = state.chatDrafts[this.reference.sessionId]
          // A closed presenter must not overwrite another composer's newer draft.
          if (onlyIfVacant && current && current.text !== saved.text) return
          if (saved.text) state.chatDrafts[this.reference.sessionId] = saved
          else delete state.chatDrafts[this.reference.sessionId]
        })
      )
    void this.draftWrite.catch((error: unknown) => this.report(error))
  }

  async send(text: string, script?: FakeStep[], shownTarget?: PathTarget): Promise<void> {
    this.error.value = ''
    const client = this.connection.client
    const submittedDraft = this.draft.value.text.trim() === text ? this.draft.value.text : text
    if (!this.draft.value.text) this.draft.value.text = text
    let operationId: string | undefined
    let retain = true
    try {
      await this.draftWrite
      const online = () =>
        !this.destroyed && this.connection.state.value === 'connected' && client.connected
      if (!online())
        throw new OfflineTurnError(
          'Draft not sent because the node is offline. Send again when connected.'
        )
      const captured = shownTarget && Object.freeze({ ...shownTarget })
      if (captured) {
        if (
          captured.nodeId !== this.reference.nodeId ||
          captured.registrationId !== this.reference.registrationId
        )
          throw new Error('The displayed worktree belongs to another node.')
        const actual = await client.nodePath.sessionWorktreeGet({
          session_id: this.reference.sessionId,
        })
        if (
          actual.project_id !== captured.projectId ||
          JSON.stringify(actual.target) !== JSON.stringify(wirePathTarget(captured))
        )
          throw new Error('The session worktree changed; review the current target before sending.')
      }
      const observed_seq = await client.cursor(this.reference.sessionId)
      const params = validateParams('session.send', {
        session_id: this.reference.sessionId,
        text,
        observed_seq,
        ...(script ? { script } : {}),
      })
      const operation_id = crypto.randomUUID()
      operationId = operation_id
      await client.store.transaction((s) => {
        // The final fence runs under the store lock, not before an asynchronous SDK enqueue.
        if (!online())
          throw new OfflineTurnError(
            'Draft not sent because the node is offline. Send again when connected.'
          )
        s.operationRequests ??= {}
        s.operationRequests[operation_id] = { method: 'session.send', params }
        s.outbox.push({ operation_id, method: 'session.send', params })
        // Clear only this submission, atomically with admission, even if the view closes.
        const state = s as NodeClientState
        if (state.chatDrafts?.[this.reference.sessionId]?.text === submittedDraft)
          delete state.chatDrafts[this.reference.sessionId]
      })
      retain = false
      await client.flush()
      const receipt = await client.operationResult(operation_id)
      if (receipt?.error) {
        this.error.value = `Not accepted: ${receipt.error}`
        retain = true
      }
    } catch (error) {
      if (error instanceof OfflineTurnError) this.draftNotice.value = error.message
      else this.report(error)
      const persisted = operationId
        ? await client.store
            .transaction(
              (s) =>
                s.outbox.some((entry) => entry.operation_id === operationId) ||
                Object.hasOwn(s.results, operationId)
            )
            .catch(() => true)
        : false
      // A failed local commit keeps the draft; an unknown remote outcome stays in the outbox.
      retain = !persisted
    } finally {
      if (!retain && this.draft.value.text === submittedDraft) {
        this.draft.value.text = ''
        this.draftNotice.value = ''
      }
      if (retain) this.persistDraft(this.destroyed)
      await this.draftWrite.catch((error: unknown) => this.report(error))
      await this.refresh().catch((error: unknown) => this.report(error))
    }
  }

  async answer(prompt: Prompt, choice: 'allow' | 'deny', value?: string): Promise<void> {
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
        ...(value !== undefined && choice === 'allow' ? { value } : {}),
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

  async stopFromApproval(prompt: Prompt): Promise<void> {
    try {
      prompt = PromptSchema.parse(prompt)
      if (prompt.session_id !== this.reference.sessionId)
        throw new Error('Prompt belongs to another session')
      if (!this.connection.client.connected) throw new Error('Reconnect before stopping a run')
      const current = this.projection.value.prompts.find((p) => p.prompt_id === prompt.prompt_id)
      if (!current || current.state !== 'pending' || current.run_id !== prompt.run_id) return
      // session.interrupt atomically denies all pending prompts and interrupts the worker.
      // Sending a deny answer first would release it to take another turn before Stop.
      await this.interrupt(prompt.run_id)
    } catch (error) {
      this.report(error)
    }
  }

  async interrupt(runId: string): Promise<void> {
    if (this.interruptingRuns.has(runId)) return
    this.interruptingRuns.add(runId)
    // Stop ends this chat's local keep-alive even if the remote acknowledgement is lost.
    this.backgroundStoppedRuns.add(runId)
    this.updateBackgroundTurn()
    this.error.value = ''
    try {
      try {
        await this.connection.client.interrupt(this.reference.sessionId, runId)
      } catch (error) {
        this.report(error)
      }
      await this.refresh()
    } finally {
      this.interruptingRuns.delete(runId)
    }
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
    const target = nodeResourceTarget(path)
    this.openFiles(target.path, target.range)
  }
  setFilesOpener(
    opener: (model: NodeFilesModel, path?: string, range?: CodeLineRange) => void
  ): () => void {
    this.filesOpener = opener
    return () => {
      if (this.filesOpener === opener) this.filesOpener = undefined
    }
  }
  openFiles(path?: string, range?: CodeLineRange): void {
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
    if (this.filesOpener) this.filesOpener(this.filesModel, path, range)
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
    this.releaseBackgroundTurn()
    this.backgroundStoppedRuns.clear()
    ++this.descriptionGeneration
    this.nodeDescription.value = undefined
    this.stopEvent()
    this.stopWatch()
    this.stopDraftWatch()
  }
}
