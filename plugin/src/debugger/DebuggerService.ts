import { t } from '@/i18n'
import { computed, shallowRef, watch, type WatchStopHandle } from 'vue'
import type { NodeConnection } from '@/node/NodeService'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { debugIdentity, debugOwnerParams, isFolderOwner, type DebugOwner } from './owner'
import { DebuggerSnapshotSchema, type DebuggerSnapshot } from '@abele/node-protocol'
import { z } from 'zod'
import { DebuggerController } from './DebuggerController'
import { nodeDebuggerSupported } from '@/node/providers'
import { TraceSession } from './trace/TraceSession'
import { nodeTraceSupported, TraceRpc } from './trace/wire'
import { Platform } from 'obsidian'
import type { PathTarget } from '@/node/NodePathModel'
import { GlobalStore } from '@/stores/GlobalStore'
import { nodeAdvertisesMethod } from '@/node/advertisedMethods'

export interface SourceAdmission {
  message: string
  code?: string
}

type SourceMapping = {
  path: string
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
  readonly controller: DebuggerController
  attachmentKey?: string
  retainedBreakpoints: ReturnType<DebuggerController['knownBreakpoints']> = []
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
  private openingSessionId?: string
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
        if (
          this.controller?.current &&
          !['exited', 'lost'].includes(this.controller.session.status)
        )
          this.retainedBreakpoints = this.controller.knownBreakpoints()
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
    this.stopWatch()
    this.controller.invalidate()
    this.controller.clearGrant('Live agent grant is being loaded')
    this.loadedEpoch = undefined
    const abort = (this.abort = new AbortController())
    try {
      const result = await this.connection.client.debugger.status(sessionId)
      console.debug('[debugger] Snapshot read', sessionId, result.snapshot.lifecycle)
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
      DebuggerService.instance.observeFolder(this, sessionId)
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
        timeout_ms: WAIT_ROUND_MS,
      })
      if (this.waitId === waitId) this.waitId = undefined
      if (abort.signal.aborted || this.disposed) return
      if (result.reason !== 'event' && result.reason !== 'elapsed')
        console.debug('[debugger] Wait ended', result.reason, !!result.snapshot)
      this.controller.observe(this.connection.client.debugger.current(sessionId))
      if (result.reason === 'connection_lost' || !result.snapshot) {
        this.controller.disconnected()
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
        // The first frame with a file: a program held on its first line sits in Node's loader.
        const f = this.controller.session.frames.find((frame) => frame.file)
        if (f && DebuggerService.instance.active.value === this)
          DebuggerService.instance.reveal(this, f.file, f.line)
      }
    })().finally(() => {
      this.refreshing = undefined
    }))
  }
  fail(error: unknown) {
    if (this.disposed) return
    console.debug('[debugger] Request unavailable', error)
    this.controller.error = error instanceof Error ? error.message : t('streamC.e6d2c5631ed60d81')
    if (this.connection.state.value !== 'connected') this.controller.disconnected()
    else ++this.revision.value
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
  private readonly folders = new Map<DebuggerBinding, { sessionId: string; target: PathTarget }>()
  private readonly selectedFolders = new Map<string, DebuggerBinding>()
  private folderKey(target: PathTarget) {
    return JSON.stringify([target.registrationId, target.nodeId, target.kind, target.id])
  }
  private readonly admissions = new Map<string, Promise<SourceAdmission>>()
  observeFolder(binding: DebuggerBinding, sessionId: string) {
    const folder = this.folders.get(binding)
    if (folder) {
      folder.sessionId = sessionId
      ++this.sourceRevision.value
    }
  }
  trackFolder(owner: DebugOwner, sessionId: string, target: PathTarget) {
    this.folders.set(this.binding(owner, sessionId), { sessionId, target: { ...target } })
    ++this.sourceRevision.value
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
  async admitFile(target: PathTarget, path: string): Promise<SourceAdmission> {
    const binding = this.folderBinding(target)
    if (!binding || !/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) || this.debugFor(target, path))
      return { message: '' }
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
      this.folderBinding(target) === binding &&
      binding.connection.authorizationGeneration === generation &&
      binding.connection.client === client &&
      binding.sessionId === sessionId &&
      binding.controller.snapshot?.incarnation === incarnation
    let retained = false
    const attempt = (async () => {
      try {
        if (!current()) return { message: '' }
        if (!nodeAdvertisesMethod(client, 'debugger.v1.addSources')) {
          retained = true
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
        for (const source of result.sources)
          this.registerSource(
            binding.registrationId,
            binding.conversationId,
            source.source_id,
            source.path,
            sessionId,
            incarnation,
            target
          )
        const refusal = result.refused.find((r) => r.path === path)
        retained = true
        if (refusal) return sourceRefusal(refusal.code)
        return {
          message: result.sources.some((s) => s.path === path) ? '' : t('debug.sourceUnavailable'),
        }
      } catch (error) {
        console.debug('[debugger] Source admission failed', error)
        this.admissions.delete(key)
        return { message: current() ? t('debug.sourceUnavailable') : '' }
      }
    })()
    this.admissions.set(key, attempt)
    void attempt.then(() => {
      if (!retained && this.admissions.get(key) === attempt) this.admissions.delete(key)
    })
    return attempt
  }
  readonly active = shallowRef<DebuggerBinding | null>(null)
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
      sources: peers
        .flatMap((peer) =>
          [...(this.sources.get(this.key(peer.registrationId, peer.conversationId)) ?? [])].filter(
            ([, source]) =>
              source.debugSessionId === (peer === binding ? sessionId : peer.sessionId)
          )
        )
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
  private uniqueSessions(sessions: DebuggerSnapshot[]) {
    const known = new Set([...this.bindings.values()].map((binding) => binding.sessionId))
    const score = (snapshot: DebuggerSnapshot) =>
      (snapshot.debug_session_id === this.active.value?.sessionId ? 100000 : 0) +
      (this.preferredSessions.has(snapshot.debug_session_id) ? 20000 : 0) +
      (known.has(snapshot.debug_session_id) ? 10000 : 0) +
      (snapshot.lifecycle === 'active' ? 1000 : 0) +
      (snapshot.selected_thread_id !== null ? 100 : 0) +
      snapshot.breakpoints.length
    const unique = new Map<string, DebuggerSnapshot>()
    for (const snapshot of sessions) {
      const target = snapshot.target,
        evidence = target.process_evidence
      // Older native adapters expose both their wrapper and driver session. Prefer process
      // evidence; their PID-bearing launch identity is the compatibility fallback.
      const nativePid = / · pid ([1-9]\d*)$/.exec(target.launch_configuration_id)?.[1]
      const pid = evidence?.pid ?? (nativePid ? Number(nativePid) : undefined)
      const key =
        (evidence || target.process_ownership === 'external') && pid
          ? JSON.stringify([
              target.node_id,
              target.project_id,
              target.workspace_id,
              target.worktree_id,
              pid,
            ])
          : snapshot.debug_session_id
      const previous = unique.get(key)
      if (!previous || score(snapshot) > score(previous)) unique.set(key, snapshot)
    }
    return [...unique.values()]
  }
  async discover(owner: DebugOwner) {
    if (!isFolderOwner(owner)) return
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
    for (const s of this.uniqueSessions([...known, ...sessions])) {
      const binding = this.binding(owner, s.debug_session_id)
      if (!binding.sessionId) await binding.open(s.debug_session_id)
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
    folder?: PathTarget
  ) {
    const key = this.key(registrationId, conversationId)
    const sources = this.sources.get(key) ?? new Map<string, SourceMapping>()
    const known = sources.get(sourceId)
    // A tab showing a file the program took leaves its mapping when it closes or moves on.
    if (
      known?.path === path &&
      known.debugSessionId === debugSessionId &&
      known.incarnation === incarnation
    ) {
      if (folder) known.folder = folder
      return () => {}
    }
    const mapping: SourceMapping = {
      path,
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
  debugFor(target: PathTarget | null | undefined, path: string) {
    if (!target) return undefined
    for (const [key, sources] of this.sources) {
      const [registrationId, conversationId] = JSON.parse(key) as [string, string]
      if (registrationId !== target.registrationId) continue
      const binding = this.forSource(registrationId, conversationId)
      if (binding !== this.folderBinding(target)) continue
      for (const [sourceId, m] of sources)
        if (
          m.path === path &&
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
  reveal(binding: DebuggerBinding, file: string, line: number) {
    console.debug('[debugger] Reveal source', file, line)
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
          closeNodePathDrawers(GlobalStore.getInstance().app.workspace, Platform.isMobile)
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
    for (const binding of this.bindings.values()) binding.destroy()
    this.bindings.clear()
    this.sources.clear()
    this.preferredSessions.clear()
    this.folders.clear()
    this.selectedFolders.clear()
    this.admissions.clear()
    this.revealers.clear()
    this.active.value = null
  }
}

export function sourceRefusal(code: string): SourceAdmission {
  if (code === 'debugger_source_no_map') return { message: t('debug.sourceMap') }
  if (code === 'debugger_source_changed') return { message: t('debug.sourceChanged') }
  if (code === 'debugger_source_outside_folder') return { message: t('debug.sourceOutside') }
  if (code === 'debugger_source_conflict') return { message: t('debug.sourceConflict') }
  if (code === 'debugger_source_limit') return { message: t('debug.sourceLimit') }
  if (code === 'debugger_source_unavailable') return { message: t('debug.sourceUnreadable') }
  return { message: t('debug.sourceUnavailable'), code }
}
