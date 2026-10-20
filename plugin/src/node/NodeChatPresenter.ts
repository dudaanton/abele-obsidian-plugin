import { UiError, uiMessage, uiErrorMessage, presentUiError, uiField } from '@/i18n/streamBErrors'

import { t } from '@/i18n'
import { computed, ref, shallowRef, watch, type WatchStopHandle } from 'vue'
import { z } from 'zod'
import type { FakeStep, Prompt } from '@abele/node-client'
import {
  type SessionCommand,
  PromptSchema,
  NodeEventSchema,
  SessionSchema,
  TargetChangedRefusalSchema,
  validateParams,
} from '@abele/node-protocol'
import type { ChatPresentationSession, ChatReference } from '@/ai/ChatPresentationSession'
import type { ChatDraft, ChatReplyTo } from '@/ai/types'
import { agentReplyText } from '@/ai/replyLinks'
import { mobileBackground } from '@/ai/mobileBackground'
import { generateChatTitle } from '@/ai/chatTitle'
import { reduceTranscript } from './NodeTranscriptReducer'
import type { NodeConnection } from './NodeService'
import { type NodeClientState, readStore } from './NodeClientStore'
import { nodeQueueView } from './presentation'
import { promptAnswerStates, type PromptAnswerState } from './promptAnswers'
import { FrameCodec, type JournalEvent } from '@abele/channel-protocol'
import { NodeFilesModel, nodeResourceTarget, type CodeLineRange } from './NodeFilesModel'

import type { PathTarget } from './NodePathModel'
import { wirePathTarget } from './nodePathChat'
import { nodeProviders, nodeDebuggerSupported } from './providers'
import { NodeSessionControl } from './NodeSessionControl'
import { catchUp, openWindow, readOlder, windowAt } from './sessionWindow'
import { StableMessages } from './stableMessages'
import { nodeAdvertisesMethod } from './advertisedMethods'
import { NodeChatHistory, type NodeHistoryAction, type NodeChatPreview } from './NodeChatHistory'
import { restoredTranscript } from './restoredTranscript'

import {
  chatMovedNotice,
  supportsExpectedTarget,
  readChatBinding,
  expectedBinding,
  type ChatBinding,
} from './expectedTarget'

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
class UnusableArtifactError extends UiError {}
class OfflineTurnError extends UiError {}
/** The longest an event waits to be shown while others keep arriving. */
const REFRESH_MS = 50
/** Events after which a long-lived session's settings, process or context may have changed. */
const LIVE_STATE_EVENTS = new Set([
  'session.process',
  'session.updated',
  'turn.started',
  'turn.completed',
  'compaction.completed',
])

const commandsChanged = (data: unknown): boolean =>
  (data as { update?: { kind?: unknown } } | null)?.update?.kind === 'available_commands_update'

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
  get capabilities() {
    return {
      branches: this.historySupported.value,
      rewind: this.historySupported.value,
      editHistory: this.historySupported.value,
      attachments: false,
      vaultResources: false,
    }
  }
  readonly historySupported = computed(() => {
    void this.nodeDescription.value
    void this.connection.state.value
    return (
      this.provider.value === 'pi' &&
      ['chat.checkpoints', 'chat.preview', 'chat.restore'].every((method) =>
        nodeAdvertisesMethod(this.connection.client, method)
      )
    )
  })
  readonly history: NodeChatHistory
  readonly historyBusy = ref(false)
  private historyDirty = true
  private readonly inheritedPrefixes = new Map<string, Promise<JournalEvent[]>>()
  private readonly restoredPrefixComplete = ref(false)
  get hasRestoredHistory(): boolean {
    return this.restoredPrefixComplete.value
  }
  readonly projection = ref(reduceTranscript([]))
  readonly messages = computed(() => this.projection.value.messages)
  readonly isStreaming = computed(() => this.projection.value.state === 'running')
  /** The title the node has now: a rename on any device shows here. */
  readonly label = computed(() => this.projection.value.session?.title || this.reference.title)
  readonly provider = computed(() => this.projection.value.session?.provider ?? '')
  /** The session as the node describes it: its record, when its first events are not held here. */
  private readonly sessionRecord =
    shallowRef<NonNullable<ReturnType<typeof reduceTranscript>['session']>>()
  /** Earlier events read from the node page by page as the person scrolls back; never stored. */
  private readonly older = shallowRef<JournalEvent[]>([])
  /** Events already drawn stay visible while the durable device window advances. */
  private readonly visibleEvents = new Map<number, JournalEvent>()
  private visibleHead = 0
  private subscribedOnce = false
  /** The first event this device keeps for the session; earlier ones are on the node. */
  private readonly firstKept = ref(1)
  readonly olderState = ref<'idle' | 'loading' | 'failed'>('idle')
  /** Why the last earlier page could not be read; said on its line, not as the chat's error. */
  readonly olderError = ref('')
  /** There is more of the session before what is shown. */
  readonly hasOlder = computed(
    () =>
      !this.restoredPrefixComplete.value && (this.older.value[0]?.seq ?? this.firstKept.value) > 1
  )
  readonly providerReports = ref<ReturnType<typeof nodeProviders>>([])
  readonly nodeDescription = ref<unknown>()
  readonly binding = ref<ChatBinding | null>()
  readonly debuggerAvailable = computed(
    () =>
      this.connection.state.value === 'connected' &&
      nodeDebuggerSupported(this.nodeDescription.value)
  )
  private descriptionGeneration = 0
  private describing?: { generation: number; promise: Promise<void> }
  private bindingGeneration = 0
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
  /** Unchanged messages keep their objects across projections, so only what changed redraws. */
  private readonly stable = new StableMessages()
  readonly presentation = computed(() => {
    const view = nodeQueueView(
      this.messages.value,
      this.queued.value,
      this.projection.value.queuedInputs,
      this.receipts.value
    )
    return { ...view, messages: this.stable.keep(view.messages) }
  })
  readonly state = computed(() =>
    this.connection.state.value !== 'connected'
      ? 'offline'
      : this.queued.value.length
        ? 'queued'
        : this.projection.value.state
  )
  /** A long-lived session's settings and levers; `live` is null for any other. */
  readonly control: NodeSessionControl
  readonly live = computed(() =>
    this.control.view(
      this.providerReport.value,
      this.projection.value.live,
      this.projection.value.agent,
      this.provider.value
    )
  )
  private filesModel?: NodeFilesModel
  private filesBindingKey?: string
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
  private readonly titleAbort = new AbortController()
  private titleAttempted = false

  constructor(
    readonly reference: Extract<ChatReference, { kind: 'node-session' }>,
    readonly connection: NodeConnection
  ) {
    this.reference = NodeReferenceSchema.parse(reference)
    this.control = new NodeSessionControl(() => connection.client, reference.sessionId, {
      report: (error) => this.report(error),
      open: (sessionId) => this.openSession?.(sessionId),
    })
    this.history = new NodeChatHistory(
      () => connection.client,
      reference.sessionId,
      () => this.historyUnavailable()
    )
    const expected = connection.client.target.expected_node_id
    if (expected && expected !== reference.nodeId)
      throw new UiError(uiMessage('streamB.nodeTabIdentityDoesNotMatchIts.8a5f7e'))
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
      if (event.stream_id === reference.sessionId) {
        if (['chat.checkpoint', 'chat.restored', 'session.updated'].includes(event.type))
          this.historyDirty = true
        this.refreshSoon()
        if (LIVE_STATE_EVENTS.has(event.type)) void this.readLive()
        if (event.type === 'session.update' && commandsChanged(event.data)) void this.readCommands()
        if (['session.worktree.changed', 'session.updated'].includes(event.type))
          void this.refreshBinding().catch((e: unknown) => this.report(e))
      }
    })
    this.stopWatch = watch(
      connection.state,
      (state) => {
        ++this.descriptionGeneration
        this.nodeDescription.value = undefined
        if (state === 'connected' && this.descriptionRequested)
          void this.describe().catch((e: unknown) => this.report(e))
        if (state === 'connected')
          void this.subscribe()
            .then(() => this.refresh())
            .then(() => Promise.all([this.readLive(), this.readCommands()]))
            .catch((e: unknown) => this.report(e))
        else void this.refresh().catch((e: unknown) => this.report(e))
      },
      { flush: 'sync' }
    )
  }
  get id(): string {
    return `node:${this.reference.registrationId}:${this.reference.sessionId}`
  }

  async load(): Promise<void> {
    this.descriptionRequested = true
    await this.refresh()
    if (this.destroyed) return
    try {
      await this.connection.connect()
      if (this.destroyed) return
      await this.subscribe()
      await this.describe()
      await this.refresh()
      await this.readLive()
    } catch (error) {
      this.report(error)
    }
  }

  private describe(): Promise<void> {
    this.descriptionRequested = true
    if (this.describing?.generation === this.descriptionGeneration) return this.describing.promise
    const generation = ++this.descriptionGeneration
    const promise = (async () => {
      const description = await this.connection.client.describe()
      if (
        this.destroyed ||
        generation !== this.descriptionGeneration ||
        this.connection.state.value !== 'connected'
      )
        return
      this.nodeDescription.value = description
      this.providerReports.value = nodeProviders(description)
      await this.refreshBinding()
      this.historyDirty = true
    })().finally(() => {
      if (this.describing?.generation === generation) this.describing = undefined
    })
    this.describing = { generation, promise }
    return promise
  }

  async refreshBinding(): Promise<void> {
    if (!supportsExpectedTarget(this.nodeDescription.value)) return
    const generation = this.descriptionGeneration
    const read = ++this.bindingGeneration
    const binding = await readChatBinding(this.connection.client, this.reference.sessionId)
    if (
      !this.destroyed &&
      generation === this.descriptionGeneration &&
      read === this.bindingGeneration
    )
      this.binding.value = binding
  }

  refresh(): Promise<void> {
    this.dirty = true
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      while (this.dirty && !this.destroyed) {
        this.dirty = false
        const client = this.connection.client
        const draftRevision = this.draftRevision
        const { history, pending, rejected, artifactData, receipts, draft, firstKept } =
          await readStore(client.store, (raw) => {
            const state = raw as NodeClientState
            return {
              draft: state.chatDrafts?.[this.reference.sessionId],
              receipts: state.results,
              artifactData: state.artifactData ?? {},
              history: [...this.older.value, ...(state.events[this.reference.sessionId] ?? [])],
              firstKept:
                state.events[this.reference.sessionId]?.[0]?.seq ??
                (state.cursors[this.reference.sessionId] ?? 0) + 1,
              pending: state.outbox,
              rejected: Object.entries(state.results)
                .filter(([, r]) => r.error && r.input?.sessionId === this.reference.sessionId)
                .map(([id, r]) => ({ id, text: r.input.text, error: r.error })),
            }
          })
        if (this.destroyed) return
        if (!this.draftLoaded || (this.draftRevision === 0 && !this.draft.value.text && draft)) {
          this.draftLoaded = true
          // A delayed read must not replace text entered while reopening the chat.
          if (draft && this.draftRevision === draftRevision && this.draftRevision === 0) {
            this.restoringDraft = true
            this.draft.value.text = draft.text
            uiField(this.draftNotice, 'value', uiErrorMessage(draft.notice))
            this.restoringDraft = false
          }
        }
        this.answers.value = promptAnswerStates(
          { outbox: pending, results: receipts },
          this.reference.sessionId
        )
        const latest = this.visibleHead
        const first = firstKept
        // A burst can overtake a device window between draws. Read the missing interval
        // before joining it, so a partial tool call cannot swallow an intervening turn.
        if (latest && first > latest + 1) {
          if (!client.connected)
            throw new UiError(uiMessage('streamB.couldNotReadEarlierMessages.5f0162'))
          let after = latest
          while (after < first - 1) {
            const limit = Math.min(256, first - after - 1)
            const raw = await client.request('stream.read', {
              stream_id: this.reference.sessionId,
              after_seq: after,
              limit,
            })
            const page = Array.isArray(raw) ? raw.map((e) => NodeEventSchema.parse(e)) : []
            if (
              !page.length ||
              page.length > limit ||
              page.some(
                (e, i) =>
                  e.seq !== after + i + 1 ||
                  e.stream_id !== this.reference.sessionId ||
                  e.node_id !== this.reference.nodeId
              )
            )
              throw new UiError(uiMessage('streamB.couldNotReadEarlierMessages.5f0162'))
            for (const event of page) this.visibleEvents.set(event.seq, event)
            after = page.at(-1)!.seq
          }
        }
        for (const event of history) {
          this.visibleEvents.set(event.seq, event)
          this.visibleHead = Math.max(this.visibleHead, event.seq)
        }
        const visible = [...this.visibleEvents.values()].sort((a, b) => a.seq - b.seq)
        const active = await restoredTranscript(visible, (source, before) =>
          this.readPrefix(source, before)
        )
        this.restoredPrefixComplete.value = visible.some((event) => event.type === 'chat.restored')
        const hydrated = []
        for (const event of active) {
          const data = event.data as Record<string, unknown>
          const id = data?.artifact_id
          // A record the node mapped is shown through its updates: nothing to read back.
          if (
            typeof id === 'string' &&
            data.mapped !== true &&
            NORMALIZED_ARTIFACT_EVENTS.has(event.type)
          ) {
            if (!artifactData[id] && client.connected && !this.unusableArtifacts.has(id)) {
              try {
                artifactData[id] = await this.cacheArtifact(
                  id,
                  await this.readArtifact(id, event.stream_id)
                )
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
        this.firstKept.value = visible[0]?.seq ?? firstKept
        const projection = reduceTranscript(hydrated)
        const record = visible.findLast((event) =>
          ['session.created', 'session.updated'].includes(event.type)
        )
        const current = SessionSchema.safeParse(record?.data)
        projection.session = current.success
          ? current.data
          : (this.sessionRecord.value ?? projection.session)
        projection.children = this.stable.children(projection.children)
        this.projection.value = projection
        if (projection.session && this.reference.title !== projection.session.title) {
          this.reference.title = projection.session.title
          this.onTitle?.()
        }
        this.nameConversation()
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
                ? t('streamB.reviewBatch.c6d574')
                : (entry.params as { text: string }).text,
          }))
        if (this.historySupported.value && this.historyDirty && client.connected) {
          this.historyDirty = false
          try {
            await this.history.read()
          } catch (error) {
            this.historyDirty = true
            this.report(error)
          }
        }
      }
    })().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  private historyUnavailable(): string {
    if (!this.historySupported.value) return t('streamB.nodeHistoryUnsupported')
    if (this.connection.state.value !== 'connected') return t('streamB.nodeHistoryOffline')
    if (this.binding.value === null) return t('streamB.nodeHistoryLegacyTarget')
    if (!this.binding.value?.incarnation) return t('streamB.nodeHistoryLoadingTarget')
    if (
      this.projection.value.activeRuns.length ||
      this.projection.value.queuedInputs.length ||
      this.queued.value.length
    )
      return t('streamB.nodeHistoryStopFirst')
    return ''
  }

  historyState(messageId: string) {
    if (!this.historySupported.value) return undefined
    const receipt = messageId.startsWith('operation:')
      ? (this.receipts.value[messageId.slice(10)]?.result as { input_id?: string } | undefined)
      : undefined
    const id = receipt?.input_id ? `input:${receipt.input_id}` : messageId
    const messages = this.messages.value
    let index = messages.findIndex((message) => message.id === id)
    while (index >= 0 && messages[index].role !== 'user') index--
    const input = index >= 0 ? messages[index] : undefined
    const point = this.history.checkpoints.value.find(
      (checkpoint) => `input:${checkpoint.input_id}` === input?.id
    )
    return {
      input,
      point,
      reason:
        this.historyUnavailable() ||
        (this.historyBusy.value
          ? t('streamB.nodeHistoryBusy')
          : !point
            ? t('streamB.nodeHistoryNoCheckpoint')
            : ''),
    }
  }

  async historyPreview(messageId: string): Promise<NodeChatPreview> {
    const state = this.historyState(messageId)
    if (!state?.point || state.reason)
      throw new Error(state?.reason || t('streamB.nodeHistoryUnsupported'))
    return this.history.preview(state.point)
  }

  async restoreHistory(
    messageId: string,
    action: NodeHistoryAction,
    text?: string,
    files?: NodeChatPreview
  ): Promise<void> {
    const state = this.historyState(messageId)
    if (!state?.point || state.reason)
      throw new Error(state?.reason || t('streamB.nodeHistoryUnsupported'))
    this.historyBusy.value = true
    try {
      const result = await this.history.restore(state.point, action, text, files)
      if (action === 'branch') this.openSession?.(result.session_id)
      else {
        this.historyDirty = true
        await this.subscribe()
        await this.refresh()
        await this.readLive()
        if (action === 'rewind' && !this.draft.value.text)
          this.draft.value.text = state.input?.content ?? ''
      }
    } finally {
      this.historyBusy.value = false
    }
  }

  private readPrefix(session: string, before: number): Promise<JournalEvent[]> {
    const key = `${session}:${before}`
    const cached = this.inheritedPrefixes.get(key)
    if (cached) return cached
    const pending = (async () => {
      const events: JournalEvent[] = []
      while (events.length < before) {
        const raw = await this.connection.client.request('stream.read', {
          stream_id: session,
          after_seq: events.length,
          limit: Math.min(256, before - events.length),
        })
        const page = Array.isArray(raw) ? raw.map((event) => NodeEventSchema.parse(event)) : []
        const after = events.length
        if (
          !page.length ||
          page.length > before - after ||
          page.some(
            (event, index) =>
              event.seq !== after + index + 1 ||
              event.stream_id !== session ||
              event.node_id !== this.reference.nodeId
          )
        )
          throw new Error(t('streamB.nodeHistoryCannotRead'))
        events.push(...page)
      }
      return events
    })().catch((error: unknown) => {
      this.inheritedPrefixes.delete(key)
      throw error
    })
    this.inheritedPrefixes.set(key, pending)
    return pending
  }

  /** Persist on the node so its catalog and every device see the same title. */
  private nameConversation(): void {
    if (
      this.titleAttempted ||
      this.destroyed ||
      this.connection.state.value !== 'connected' ||
      this.projection.value.state !== 'idle' ||
      !this.messages.value.some((message) => message.role === 'user' && message.content.trim()) ||
      !['', 'New chat', 'Fake session'].includes(this.label.value)
    )
      return
    this.titleAttempted = true
    const original = this.label.value
    void (async () => {
      try {
        const { ChatService } = await import('@/ai/ChatService')
        if (this.destroyed) return
        const title = await generateChatTitle(
          this.messages.value,
          ChatService.getInstance().getAuxiliaryModelConfig(),
          this.titleAbort.signal
        )
        if (!title || this.destroyed || this.label.value !== original) return
        // A rename made elsewhere during generation wins over this convenience title.
        const session = await this.connection.client.getSession(this.reference.sessionId)
        if (
          this.destroyed ||
          this.connection.state.value !== 'connected' ||
          this.label.value !== original ||
          session.title !== original
        )
          return
        await this.connection.client.renameSession(this.reference.sessionId, title)
        if (!this.destroyed) await this.refresh()
      } catch (error) {
        console.debug('[Abele node] Chat title unavailable', error)
      }
    })()
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

  /**
   * `reply` is for words that reply to places of the agent's: the node is sent links to them over
   * the words, never the agent's words again, and the draft that held them is what is cleared.
   */
  async send(
    text: string,
    script?: FakeStep[],
    shownTarget?: PathTarget,
    reply?: { replyTo: ChatReplyTo[]; draft: string }
  ): Promise<void> {
    this.error.value = ''
    const client = this.connection.client
    const submittedDraft =
      reply && this.draft.value.text === reply.draft
        ? reply.draft
        : this.draft.value.text.trim() === text
          ? this.draft.value.text
          : text
    const wire = reply?.replyTo.length ? agentReplyText(text, reply.replyTo) : text
    if (!this.draft.value.text) this.draft.value.text = text
    // Capture before the first await: cursor/storage work must not adopt a newer target.
    let guarded = supportsExpectedTarget(this.nodeDescription.value)
    const captured = shownTarget && Object.freeze({ ...shownTarget })
    const binding = this.binding.value
    const expected = captured?.incarnation
      ? { target: wirePathTarget(captured), incarnation: captured.incarnation }
      : expectedBinding(binding)
    let operationId: string | undefined
    let retain = true
    try {
      await this.draftWrite
      const online = () =>
        !this.destroyed && this.connection.state.value === 'connected' && client.connected
      if (!online())
        throw new OfflineTurnError(uiMessage('streamB.draftNotSentBecauseTheNodeIs.f195f2'))
      if (this.descriptionRequested && this.nodeDescription.value === undefined) {
        await this.describe()
        if (this.nodeDescription.value === undefined)
          throw new UiError(uiMessage('streamB.theNodeDescriptionIsNotReadyNothing.388d3c'))
      }
      guarded = supportsExpectedTarget(this.nodeDescription.value)
      if (guarded && !expected && binding !== null)
        throw new UiError(uiMessage('streamB.theChatTargetIsNotReadyNothing.125636'))
      if (captured) {
        if (
          captured.nodeId !== this.reference.nodeId ||
          captured.registrationId !== this.reference.registrationId
        )
          throw new UiError(uiMessage('streamB.theDisplayedWorktreeBelongsToAnotherNode.5d9afd'))
        if (guarded) {
          if (JSON.stringify(expected?.target) !== JSON.stringify(wirePathTarget(captured)))
            throw new UiError(uiMessage('streamBError.f87df21e8e'))
        } else {
          const actual = await client.nodePath.sessionWorktreeGet({
            session_id: this.reference.sessionId,
          })
          if (
            actual.project_id !== captured.projectId ||
            JSON.stringify(actual.target) !== JSON.stringify(wirePathTarget(captured))
          )
            throw new UiError(uiMessage('streamB.theSessionWorktreeChangedReviewTheCurrent.9cd2c5'))
        }
      }
      const observed_seq = await client.cursor(this.reference.sessionId)
      const params = validateParams('session.send', {
        session_id: this.reference.sessionId,
        text: wire,
        observed_seq,
        ...(script ? { script } : {}),
        ...(guarded && expected ? { expected_target: expected } : {}),
      })
      const operation_id = crypto.randomUUID()
      operationId = operation_id
      await client.store.transaction((s) => {
        // The final fence runs under the store lock, not before an asynchronous SDK enqueue.
        if (!online())
          throw new OfflineTurnError(uiMessage('streamB.draftNotSentBecauseTheNodeIs.f195f2'))
        s.operationRequests ??= {}
        s.operationRequests[operation_id] = { method: 'session.send', params }
        s.outbox.push({ operation_id, method: 'session.send', params })
        // Clear only this submission, atomically with admission, even if the view closes.
        const state = s as NodeClientState
        if (guarded && expected) {
          state.turnDrafts ??= {}
          state.turnDrafts[operation_id] = {
            sessionId: this.reference.sessionId,
            text: submittedDraft,
          }
        }
        if (state.chatDrafts?.[this.reference.sessionId]?.text === submittedDraft)
          delete state.chatDrafts[this.reference.sessionId]
      })
      retain = false
      await client.flush()
      const receipt = await client.operationResult(operation_id)
      if (TargetChangedRefusalSchema.safeParse(receipt?.result).success) {
        retain = true
        uiField(this.draftNotice, 'value', uiMessage('streamBError.f87df21e8e'))
        await this.refreshBinding().catch((error: unknown) => this.report(error))
      } else if (receipt?.error) {
        this.error.value = t('streamB.notAccepted.8790d7', { v0: String(receipt.error) })
        retain = true
      }
    } catch (error) {
      if (error instanceof OfflineTurnError)
        uiField(this.draftNotice, 'value', uiErrorMessage(error))
      else if (error instanceof Error && error.message === chatMovedNotice) {
        uiField(this.draftNotice, 'value', uiMessage('streamBError.f87df21e8e'))
        await this.refreshBinding().catch((failure: unknown) => this.report(failure))
      } else this.report(error)
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
        uiField(this.draftNotice, 'value', uiErrorMessage(''))
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
        throw new UiError(uiMessage('streamB.promptBelongsToAnotherSession.004dde'))
      if (prompt.state !== 'pending') return
      if (!client.connected)
        throw new UiError(uiMessage('streamB.reconnectBeforeAnsweringAPrompt.5439ec'))
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
          throw new UiError(uiMessage('streamB.nodeIdentityDoesNotMatchThisPrompt.97ed86'))
        state.outbox.push({ operation_id: operationId, method: 'prompt.answer', params })
        return { queued: true, answers: promptAnswerStates(state, session_id) }
      })
      this.answers.value = admission.answers
      if (admission.queued) {
        await client.flush()
        const receipt = await client.operationResult(operationId)
        if (!receipt)
          throw new UiError(uiMessage('streamB.answerSentWaitingForConfirmation.86b29d'))
        if (receipt.error)
          throw new UiError(
            uiMessage('streamB.answerNotAccepted.2eafc0', { v0: String(receipt.error) })
          )
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
        throw new UiError(uiMessage('streamB.promptBelongsToAnotherSession.004dde'))
      if (!this.connection.client.connected)
        throw new UiError(uiMessage('streamB.reconnectBeforeStoppingARun.5e2dbd'))
      const current = this.projection.value.prompts.find((p) => p.prompt_id === prompt.prompt_id)
      if (!current || current.state !== 'pending' || current.run_id !== prompt.run_id) return
      // session.interrupt atomically denies all pending prompts and interrupts the worker.
      // Sending a deny answer first would release it to take another turn before Stop.
      await this.interrupt(prompt.run_id)
    } catch (error) {
      this.report(error)
    }
  }

  /**
   * Subscribes at the session's end: a long journal is not replayed to this device (see
   * `sessionWindow.ts`); its record is read on its own, as its first events may not be here.
   */
  private async subscribe(): Promise<void> {
    const client = this.connection.client
    const id = this.reference.sessionId
    const opening = !this.subscribedOnce
    const adoptWindow = (window: Awaited<ReturnType<typeof openWindow>>) => {
      // A new view may first show a stale device cache. The initial jump still opens at
      // the tail; it must not turn that old cache into a request for the entire journal.
      // Later reconnects preserve what the person has already been reading in this view.
      if (!opening || !window?.jumped) return
      this.visibleEvents.clear()
      this.visibleHead = 0
      this.older.value = []
    }
    let window = await openWindow(client, id)
    adoptWindow(window)
    // The window comes in pages, kept at once; the subscription then starts near the head.
    if (window) await catchUp(client, id, window.head).catch((e: unknown) => this.report(e))
    const answer = (await client.subscribe(id)) as { head_seq?: unknown } | undefined
    // A node without stream.head says where the journal ends in the subscription's answer: a
    // device far behind starts again at the window, before much of the journal has come.
    if (!window && Number.isSafeInteger(answer?.head_seq)) {
      window = await windowAt(client, id, answer!.head_seq as number)
      adoptWindow(window)
      if (window.jumped) {
        await catchUp(client, id, window.head).catch((e: unknown) => this.report(e))
        await client.subscribe(id)
      }
    }
    this.subscribedOnce = true
    if (window && window.from > 1 && !this.sessionRecord.value)
      try {
        this.sessionRecord.value = await client.getSession(id)
      } catch (error) {
        console.debug('[Abele node] session record unavailable', error)
      }
  }

  /** The page before what is shown, from the node; kept while the chat is open. */
  async loadOlder(): Promise<void> {
    if (this.olderState.value === 'loading' || !this.hasOlder.value || this.destroyed) return
    this.olderState.value = 'loading'
    this.olderError.value = ''
    try {
      const before = this.older.value[0]?.seq ?? this.firstKept.value
      const page = await readOlder(this.connection.client, this.reference.sessionId, before)
      if (this.destroyed) return
      this.older.value = [...page, ...this.older.value]
      this.olderState.value = 'idle'
      await this.refresh()
    } catch (error) {
      this.olderState.value = 'failed'
      this.olderError.value =
        error instanceof Error ? presentUiError(error) : t('streamB.theNodeDidNotAnswer.e6f94c')
      console.debug('[Abele node] earlier page unavailable', error)
    }
  }

  private refreshTimer?: number
  /**
   * After an event: a streamed answer brings dozens of events a second, and reading the store and
   * projecting the session for each held the store away from the events still arriving. One
   * refresh covers what came within `REFRESH_MS`.
   */
  private refreshSoon(): void {
    if (this.refreshTimer !== undefined || this.destroyed) return
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined
      void this.refresh().catch((e: unknown) => this.report(e))
    }, REFRESH_MS)
  }

  /** Every agent but the fake one may keep a long-lived process on the node. */
  private readLive(): Promise<void> {
    return this.provider.value !== 'fake' && !this.destroyed
      ? this.control.read()
      : Promise.resolve()
  }

  /** The agent's «/» list as the node keeps it: the window held here may not reach its report. */
  private readonly storedCommands = shallowRef<{ list: SessionCommand[]; seq: number } | null>(null)
  private readCommands(): Promise<void> {
    if (this.provider.value === 'fake' || this.destroyed) return Promise.resolve()
    return this.connection.client
      .sessionCommands(this.reference.sessionId)
      .then((answer) => {
        this.storedCommands.value = { list: answer.commands, seq: answer.seq }
      })
      .catch((error: unknown) => {
        // An older node does not keep the list: what the journal held here is all there is.
        console.debug('[Abele node] session.commands unavailable', error)
      })
  }
  /** The commands the agent itself takes after «/», newest report first. */
  readonly agentCommands = computed<SessionCommand[]>(() => {
    const journal = this.projection.value.agent?.commands
    const stored = this.storedCommands.value
    return (journal && (!stored || journal.seq >= stored.seq) ? journal : stored)?.list ?? []
  })

  /** Opens another session of this node in its own chat tab; set by whoever owns the tabs. */
  openSession?: (sessionId: string) => void
  onTitle?: () => void

  /** Stops whatever runs now, turns and compacting alike, and keeps the session. */
  async interruptAll(): Promise<void> {
    await Promise.all(this.projection.value.activeRuns.map((run) => this.interrupt(run)))
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
      this.error.value = t('streamB.thisSessionHasNoWorkspace.39ee2a')
      return
    }
    const bindingKey = JSON.stringify(expectedBinding(this.binding.value))
    if (
      !this.filesModel ||
      this.filesModel.workspaceId !== workspace ||
      (this.filesBindingKey !== bindingKey &&
        !this.filesModel.comments.value.length &&
        !this.filesModel.pendingReview.value)
    ) {
      this.filesBindingKey = bindingKey
      this.filesModel = new NodeFilesModel(
        this.connection.client,
        this.reference.nodeId,
        workspace,
        this.reference.sessionId,
        undefined,
        {
          supported: supportsExpectedTarget(this.nodeDescription.value),
          expected:
            expectedBinding(this.binding.value) ?? (this.binding.value === null ? null : undefined),
          onMoved: async () => {
            uiField(this.draftNotice, 'value', uiMessage('streamBError.f87df21e8e'))
            await this.refreshBinding()
          },
        }
      )
    }
    if (this.filesOpener) this.filesOpener(this.filesModel, path, range)
    else this.error.value = t('streamB.openThisSessionInTheChatTo.43bbc8')
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
      throw new UnusableArtifactError(uiMessage('streamB.invalidNormalizedArtifactJson.e7d91a'))
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new UnusableArtifactError(uiMessage('streamB.invalidNormalizedArtifact.035180'))
    const data = payload as Record<string, unknown>
    await this.connection.client.store.transaction((raw) => {
      ;((raw as NodeClientState).artifactData ??= {})[id] = data
    })
    return data
  }

  private async readArtifact(
    artifactId: string,
    sessionId = this.reference.sessionId
  ): Promise<string> {
    const parts: Uint8Array[] = []
    let offset = 0
    while (true) {
      const result = (await this.connection.client.request('artifact.read', {
        session_id: sessionId,
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
        throw new UnusableArtifactError(uiMessage('streamB.invalidNodeArtifact.2e5eda'))
      let bytes: Uint8Array
      try {
        bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))
      } catch {
        throw new UnusableArtifactError(uiMessage('streamB.invalidArtifactEncoding.f399e3'))
      }
      if (
        bytes.length > 128 * 1024 ||
        offset + bytes.length > result.total ||
        (!bytes.length && offset < result.total)
      )
        throw new UnusableArtifactError(uiMessage('streamB.incompleteNodeArtifact.895d5f'))
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
      throw new UnusableArtifactError(uiMessage('streamB.invalidArtifactEncoding.f399e3'))
    }
  }

  private report(error: unknown): void {
    if (!this.destroyed)
      this.error.value =
        error instanceof Error ? presentUiError(error) : t('streamB.nodeRequestFailed.3ded00')
  }
  destroy(): void {
    this.destroyed = true
    this.titleAbort.abort()
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer)
    this.releaseBackgroundTurn()
    this.backgroundStoppedRuns.clear()
    ++this.descriptionGeneration
    this.nodeDescription.value = undefined
    this.stopEvent()
    this.stopWatch()
    this.stopDraftWatch()
    this.visibleEvents.clear()
    this.inheritedPrefixes.clear()
  }
}
