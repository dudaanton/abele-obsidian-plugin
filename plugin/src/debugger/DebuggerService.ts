import { computed, shallowRef, watch, type WatchStopHandle } from 'vue'
import type { NodeConnection } from '@/node/NodeService'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { DebuggerSnapshotSchema } from '@abele/node-protocol'
import { z } from 'zod'
import { DebuggerController } from './DebuggerController'
import { nodeDebuggerSupported } from '@/node/providers'
import { TraceSession } from './trace/TraceSession'
import { nodeTraceSupported, TraceRpc } from './trace/wire'

/** One session's UI lifetime. The owner client never supplies agent tool authority. */
export class DebuggerBinding {
  readonly revision = shallowRef(0)
  readonly controller: DebuggerController
  /** The session's recording, where the node records runs. */
  trace?: TraceSession
  private abort?: AbortController
  private waitId?: string
  private stopConnection: WatchStopHandle
  private disposed = false
  private refreshing?: Promise<void>
  private loadedEpoch?: number
  private grantGeneration = 0
  constructor(
    readonly connection: NodeConnection,
    readonly conversationId: string,
    readonly registrationId: string
  ) {
    this.controller = new DebuggerController(
      {
        rpc: (method, params) => connection.client.request(method, params),
        command: (method, params) =>
          connection.client.debugger.command(
            method as Parameters<typeof connection.client.debugger.command>[0],
            params as never
          ),
      },
      () => {
        ++this.revision.value
      }
    )
    this.stopConnection = watch(connection.state, (state) => {
      if (state !== 'connected') {
        this.stopWatch()
        this.controller.invalidate()
      }
      // Reconnection never restarts a watch or sends controls. Retry fetches a fresh snapshot.
    })
  }
  get sessionId() {
    return this.controller.snapshot?.debug_session_id
  }
  async open(sessionId: string) {
    if (this.disposed) return
    this.stopWatch()
    this.controller.invalidate()
    this.controller.clearGrant('Live agent grant is being loaded')
    this.loadedEpoch = undefined
    const abort = (this.abort = new AbortController())
    try {
      const result = await this.connection.client.debugger.status(sessionId)
      if (abort.signal.aborted || this.disposed) return
      if (!this.trace && (await this.recordsRuns())) {
        this.trace = new TraceSession(
          new TraceRpc((method, params) => this.connection.client.request(method, params)),
          this.controller,
          () => {
            ++this.revision.value
          }
        )
        // A run that ends opens in its tab: what the points took is looked at there, and a note
        // about it is written only when someone asks for one.
        this.trace.onRunEnded((runId) => {
          if (!this.disposed) void import('./trace/panel').then((m) => m.openRun(this, runId))
        })
      }
      if (abort.signal.aborted || this.disposed) return
      this.controller.observe(this.connection.client.debugger.current(sessionId))
      await this.loadGrant(abort)
      if (abort.signal.aborted || this.disposed) return
      await this.refresh()
      if (abort.signal.aborted) return
      void this.loop(
        sessionId,
        result.snapshot.event_seq,
        result.snapshot.incarnation,
        abort
      ).catch((e) => {
        if (!abort.signal.aborted) this.fail(e)
      })
    } catch (e) {
      if (!abort.signal.aborted) this.fail(e)
    }
  }
  /** Whether the node records runs. A node that cannot say is treated as one that does not: the
   * debugger itself works the same either way. */
  private async recordsRuns() {
    try {
      const client = this.connection.client as { describe?: () => Promise<unknown> }
      return typeof client.describe === 'function' && nodeTraceSupported(await client.describe())
    } catch (e) {
      console.debug('[debugger] Run recording support unknown', e)
      return false
    }
  }
  private async loadGrant(abort: AbortController) {
    const snapshot = this.controller.snapshot
    if (!snapshot || !this.controller.current || abort.signal.aborted) return
    // Optional typed client extension. The current SDK has no grant reader; never guess a wire RPC.
    const client = this.connection.client.debugger as typeof this.connection.client.debugger & {
      liveGrant?: (sessionId: string) => Promise<unknown>
    }
    if (typeof client.liveGrant !== 'function') {
      if (!this.controller.grantId)
        this.controller.clearGrant('This node does not expose a live-grant read API')
      return
    }
    const generation = ++this.grantGeneration
    const current = () =>
      !abort.signal.aborted &&
      !this.disposed &&
      generation === this.grantGeneration &&
      this.controller.current &&
      this.controller.snapshot?.debug_session_id === snapshot.debug_session_id &&
      this.controller.snapshot.incarnation === snapshot.incarnation
    try {
      const grant = await client.liveGrant(snapshot.debug_session_id)
      if (!current()) return
      if (grant === null || grant === undefined)
        this.controller.clearGrant('No live agent grant is available for this session')
      else this.controller.bindGrant(grant)
    } catch (error) {
      if (!current()) return
      console.debug('[debugger] Live grant unavailable', error)
      this.controller.clearGrant(
        error instanceof Error
          ? `Live agent grant unavailable: ${error.message}`
          : 'Live agent grant could not be verified'
      )
    }
  }
  private async loop(
    sessionId: string,
    eventSeq: number,
    incarnation: string,
    abort: AbortController
  ) {
    while (
      !abort.signal.aborted &&
      this.controller.current &&
      !['terminated', 'detached', 'failed'].includes(this.controller.snapshot.lifecycle)
    ) {
      const waitId = (this.waitId = crypto.randomUUID())
      const result = await this.connection.client.debugger.wait({
        debug_session_id: sessionId,
        incarnation,
        after_event_seq: eventSeq,
        wait_id: waitId,
        kinds: [
          'stopped',
          'continued',
          'thread',
          'threads',
          'invalidated',
          'lifecycle',
          'execution_intent',
          'target_replaced',
          'breakpoints_patch',
          'breakpoints_result',
          'capabilities',
          'control_pending',
          'output',
        ],
        timeout_ms: 60000,
      })
      if (this.waitId === waitId) this.waitId = undefined
      if (abort.signal.aborted || this.disposed) return
      this.controller.observe(this.connection.client.debugger.current(sessionId))
      if (result.reason === 'connection_lost' || !result.snapshot) {
        this.controller.disconnected()
        await this.lastRuns()
        return
      }
      if (result.reason === 'cancelled') return
      await this.loadGrant(abort)
      if (abort.signal.aborted) return
      await this.refresh()
      eventSeq = result.snapshot.event_seq
      incarnation = result.snapshot.incarnation
    }
    if (!abort.signal.aborted && !this.disposed) await this.lastRuns()
  }
  /** The session is over: its run, if it was writing one, is kept on the node; read it once more. */
  private async lastRuns() {
    await this.trace?.refresh().catch((e) => console.debug('[debugger] Runs unavailable', e))
  }
  refresh(): Promise<void> {
    return (this.refreshing ??= (async () => {
      if (!this.controller.current) return
      DebuggerService.instance.syncSources(this)
      await this.controller.refreshApprovals()
      await this.controller.refreshHistory()
      await this.controller.refreshOutput()
      await this.trace?.refresh().catch((e) => console.debug('[debugger] Runs unavailable', e))
      const epoch = this.controller.snapshot?.stop_epoch
      if (
        this.controller.session.status === 'paused' &&
        epoch !== this.loadedEpoch &&
        !this.trace?.isRecordStop()
      ) {
        await this.controller.loadStack()
        this.loadedEpoch = epoch
        const f = this.controller.session.frames[0]
        if (f) DebuggerService.instance.reveal(this, f.file, f.line)
      }
    })().finally(() => {
      this.refreshing = undefined
    }))
  }
  fail(error: unknown) {
    if (this.disposed) return
    console.debug('[debugger] Request unavailable', error)
    this.controller.error = error instanceof Error ? error.message : 'Debugger unavailable'
    this.controller.disconnected()
  }
  private stopWatch() {
    ++this.grantGeneration
    this.abort?.abort()
    this.abort = undefined
    if (this.waitId && this.sessionId)
      void this.connection.client.debugger
        .cancelWait({ debug_session_id: this.sessionId, wait_id: this.waitId })
        .catch(() => {})
    this.waitId = undefined
  }
  destroy() {
    this.disposed = true
    this.stopWatch()
    this.stopConnection()
    this.controller.invalidate()
  }
}

export interface DebugSourceReveal {
  registrationId: string
  conversationId: string
  sourceId: string
  path: string
  line: number
}
export class DebuggerService {
  static readonly instance = new DebuggerService()
  readonly active = shallowRef<DebuggerBinding | null>(null)
  private readonly bindings = new Map<string, DebuggerBinding>()
  private readonly revealers = new Set<(request: DebugSourceReveal) => boolean>()
  readonly sources = new Map<
    string,
    Map<string, { path: string; debugSessionId: string; incarnation: string }>
  >()
  private key(registrationId: string, conversationId: string) {
    return JSON.stringify([registrationId, conversationId])
  }
  binding(presenter: NodeChatPresenter) {
    const key = this.key(presenter.reference.registrationId, presenter.reference.sessionId)
    let binding = this.bindings.get(key)
    if (!binding) {
      binding = new DebuggerBinding(
        presenter.connection,
        presenter.reference.sessionId,
        presenter.reference.registrationId
      )
      this.bindings.set(key, binding)
    }
    return binding
  }
  forSource(registrationId: string, conversationId: string) {
    return this.bindings.get(this.key(registrationId, conversationId))
  }
  async sessions(presenter: NodeChatPresenter) {
    await presenter.connection.connect()
    if (!nodeDebuggerSupported(await presenter.connection.client.describe()))
      throw new Error('This node does not advertise debugger support')
    const result = await presenter.connection.client.request('debugger.v1.sessions', {
      conversation_id: presenter.reference.sessionId,
    })
    return z.array(z.unknown().transform((raw) => DebuggerSnapshotSchema.parse(raw))).parse(result)
  }
  select(binding: DebuggerBinding) {
    this.active.value = binding
  }
  registerRevealer(reveal: (request: DebugSourceReveal) => boolean) {
    this.revealers.add(reveal)
    return () => this.revealers.delete(reveal)
  }
  registerSource(
    registrationId: string,
    conversationId: string,
    sourceId: string,
    path: string,
    debugSessionId: string,
    incarnation: string
  ) {
    const key = this.key(registrationId, conversationId)
    const sources =
      this.sources.get(key) ??
      new Map<string, { path: string; debugSessionId: string; incarnation: string }>()
    const mapping = { path, debugSessionId, incarnation }
    sources.set(sourceId, mapping)
    this.sources.set(key, sources)
    const binding = this.forSource(registrationId, conversationId)
    if (binding) this.syncSources(binding)
    return () => {
      if (sources.get(sourceId) === mapping) sources.delete(sourceId)
    }
  }
  syncSources(binding: DebuggerBinding) {
    for (const [id, mapping] of this.sources.get(
      this.key(binding.registrationId, binding.conversationId)
    ) ?? []) {
      if (
        mapping.debugSessionId === binding.sessionId &&
        mapping.incarnation === binding.controller.snapshot?.incarnation
      )
        binding.controller.registerSource(id, mapping.path)
    }
  }
  /** The source a file of this session is known by, from the node file tab that opened it. */
  sourceFor(binding: DebuggerBinding, file: string) {
    const sources = this.sources.get(this.key(binding.registrationId, binding.conversationId))
    return [...(sources ?? [])].find(
      ([id, mapping]) =>
        mapping.debugSessionId === binding.sessionId &&
        mapping.incarnation === binding.controller.snapshot?.incarnation &&
        (id === file || mapping.path === file)
    )?.[0]
  }
  reveal(binding: DebuggerBinding, file: string, line: number) {
    const sources = this.sources.get(this.key(binding.registrationId, binding.conversationId))
    const source = [...(sources ?? [])].find(
      ([id, mapping]) =>
        mapping.debugSessionId === binding.sessionId &&
        mapping.incarnation === binding.controller.snapshot?.incarnation &&
        (id === file || mapping.path === file)
    )
    if (!source) {
      binding.controller.error = 'Source mapping is not available from this node'
      ++binding.revision.value
      return
    }
    for (const reveal of this.revealers)
      if (
        reveal({
          registrationId: binding.registrationId,
          conversationId: binding.conversationId,
          sourceId: source[0],
          path: source[1].path,
          line,
        })
      )
        return
    binding.controller.error = 'Open the node file tab to reveal this source'
    ++binding.revision.value
  }
  cards(presenter: NodeChatPresenter) {
    const binding = this.binding(presenter)
    return computed(() => {
      void binding.revision.value
      return binding.controller.actions.map((action) => ({ ...action }))
    })
  }
  destroy() {
    for (const binding of this.bindings.values()) binding.destroy()
    this.bindings.clear()
    this.sources.clear()
    this.revealers.clear()
    this.active.value = null
  }
}
