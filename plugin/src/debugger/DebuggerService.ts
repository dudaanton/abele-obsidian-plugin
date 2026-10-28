import { t } from '@/i18n'
import { computed, shallowRef, watch, type WatchStopHandle } from 'vue'
import type { NodeConnection } from '@/node/NodeService'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { debugIdentity, debugOwnerParams, isFolderOwner, type DebugOwner } from './owner'
import {
  DebuggerSnapshotSchema,
  DebuggerControlMethodSchemas,
  type DebuggerSnapshot,
} from '@abele/node-protocol'
import { z } from 'zod'
import { DebuggerController } from './DebuggerController'
import { nodeDebuggerSupported } from '@/node/providers'
import { TraceSession } from './trace/TraceSession'
import { nodeTraceSupported, TraceRpc } from './trace/wire'
import { ItemView, Platform } from 'obsidian'
import type { PathTarget } from '@/node/NodePathModel'
import { GlobalStore } from '@/stores/GlobalStore'
import { nodeAdvertisesMethod } from '@/node/advertisedMethods'
import { breakpointCapabilities } from './breakpointCapabilities'
import { debuggerAcceptanceCapabilities } from '@/node/acceptanceCapabilities'
import { waitForDebuggerMetadata } from './metadataWait'

export interface SourceAdmission {
  message: string
  code?: string
}

type SourceMapping = {
  path: string
  aliases?: Set<string>
  debugSessionId: string
  incarnation: string
  folder?: PathTarget
}

/** One session's UI lifetime. The owner client never supplies agent tool authority. */
/** The node channel gives a request five seconds before it gives up on the connection, so the
 * panel waits for what the program does in rounds well inside that. */
const WAIT_ROUND_MS = 4000

export class DebuggerBinding {
  readonly revision = shallowRef(0)
  readonly acceptanceCapabilities = shallowRef(debuggerAcceptanceCapabilities(undefined))
  readonly controller: DebuggerController
  attachmentKey?: string
  retainedBreakpoints: ReturnType<DebuggerController['knownBreakpoints']> = []
  sessionMissing = false
  /** The session's recording, where the node records runs. */
  trace?: TraceSession
  /** Runs the program last started from this chat again, with the same files: Restart in the panel. */
  rerun?: () => Promise<unknown>
  reattach?: () => Promise<unknown>
  private abort?: AbortController
  private waitId?: string
  private stopConnection: WatchStopHandle
  private disposed = false
  private refreshing?: Promise<void>
  private reconnectTimer?: number
  private openingSessionId?: string
  private loadedEpoch?: number
  private stopExceptionText = false
  private grantGeneration = 0
  constructor(
    readonly connection: NodeConnection,
    readonly conversationId: string,
    readonly registrationId: string
  ) {
    this.controller = new DebuggerController(
      {
        rpc: (method, params) => connection.client.request(method, params),
        command: (method, params) => {
          const wireMethod = `debugger.v1.${method}` as keyof typeof DebuggerControlMethodSchemas
          const schema = DebuggerControlMethodSchemas[wireMethod]
          if (!schema) return Promise.reject(new Error('Unsupported debugger command'))
          // The controller already fences its snapshot and consumes receipts. The SDK helper
          // adds a status preflight that can delay dispatch until after a disconnect click.
          return connection.client.request(wireMethod, schema.parse(params))
        },
        cancelPending: () => {
          this.stopWatch()
          this.trace?.dispose()
        },
      },
      () => {
        if (
          this.controller?.current &&
          !['exited', 'lost'].includes(this.controller.session.status)
        )
          this.retainedBreakpoints = this.controller.knownBreakpoints()
        ++this.revision.value
      }
    )
    this.stopConnection = watch(
      [connection.state, () => connection.healthEpoch?.value],
      ([state], [previous]) => {
        if (state !== 'connected') {
          this.stopWatch()
          this.controller.invalidate()
          this.scheduleReconnect()
        } else if (
          !this.disposed &&
          !this.controller.disconnectRequested &&
          this.observationId &&
          (previous !== 'connected' ||
            (!this.controller.current && !this.controller.session.unavailable)) &&
          !this.abort
        ) {
          // Recover observation only; never replay controls or restart the program.
          void this.open(this.observationId).catch((error) => this.fail(error))
        }
      },
      { flush: 'sync' }
    )
  }
  get sessionId() {
    return this.controller.snapshot?.debug_session_id
  }
  get observationId() {
    return this.controller.current ? this.sessionId : (this.openingSessionId ?? this.sessionId)
  }
  async open(sessionId: string) {
    console.debug(
      '[debugger] Opening observation',
      sessionId,
      this.disposed,
      this.connection.state.value
    )
    if (this.disposed) return
    this.openingSessionId = sessionId
    this.sessionMissing = false
    this.stopWatch()
    this.controller.invalidate()
    if (this.controller.disconnectRequested) this.trace = undefined
    this.controller.resumeObservation()
    this.controller.clearGrant('Live agent grant is being loaded')
    this.loadedEpoch = undefined
    const abort = (this.abort = new AbortController())
    try {
      const result = await this.connection.client.debugger.status(sessionId)
      console.debug('[debugger] Snapshot read', sessionId, result.snapshot.lifecycle)
      if (abort.signal.aborted || this.disposed) return
      // Publish the status before optional capability/recording reads can stall.
      this.controller.observe(this.connection.client.debugger.current(sessionId))
      const recordsRuns = await this.recordsRuns()
      if (!this.trace && recordsRuns) {
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
      this.controller.session.unavailable = ['terminated', 'detached', 'failed'].includes(
        result.snapshot.lifecycle
      )
      if (this.controller.session.unavailable) this.controller.session.status = 'exited'
      ++this.revision.value
      if (this.controller.current || this.controller.session.unavailable) this.controller.error = ''
      await this.loadGrant(abort)
      if (abort.signal.aborted || this.disposed) return
      await this.refresh()
      if (abort.signal.aborted) return
      DebuggerService.instance.observeFolder(this, sessionId)
      void this.loop(sessionId, result.snapshot.event_seq, result.snapshot.incarnation, abort)
        .catch((e) => {
          if (!abort.signal.aborted) this.observationFailed(e)
        })
        .finally(() => {
          if (this.abort === abort && !this.controller.current) this.abort = undefined
        })
    } catch (e) {
      if (!abort.signal.aborted) {
        if (e && typeof e === 'object' && 'code' in e && e.code === 'not_found') {
          this.sessionMissing = true
          this.controller.disconnected()
          this.controller.session.unavailable = true
          this.controller.session.status = 'exited'
          this.controller.error = ''
          ++this.revision.value
        } else this.observationFailed(e)
      }
    } finally {
      if (this.abort === abort && !this.controller.current) this.abort = undefined
      this.scheduleReconnect()
    }
  }
  /** Whether the node records runs. A node that cannot say is treated as one that does not: the
   * debugger itself works the same either way. */
  private async recordsRuns() {
    try {
      const client = this.connection.client as { describe?: () => Promise<unknown> }
      const description =
        typeof client.describe === 'function' ? await client.describe() : undefined
      this.acceptanceCapabilities.value = debuggerAcceptanceCapabilities(description)
      this.stopExceptionText = this.acceptanceCapabilities.value.stop_exception_text
      this.controller.setCapabilities({
        ...breakpointCapabilities(description),
        ...this.acceptanceCapabilities.value,
      })
      return nodeTraceSupported(description)
    } catch (e) {
      console.debug('[debugger] Run recording support unknown', e)
      this.controller.setCapabilities({})
      this.acceptanceCapabilities.value = debuggerAcceptanceCapabilities(undefined)
      this.stopExceptionText = false
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
          ? t('streamC.215acaee0308ca12', { v1: String(error.message) })
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
      const params = {
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
        timeout_ms: WAIT_ROUND_MS,
      }
      const result = this.stopExceptionText
        ? await waitForDebuggerMetadata(this.connection.client, params)
        : await this.connection.client.debugger.wait(params)
      if (this.waitId === waitId) this.waitId = undefined
      if (abort.signal.aborted || this.disposed) return
      if (result.reason !== 'event' && result.reason !== 'elapsed')
        console.debug('[debugger] Wait ended', result.reason, !!result.snapshot)
      this.controller.observe(
        this.stopExceptionText
          ? result.snapshot
            ? { observation: 'current', snapshot: result.snapshot }
            : { observation: 'unknown', snapshot: null }
          : this.connection.client.debugger.current(sessionId)
      )
      if (result.reason === 'connection_lost' || !result.snapshot) {
        this.controller.disconnected()
        if (this.abort === abort) this.abort = undefined
        this.scheduleReconnect()
        await this.lastRuns()
        return
      }
      if (result.reason === 'cancelled') {
        // A terminated target cancels its waits too. Read its retained final output before
        // ending the observer, including the exception that made the program exit.
        await this.refresh()
        return
      }
      // A quiet round: nothing happened, so nothing is read again; the next round asks on.
      if (result.reason === 'elapsed' && result.snapshot.event_seq === eventSeq) continue
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
    // A read already under way may have started before the program ended: read after it.
    await this.trace?.refresh().catch(() => {})
    await this.trace?.refresh().catch((e) => console.debug('[debugger] Runs unavailable', e))
    // Native process exit evidence can follow adapter termination. These bounded reads
    // retrieve diagnostics only; they never infer ownership or send a control again.
    for (let attempt = 0; attempt < 3 && this.controller.awaitingExitCode; ++attempt) {
      if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 150))
      if (this.disposed || this.abort?.signal.aborted) break
      await this.controller
        .refreshExitInfo()
        .catch((e) => console.debug('[debugger] Final exit metadata unavailable', e))
    }
  }
  refresh(): Promise<void> {
    return (this.refreshing ??= (async () => {
      if (!this.controller.current) return
      DebuggerService.instance.syncSources(this)
      await this.controller.refreshApprovals()
      await this.controller.refreshHistory()
      await this.controller.refreshOutput()
      await this.controller
        .refreshExitInfo()
        .catch((e) => console.debug('[debugger] Exit metadata unavailable', e))
      await this.trace?.refresh().catch((e) => console.debug('[debugger] Runs unavailable', e))
      const epoch = this.controller.snapshot?.stop_epoch
      if (this.controller.loadedStackEpoch === epoch) this.loadedEpoch = epoch
      if (
        this.controller.session.status === 'paused' &&
        epoch !== this.loadedEpoch &&
        !this.trace?.isRecordStop()
      ) {
        await this.controller.loadStack()
        this.loadedEpoch = this.controller.loadedStackEpoch ?? epoch
        DebuggerService.instance.focusPause(this)
        // The first frame with a file: a program held on its first line sits in Node's loader.
        const f = this.controller.session.frames.find((frame) => frame.file)
        const view = Platform.isPhone
          ? GlobalStore.getInstance().app.workspace.getActiveViewOfType(ItemView)
          : undefined
        const request = view?.getViewType() === 'abele-request' ? view.getState() : undefined
        // The request tab names the paused location and opens the controls in one press.
        const keepRequest =
          request?.registrationId === this.registrationId &&
          request.projectId === this.controller.snapshot?.target.project_id
        if (f && !keepRequest && DebuggerService.instance.active.value === this) {
          if (Platform.isPhone) DebuggerService.instance.reveal(this, f.file, f.line, true)
          else DebuggerService.instance.reveal(this, f.file, f.line)
        }
      }
    })().finally(() => {
      this.refreshing = undefined
    }))
  }
  fail(error: unknown) {
    if (this.disposed || this.controller.disconnectRequested) return
    console.debug('[debugger] Request unavailable', error)
    this.controller.error = error instanceof Error ? error.message : t('streamC.e6d2c5631ed60d81')
    if (this.connection.state.value !== 'connected') this.controller.disconnected()
    else ++this.revision.value
  }
  private observationFailed(error: unknown) {
    this.fail(error)
    this.stopWatch()
    this.controller.disconnected()
    this.scheduleReconnect()
  }
  private scheduleReconnect() {
    if (
      this.disposed ||
      this.controller.disconnectRequested ||
      this.controller.current ||
      this.controller.session.unavailable ||
      this.abort ||
      !this.observationId ||
      this.reconnectTimer
    )
      return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined
      if (this.disposed || this.controller.disconnectRequested) return
      const id = this.observationId
      if (!id) return
      console.debug('[debugger] Retrying observation', id)
      void (async () => {
        await this.connection.connect()
        if (
          !this.disposed &&
          !this.controller.disconnectRequested &&
          !this.abort &&
          !this.controller.current
        )
          await this.open(id)
      })().catch((error) => {
        this.fail(error)
        this.scheduleReconnect()
      })
    }, 2000)
  }
  private stopWatch() {
    window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
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
    this.trace?.dispose()
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
  readonly sourceRevision = shallowRef(0)
  private stopped = false
  private initialSelection: unknown
  preferSelection(selection: unknown) {
    this.initialSelection = selection
    return () => {
      if (this.initialSelection === selection) this.initialSelection = undefined
    }
  }
  private selectionTarget(selection: unknown) {
    if (!selection || typeof selection !== 'object') return undefined
    const target = (selection as { target?: Partial<PathTarget> }).target
    return target && typeof target === 'object'
      ? JSON.stringify([target.registrationId, target.nodeId, target.kind, target.id])
      : undefined
  }
  private readonly folders = new Map<DebuggerBinding, { sessionId: string; target: PathTarget }>()
  private readonly selectedFolders = new Map<string, DebuggerBinding>()
  private folderKey(target: PathTarget) {
    return JSON.stringify([target.registrationId, target.nodeId, target.kind, target.id])
  }
  private readonly admissions = new Map<string, Promise<SourceAdmission>>()
  readonly pendingRevision = shallowRef(0)
  private readonly pendingPoints = new Map<
    string,
    { target: PathTarget; path: string; lines: Map<number, string> }
  >()
  private pendingKey(target: PathTarget, path: string) {
    return JSON.stringify([this.folderKey(target), path])
  }
  pendingBreakpoints(target: PathTarget, path: string): number[] {
    void this.pendingRevision.value
    return [...(this.pendingPoints.get(this.pendingKey(target, path))?.lines.keys() ?? [])]
  }
  togglePendingBreakpoint(target: PathTarget, path: string, line: number) {
    if (!Number.isSafeInteger(line) || line < 1) return
    const key = this.pendingKey(target, path)
    const points = this.pendingPoints.get(key) ?? { target: { ...target }, path, lines: new Map() }
    if (points.lines.has(line)) points.lines.delete(line)
    else points.lines.set(line, crypto.randomUUID())
    if (points.lines.size) this.pendingPoints.set(key, points)
    else this.pendingPoints.delete(key)
    ++this.pendingRevision.value
    console.debug('[debugger] Pending file breakpoints', path, [...points.lines.keys()])
  }
  private admitPendingFiles(target: PathTarget) {
    for (const points of this.pendingPoints.values())
      if (this.folderKey(points.target) === this.folderKey(target))
        void this.admitFile(target, points.path).catch((error) =>
          console.debug('[debugger] Pending source admission failed', error)
        )
  }
  private async applyPendingFile(
    target: PathTarget,
    path: string,
    binding: DebuggerBinding,
    sessionBound = false
  ) {
    const mapping = this.debugFor(target, path, sessionBound ? binding : undefined)
    const points = this.pendingPoints.get(this.pendingKey(target, path))
    if (!mapping || !points) return
    for (const [line, id] of points.lines) {
      if ((!sessionBound && this.folderBinding(target) !== binding) || !binding.controller.current)
        return
      // Stable identity makes a retried request idempotent; never toggle an existing point off.
      const existing = binding.controller
        .knownBreakpoints()
        .some((point) => point.sourceId === mapping.sourceId && point.line === line)
      const result = existing
        ? undefined
        : await binding.controller.setBreakpoint(id, mapping.sourceId, line)
      if (
        (existing || (result && result.outcome === 'completed')) &&
        points.lines.get(line) === id
      ) {
        points.lines.delete(line)
        ++this.pendingRevision.value
      }
    }
    if (!points.lines.size) this.pendingPoints.delete(this.pendingKey(target, path))
  }
  observeFolder(binding: DebuggerBinding, sessionId: string) {
    const folder = this.folders.get(binding)
    if (folder) {
      folder.sessionId = sessionId
      ++this.sourceRevision.value
      this.admitPendingFiles(folder.target)
    }
  }
  trackFolder(owner: DebugOwner, sessionId: string, target: PathTarget) {
    this.folders.set(this.binding(owner, sessionId), { sessionId, target: { ...target } })
    ++this.sourceRevision.value
    this.admitPendingFiles(target)
  }
  takenFiles(binding: DebuggerBinding): string[] {
    return [
      ...(this.sources.get(this.key(binding.registrationId, binding.conversationId))?.values() ??
        []),
    ]
      .filter(
        (m) =>
          m.debugSessionId === binding.sessionId &&
          m.incarnation === binding.controller.snapshot?.incarnation
      )
      .map((m) => m.path)
  }
  /** Reactive lookup also observes session changes, so a file already open gains its margin. */
  folderBinding(target: PathTarget | null | undefined) {
    void this.sourceRevision.value
    if (!target) return undefined
    const selected = this.selectedFolders.get(this.folderKey(target)) ?? this.active.value
    const entries = [...this.folders].sort(
      ([a], [b]) => Number(b === selected) - Number(a === selected)
    )
    for (const [binding, folder] of entries) {
      void binding.revision.value
      if (
        folder.target.registrationId === target.registrationId &&
        folder.target.nodeId === target.nodeId &&
        folder.target.kind === target.kind &&
        folder.target.id === target.id &&
        (!folder.sessionId || folder.sessionId === binding.sessionId) &&
        binding.controller.current &&
        !['exited', 'disconnected'].includes(binding.controller.session.status)
      )
        return binding
    }
    return undefined
  }
  async admitSessionFile(binding: DebuggerBinding, path: string): Promise<SourceAdmission> {
    const snapshot = binding.controller.snapshot
    const target =
      this.folder(binding) ??
      (snapshot && {
        registrationId: binding.registrationId,
        nodeId: snapshot.target.node_id,
        projectId: snapshot.target.project_id,
        kind: snapshot.target.worktree_id ? ('worktree' as const) : ('workspace' as const),
        id: snapshot.target.worktree_id ?? snapshot.target.workspace_id ?? '',
      })
    if (!target?.id) return { message: t('debug.sourceUnavailable') }
    return this.admitFile(target, path, true, binding)
  }
  async admitFile(
    target: PathTarget,
    path: string,
    recheck = false,
    sessionBinding?: DebuggerBinding
  ): Promise<SourceAdmission> {
    const binding = sessionBinding ?? this.folderBinding(target)
    if (!binding || !/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) return { message: '' }
    if (/^(?:\/|[a-z]:)|\\|(?:^|\/)\.\.(?:\/|$)|(?:^|\/)\.git(?:\/|$)|\0/i.test(path))
      return { message: t('debug.sourceOutside') }
    if (!recheck && this.debugFor(target, path, sessionBinding)) {
      await this.applyPendingFile(target, path, binding, !!sessionBinding)
      return { message: '' }
    }
    if (/\.d\.[cm]?ts$/.test(path)) return sourceRefusal('debugger_source_declaration')
    const sessionId = binding.sessionId
    const incarnation = binding.controller.snapshot?.incarnation
    if (!sessionId || !incarnation) return { message: '' }
    const generation = binding.connection.authorizationGeneration
    const client = binding.connection.client
    const key = JSON.stringify([
      binding.registrationId,
      binding.conversationId,
      sessionId,
      incarnation,
      generation,
      path,
    ])
    const pending = this.admissions.get(key)
    if (pending !== undefined) return pending
    const current = () =>
      (sessionBinding ? binding.controller.current : this.folderBinding(target) === binding) &&
      binding.connection.authorizationGeneration === generation &&
      binding.connection.client === client &&
      binding.sessionId === sessionId &&
      binding.controller.snapshot?.incarnation === incarnation
    const attempt = (async () => {
      try {
        if (!current()) return { message: '' }
        if (!nodeAdvertisesMethod(client, 'debugger.v1.addSources')) {
          return { message: t('debug.sourceUpdate') }
        }
        const result = z
          .object({
            incarnation: z.string(),
            sources: z.array(z.object({ source_id: z.string(), path: z.string() })),
            refused: z.array(z.object({ path: z.string(), code: z.string() })),
          })
          .parse(
            await client.request('debugger.v1.addSources', {
              operation_id: crypto.randomUUID(),
              debug_session_id: sessionId,
              sources: [path],
            })
          )
        if (!current() || result.incarnation !== incarnation) return { message: '' }
        console.debug('[debugger] Source admission', path, result)
        // One requested file may come back under its canonical, symlink-resolved path.
        const accepted = result.sources.length === 1 && result.refused.length === 0
        for (const source of result.sources)
          this.registerSource(
            binding.registrationId,
            binding.conversationId,
            source.source_id,
            source.path,
            sessionId,
            incarnation,
            target,
            accepted ? path : source.path
          )
        const refusal = result.refused.find((r) => r.path === path)
        if (refusal) return sourceRefusal(refusal.code)
        if (accepted) await this.applyPendingFile(target, path, binding, !!sessionBinding)
        return {
          message: accepted ? '' : t('debug.sourceUnavailable'),
        }
      } catch (error) {
        console.debug('[debugger] Source admission failed', error)
        this.admissions.delete(key)
        if (!current()) return { message: '' }
        if (error && typeof error === 'object' && 'code' in error)
          return sourceRefusal(String(error.code))
        return { message: t('debug.sourceUnavailable') }
      }
    })()
    this.admissions.set(key, attempt)
    // Coalesce requests in flight; a refusal must be rechecked after a file is restored/rebuilt.
    void attempt.finally(() => {
      if (this.admissions.get(key) === attempt) this.admissions.delete(key)
    })
    return attempt
  }
  readonly active = shallowRef<DebuggerBinding | null>(null)
  projectBindings(registrationId: string, projectId: string) {
    void this.sourceRevision.value
    return [...this.bindings.values()].filter((binding) => {
      void binding.revision.value
      return (
        binding.registrationId === registrationId &&
        binding.controller.snapshot?.target.project_id === projectId
      )
    })
  }
  private readonly bindings = new Map<string, DebuggerBinding>()
  private readonly owners = new WeakMap<DebuggerBinding, DebugOwner>()
  private readonly preferredSessions = new Set<string>()
  owner(binding: DebuggerBinding) {
    return this.owners.get(binding)
  }
  folder(binding: DebuggerBinding) {
    return this.folders.get(binding)?.target
  }
  forAttachment(owner: DebugOwner, key: string) {
    const identity = debugIdentity(owner)
    return [...this.bindings.values()].reverse().find((binding) => {
      if (binding.registrationId !== identity.registrationId || binding.attachmentKey !== key)
        return false
      const folder = this.folder(binding)
      return isFolderOwner(owner)
        ? folder?.kind === owner.target.kind && folder.id === owner.target.id
        : binding.conversationId === identity.key
    })
  }
  selectionState() {
    if (this.stopped) return undefined
    const binding = this.active.value
    const target = binding && this.folder(binding)
    const sessionId = binding?.sessionId ?? (binding && this.folders.get(binding)?.sessionId)
    if (!binding || !sessionId || !target) return {}
    const peers = [...new Set([binding, ...this.peers(binding)])]
    return {
      sessionId,
      sessions: [
        ...new Set([
          sessionId,
          ...this.peers(binding).flatMap((peer) => (peer.sessionId ? [peer.sessionId] : [])),
        ]),
      ].slice(0, 256),
      target,
      attachments: peers
        .flatMap((peer) =>
          peer.attachmentKey && peer.sessionId
            ? [{ sessionId: peer.sessionId, key: peer.attachmentKey }]
            : []
        )
        .slice(0, 256),
      watches: peers
        .flatMap((peer) =>
          peer.sessionId
            ? peer.controller.session.watches.slice(0, 128).map(({ expression }) => ({
                sessionId: peer.sessionId,
                expression,
              }))
            : []
        )
        .slice(0, 256),
      sources: peers
        .flatMap((peer) => {
          const id = peer === binding ? sessionId : peer.sessionId
          const incarnation = peer.controller.snapshot?.incarnation
          const known = new Map(
            [
              ...(this.sources.get(this.key(peer.registrationId, peer.conversationId)) ?? []),
            ].filter(
              ([, source]) => source.debugSessionId === id && source.incarnation === incarnation
            )
          )
          if (id && incarnation)
            for (const point of peer.controller.knownBreakpoints()) {
              if (
                known.has(point.sourceId) ||
                point.file === point.sourceId ||
                /^(?:\/|[a-z]+:)|(?:^|\/)\.\.(?:\/|$)/i.test(point.file)
              )
                continue
              known.set(point.sourceId, {
                path: point.file,
                debugSessionId: id,
                incarnation,
              })
            }
          return [...known]
        })
        .slice(0, 256)
        .map(([sourceId, source]) => ({
          sourceId,
          sessionId: source.debugSessionId,
          path: source.path,
          incarnation: source.incarnation,
        })),
    }
  }
  async restoreSelection(raw: unknown, ownerOf: (target: PathTarget) => DebugOwner) {
    const target = this.selectionTarget(raw)
    if (
      this.initialSelection !== undefined &&
      raw &&
      typeof raw === 'object' &&
      'sessionId' in raw &&
      (this.initialSelection === null ||
        (target !== undefined && target === this.selectionTarget(this.initialSelection)))
    )
      raw = this.initialSelection
    const parsed = z
      .object({
        sessionId: z.string().min(1).max(128),
        sessions: z.array(z.string().min(1).max(128)).max(256).default([]),
        attachments: z
          .array(
            z.object({ sessionId: z.string().min(1).max(128), key: z.string().min(1).max(128) })
          )
          .max(256)
          .default([]),
        target: z.unknown(),
        watches: z
          .array(
            z.object({
              sessionId: z.string().min(1).max(128),
              expression: z.string().min(1).max(16384),
            })
          )
          .max(256)
          .default([]),
        sources: z
          .array(
            z.object({
              sourceId: z.string().max(128),
              sessionId: z.string().min(1).max(128).optional(),
              path: z.string().max(4096),
              incarnation: z.string().max(128),
            })
          )
          .max(256)
          .default([]),
      })
      .safeParse(raw)
    if (!parsed.success) return
    const { NodePathTabSchema } = await import('@/node/nodePathNavigation')
    const tab = NodePathTabSchema.safeParse({ kind: 'history', target: parsed.data.target })
    if (!tab.success) return
    const owner = ownerOf(tab.data.target)
    for (const id of parsed.data.sessions) this.preferredSessions.add(id)
    const binding = this.binding(owner, parsed.data.sessionId)
    for (const saved of parsed.data.watches) {
      const watches = this.binding(owner, saved.sessionId).controller.session.watches
      if (!watches.some((watch) => watch.expression === saved.expression))
        watches.push({ expression: saved.expression, stale: true })
    }
    for (const attachment of parsed.data.attachments)
      this.binding(owner, attachment.sessionId).attachmentKey = attachment.key
    for (const source of parsed.data.sources) {
      const sourceSessionId = source.sessionId ?? parsed.data.sessionId
      const sourceBinding = this.binding(owner, sourceSessionId)
      this.registerSource(
        sourceBinding.registrationId,
        sourceBinding.conversationId,
        source.sourceId,
        source.path,
        sourceSessionId,
        source.incarnation,
        tab.data.target
      )
    }
    this.select(binding)
    try {
      await owner.connection.connect()
    } catch (error) {
      binding.fail(error)
      throw error
    }
    await binding.open(parsed.data.sessionId)
    for (const id of new Set(parsed.data.sessions)) {
      if (id !== parsed.data.sessionId) await this.binding(owner, id).open(id)
    }
    ++binding.revision.value
    await this.discover(owner)
  }
  peers(binding: DebuggerBinding) {
    void this.sourceRevision.value
    const target = this.folder(binding)
    if (!target) return [binding]
    const candidates = [...this.bindings.values()].filter((candidate) => {
      const folder = this.folder(candidate)
      return (
        folder?.registrationId === target.registrationId &&
        folder.kind === target.kind &&
        folder.id === target.id &&
        !!candidate.sessionId
      )
    })
    const visible = new Set(
      this.uniqueSessions(
        candidates.flatMap((candidate) =>
          candidate.controller.snapshot ? [candidate.controller.snapshot] : []
        )
      ).map((snapshot) => snapshot.debug_session_id)
    )
    return candidates.filter(
      (candidate) => !!candidate.sessionId && visible.has(candidate.sessionId)
    )
  }
  private processKey(snapshot: DebuggerSnapshot) {
    const target = snapshot.target,
      evidence = target.process_evidence
    const nativePid = / · pid ([1-9]\d*)$/.exec(target.launch_configuration_id)?.[1]
    const pid = evidence?.pid ?? (nativePid ? Number(nativePid) : undefined)
    return (evidence || target.process_ownership === 'external') && pid
      ? JSON.stringify([
          target.node_id,
          target.project_id,
          target.workspace_id,
          target.worktree_id,
          pid,
        ])
      : snapshot.debug_session_id
  }
  private uniqueSessions(sessions: DebuggerSnapshot[]) {
    const known = new Set([...this.bindings.values()].map((binding) => binding.sessionId))
    const score = (snapshot: DebuggerSnapshot) =>
      (['active', 'starting'].includes(snapshot.lifecycle) ? 1000000 : 0) +
      (snapshot.debug_session_id === this.active.value?.sessionId ? 100000 : 0) +
      (this.preferredSessions.has(snapshot.debug_session_id) ? 20000 : 0) +
      (known.has(snapshot.debug_session_id) ? 10000 : 0) +
      (snapshot.lifecycle === 'active' ? 1000 : 0) +
      (snapshot.selected_thread_id !== null ? 100 : 0) +
      snapshot.breakpoints.length
    const unique = new Map<string, DebuggerSnapshot>()
    for (const snapshot of sessions) {
      // Older native adapters expose both their wrapper and driver session. Prefer process
      // evidence; their PID-bearing launch identity is the compatibility fallback.
      const key = this.processKey(snapshot)
      const previous = unique.get(key)
      if (!previous || score(snapshot) > score(previous)) unique.set(key, snapshot)
    }
    return [...unique.values()]
  }
  async discover(owner: DebugOwner) {
    if (!isFolderOwner(owner)) return
    const selected = this.active.value
    const sessions = await this.sessions(owner)
    const known = [...this.bindings.values()].flatMap((binding) => {
      const folder = this.folder(binding),
        snapshot = binding.controller.snapshot
      return folder?.registrationId === owner.target.registrationId &&
        folder.kind === owner.target.kind &&
        folder.id === owner.target.id &&
        snapshot
        ? [snapshot]
        : []
    })
    const visible = this.uniqueSessions([...known, ...sessions])
    for (const s of visible) {
      const binding = this.binding(owner, s.debug_session_id)
      if (!binding.sessionId) await binding.open(s.debug_session_id)
    }
    const folder = selected && this.folder(selected)
    if (
      this.active.value === selected &&
      selected?.controller.snapshot &&
      folder &&
      this.folderKey(folder) === this.folderKey(owner.target)
    ) {
      const key = this.processKey(selected.controller.snapshot)
      const replacement = visible.find((snapshot) => this.processKey(snapshot) === key)
      if (replacement && replacement.debug_session_id !== selected.sessionId)
        this.select(this.binding(owner, replacement.debug_session_id))
    }
    ++this.sourceRevision.value
  }
  private readonly revealers = new Set<(request: DebugSourceReveal) => boolean>()
  readonly sources = new Map<string, Map<string, SourceMapping>>()
  private key(registrationId: string, conversationId: string) {
    return JSON.stringify([registrationId, conversationId])
  }
  binding(presenter: DebugOwner, sessionId?: string) {
    this.stopped = false
    const identity = debugIdentity(presenter, sessionId)
    if (isFolderOwner(presenter)) {
      if (sessionId) {
        const existing = [...this.bindings.values()].find(
          (binding) =>
            binding.registrationId === identity.registrationId &&
            binding.observationId === sessionId
        )
        if (existing) {
          this.owners.set(existing, presenter)
          this.folders.set(existing, { sessionId, target: { ...presenter.target } })
          return existing
        }
      }
      if (!sessionId) {
        const selected = this.active.value
        if (
          selected &&
          this.folders.get(selected)?.target.id === presenter.target.id &&
          selected.registrationId === identity.registrationId
        )
          return selected
      }
    }
    const key = this.key(identity.registrationId, identity.key)
    let binding = this.bindings.get(key)
    if (!binding) {
      binding = new DebuggerBinding(presenter.connection, identity.key, identity.registrationId)
      this.bindings.set(key, binding)
      ++this.sourceRevision.value
    }
    this.owners.set(binding, presenter)
    if (isFolderOwner(presenter)) {
      const tracked = this.folders.get(binding)
      if (!tracked)
        this.folders.set(binding, { sessionId: sessionId ?? '', target: { ...presenter.target } })
    }
    return binding
  }
  forSource(registrationId: string, conversationId: string) {
    return this.bindings.get(this.key(registrationId, conversationId))
  }
  async sessions(presenter: DebugOwner) {
    await presenter.connection.connect()
    if (!nodeDebuggerSupported(await presenter.connection.client.describe()))
      throw new Error('This node does not advertise debugger support')
    const result = await presenter.connection.client.request('debugger.v1.sessions', {
      ...debugOwnerParams(presenter),
    })
    const sessions = z
      .array(z.unknown().transform((raw) => DebuggerSnapshotSchema.parse(raw)))
      .parse(result)
    return this.uniqueSessions(sessions)
  }
  select(binding: DebuggerBinding) {
    this.active.value = binding
    const target = this.folder(binding)
    if (target) this.selectedFolders.set(this.folderKey(target), binding)
    ++this.sourceRevision.value
  }
  focusPause(binding: DebuggerBinding) {
    const active = this.active.value
    const folder = this.folder(binding)
    const selected = active && this.folder(active)
    if (folder && selected && this.folderKey(folder) === this.folderKey(selected))
      this.select(binding)
  }
  selectFolder(target: PathTarget) {
    const current = this.active.value
    const folder = current && this.folder(current)
    // Rehydrating the file drawer can select this folder before the retained debugger's
    // first status reply. Keep that pending selection instead of clearing it as absent.
    if (folder && this.folderKey(folder) === this.folderKey(target)) return
    this.active.value = this.folderBinding(target) ?? null
    ++this.sourceRevision.value
  }
  /** A run belongs to one session on one node, even when another debugger is active. */
  forRun(registrationId: string, projectId: string, sessionId: string) {
    return [...this.bindings.values()].find(
      (b) =>
        b.registrationId === registrationId &&
        b.sessionId === sessionId &&
        b.controller.snapshot?.target.project_id === projectId
    )
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
    incarnation: string,
    /** The folder the file is in, for a file the program took when it started. */
    folder?: PathTarget,
    alias = path
  ) {
    const key = this.key(registrationId, conversationId)
    const sources = this.sources.get(key) ?? new Map<string, SourceMapping>()
    const known = sources.get(sourceId)
    // A tab showing a file the program took leaves its mapping when it closes or moves on.
    if (known && known.debugSessionId === debugSessionId && known.incarnation === incarnation) {
      if (folder) known.folder = folder
      known.aliases ??= new Set()
      known.aliases.add(path)
      known.aliases.add(alias)
      return () => {}
    }
    const mapping: SourceMapping = {
      path,
      aliases: new Set([alias]),
      debugSessionId,
      incarnation,
      ...(folder ? { folder } : {}),
    }
    sources.set(sourceId, mapping)
    this.sources.set(key, sources)
    ++this.sourceRevision.value
    const binding = this.forSource(registrationId, conversationId)
    if (binding) this.syncSources(binding)
    return () => {
      if (sources.get(sourceId) === mapping) sources.delete(sourceId)
    }
  }
  /** The session mapping for a file a node file tab shows, when a live program took that file of
   * that folder: the tab shows its margin however it came to show the file. */
  debugFor(target: PathTarget | null | undefined, path: string, sessionBinding?: DebuggerBinding) {
    if (!target) return undefined
    for (const [key, sources] of this.sources) {
      const [registrationId, conversationId] = JSON.parse(key) as [string, string]
      if (registrationId !== target.registrationId) continue
      const binding = this.forSource(registrationId, conversationId)
      // Several sessions can debug one folder: only the selected one draws its margin there.
      // A program started from a chat is not a folder session and keeps its own margin.
      if (
        sessionBinding
          ? binding !== sessionBinding
          : binding && this.folders.has(binding) && binding !== this.folderBinding(target)
      )
        continue
      for (const [sourceId, m] of sources)
        if (
          (m.path === path || m.aliases?.has(path)) &&
          m.folder &&
          m.folder.kind === target.kind &&
          m.folder.id === target.id &&
          m.debugSessionId === binding?.sessionId &&
          m.incarnation === binding.controller.snapshot?.incarnation
        )
          return {
            conversationId,
            sourceId,
            debugSessionId: m.debugSessionId,
            incarnation: m.incarnation,
          }
    }
    return undefined
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
  reveal(binding: DebuggerBinding, file: string, line: number, keepControls = false) {
    console.debug('[debugger] Reveal source', file, line)
    let sources = this.sources.get(this.key(binding.registrationId, binding.conversationId))
    let source = [...(sources ?? [])].find(
      ([id, mapping]) =>
        mapping.debugSessionId === binding.sessionId &&
        mapping.incarnation === binding.controller.snapshot?.incarnation &&
        (id === file || mapping.path === file)
    )
    if (!source) {
      const mapped = binding.controller.mappedSource(file)
      const folder = this.folder(binding)
      const sessionId = binding.sessionId
      const snapshot = binding.controller.snapshot
      const prefix = folder?.location ? `${folder.location.path.replace(/\/+$/, '')}/` : undefined
      const path =
        mapped &&
        (prefix && mapped[1].startsWith(prefix) ? mapped[1].slice(prefix.length) : mapped[1])
      if (
        mapped &&
        folder &&
        sessionId &&
        snapshot &&
        path &&
        !/^(?:\/|[a-z]+:)|(?:^|\/)\.\.(?:\/|$)/i.test(path)
      ) {
        this.registerSource(
          binding.registrationId,
          binding.conversationId,
          mapped[0],
          path,
          sessionId,
          snapshot.incarnation,
          folder
        )
        sources = this.sources.get(this.key(binding.registrationId, binding.conversationId))
        const mapping = sources?.get(mapped[0])
        if (mapping) source = [mapped[0], mapping]
      }
    }
    if (!source) {
      binding.controller.error = t('debug.frameSourceUnavailable')
      ++binding.revision.value
      return
    }
    if (binding.controller.error === t('debug.frameSourceUnavailable')) {
      binding.controller.error = ''
      ++binding.revision.value
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
    // A file the program took and no tab shows: open it at the line, as the stop's place.
    if (source[1].folder) {
      const folder = source[1].folder
      void import('@/node/nodePathNavigation')
        .then(async ({ openNodePathTab, closeNodePathDrawers }) => {
          await openNodePathTab(
            GlobalStore.getInstance().app.workspace,
            {
              kind: 'file',
              target: folder,
              path: source[1].path,
              debug: {
                conversationId: binding.conversationId,
                sourceId: source[0],
                debugSessionId: source[1].debugSessionId,
                incarnation: source[1].incarnation,
                line,
              },
            },
            Platform.isMobile
          )
          if (keepControls) {
            const { revealSidebarView } = await import('@/views/revealSidebarView')
            await revealSidebarView(GlobalStore.getInstance().app, 'abele-debug-view')
          } else closeNodePathDrawers(GlobalStore.getInstance().app.workspace, Platform.isMobile)
        })
        .catch((e) => console.debug('[debugger] Source not opened', e))
      return
    }
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
    this.stopped = true
    this.initialSelection = undefined
    for (const binding of this.bindings.values()) binding.destroy()
    this.bindings.clear()
    this.sources.clear()
    this.preferredSessions.clear()
    this.folders.clear()
    this.selectedFolders.clear()
    this.admissions.clear()
    this.pendingPoints.clear()
    ++this.pendingRevision.value
    this.revealers.clear()
    this.active.value = null
  }
}

export function sourceRefusal(code: string): SourceAdmission {
  if (code === 'project_untrusted') return { message: t('node.error.trust'), code }
  if (code === 'debugger_source_no_map') return { message: t('debug.sourceMap') }
  if (code === 'debugger_source_changed') return { message: t('debug.sourceChanged') }
  if (code === 'debugger_source_test') return { message: t('debug.sourceTest') }
  if (code === 'debugger_source_declaration') return { message: t('debug.sourceDeclaration') }
  if (code === 'debugger_source_generated') return { message: t('debug.sourceGenerated') }
  if (code === 'debugger_source_outside_folder') return { message: t('debug.sourceOutside') }
  if (code === 'debugger_source_conflict') return { message: t('debug.sourceConflict') }
  if (code === 'debugger_source_limit') return { message: t('debug.sourceLimit') }
  if (code === 'debugger_source_unavailable') return { message: t('debug.sourceUnreadable') }
  return { message: t('debug.sourceUnavailable'), code }
}
