import { t } from '@/i18n'
import { z } from 'zod'
import {
  DebuggerActorSchema,
  DebuggerBreakpointRequestSchema,
  DebuggerControlMethodSchemas,
  DebuggerReceiptSchema,
  DebuggerSnapshotSchema,
  DebuggerHistoryResultSchema,
  DebuggerReplayResultSchema,
  DebuggerGrantSchema,
  type DebuggerSnapshot,
  type DebuggerBreakpointRequest,
} from '@abele/node-protocol'
import type { DebuggerObservationState } from '@abele/node-client'
import type { DebugAction, DebugSession, DebugVariable } from '@/components/debugger/types'
import { formatTimestamp } from '@/helpers/displayFormat'
import { pauseReason } from './pauseReason'
type DebuggerReceipt = ReturnType<typeof DebuggerReceiptSchema.parse>

const ProposalSchema = z
  .object({
    key: z.string(),
    principal_key: z.string(),
    actor: z.unknown().transform((raw) => DebuggerActorSchema.parse(raw)),
    method: z.string(),
    params: z.record(z.string(), z.unknown()),
    effective_breakpoints: z
      .array(z.unknown().transform((raw) => DebuggerBreakpointRequestSchema.parse(raw)))
      .optional(),
    receipt: z.unknown().transform((raw) => DebuggerReceiptSchema.parse(raw)),
  })
  .strict()
export const ApprovalPageSchema = z
  .object({
    proposals: z.array(ProposalSchema).max(128),
    truncated: z.boolean(),
    next: z.string().nullable(),
  })
  .strict()
type Proposal = z.infer<typeof ProposalSchema>
type Invocation = {
  snapshot: DebuggerSnapshot
  generation: number
  frameHandles: string[]
  frame: number
  grantId?: string
}
export interface DebuggerTransport {
  rpc(method: string, params: unknown): Promise<unknown>
  command(method: string, params: unknown): Promise<unknown>
  cancelPending?(): void
}
/** What a refused or uncertain command says in the panel: words for the codes a person can act
 * on, the code itself for the rest. */
export function receiptMessage(code: string): string {
  if (code === 'build_identity_unverified') return t('streamC.991cd1e53c5b4624')
  return code
}
export function breakpointMessage(message?: string | null): string | undefined {
  return message && /^(?:unbound breakpoint|breakpoint\.provisionalBreakpoint)$/i.test(message)
    ? t('debug.breakpointUnbound')
    : (message ?? undefined)
}
const empty = (): DebugSession => ({
  program: 'Debug',
  status: 'starting',
  frames: [],
  frame: 0,
  variables: [],
  breakpoints: [],
  watches: [],
  output: '',
  mode: 'unknown',
})

/** Shared-control presentation, independent of Obsidian and provider authority.
 * No command outbox or uncertain effect retry. Retained owner watch intents are renewed
 * only for paused frames. */
export class DebuggerController {
  session = empty()
  actions: DebugAction[] = []
  snapshot: DebuggerSnapshot | null = null
  error = ''
  grantId?: string
  modeUnavailableReason = 'This node does not expose a live-grant read API'
  private proposals = new Map<string, Proposal>()
  private sources = new Map<string, string>()
  private ownerTail: Promise<unknown> = Promise.resolve()
  private deciding = new Set<string>()
  private submitted = new Set<string>()
  private historyAfter = 0
  private outputAfter = 0
  private inspections = new Map<string, { expression?: string; handle?: string }>()
  private lost = false
  private serial = 0
  private disconnectTarget?: string
  private readonly pendingRequests = new Set<() => void>()
  get disconnectRequested() {
    return this.disconnectTarget !== undefined
  }
  resumeObservation() {
    this.disconnectTarget = undefined
  }
  private pendingRequest<T>(request: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancel = () => reject(new Error('Debugger request cancelled by disconnect'))
      this.pendingRequests.add(cancel)
      request.then(resolve, reject).finally(() => this.pendingRequests.delete(cancel))
    })
  }
  private frameHandles: string[] = []
  loadedStackEpoch?: number
  private watchesEpoch?: number
  private disabledBreakpoints = new Map<string, DebuggerBreakpointRequest>()
  exceptionFilters: string[] = []
  private breakpointCapabilities = { breakpoint_hit_condition: false, breakpoint_enabled: false }
  private frameSourcePaths = false
  private exitCodeSupported = false
  setCapabilities(capabilities: {
    breakpoint_hit_condition?: boolean
    breakpoint_enabled?: boolean
    frame_source_paths?: boolean
    exit_code?: boolean
  }) {
    this.frameSourcePaths = capabilities.frame_source_paths === true
    this.exitCodeSupported = capabilities.exit_code === true
    this.breakpointCapabilities = {
      breakpoint_hit_condition: capabilities.breakpoint_hit_condition === true,
      breakpoint_enabled: capabilities.breakpoint_enabled === true,
    }
    this.notify()
  }
  get supportsHitCondition() {
    return (
      this.breakpointCapabilities.breakpoint_hit_condition &&
      !!this.snapshot?.adapter_capabilities.includes('supportsHitConditionalBreakpoints')
    )
  }
  get supportsNativeEnabled() {
    return this.breakpointCapabilities.breakpoint_enabled
  }
  constructor(
    readonly transport: DebuggerTransport,
    private readonly changed: () => void
  ) {}
  private notify() {
    this.changed()
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.ownerTail.catch(() => {}).then(work)
    this.ownerTail = result
    return result
  }
  registerSource(sourceId: string, path: string) {
    const previous = this.sources.get(sourceId)
    this.sources.set(sourceId, path)
    for (const frame of this.session.frames)
      if (frame.file === sourceId || frame.file === previous) frame.file = path
    for (const b of this.session.breakpoints)
      if (b.file === sourceId || b.file === previous) b.file = path
    this.notify()
  }
  clearGrant(reason: string) {
    this.grantId = undefined
    this.session.mode = 'unknown'
    this.modeUnavailableReason = reason
    this.notify()
  }
  bindGrant(raw: unknown) {
    const g = DebuggerGrantSchema.parse(raw),
      s = this.snapshot
    if (
      !s ||
      g.debug_session_id !== s.debug_session_id ||
      g.incarnation !== s.incarnation ||
      g.target_id !== s.target.target_id ||
      g.conversation_id !== s.target.conversation_id ||
      g.revoked ||
      Date.parse(g.expires_at) <= Date.now()
    )
      throw new Error('The agent grant is not live for this session')
    this.grantId = g.grant_id
    this.modeUnavailableReason = ''
    this.session.mode = g.mode === 'allow-all' ? 'allow' : 'ask'
    this.notify()
  }
  path(sourceId: string) {
    return this.sources.get(sourceId)
  }
  mappedSource(file: string) {
    return [...this.sources].find(([id, path]) => id === file || path === file)
  }
  private location() {
    const s = this.snapshot
    return s?.threads.find((t) => t.thread_id === s.selected_thread_id)?.stop?.location
  }
  observe(observation: DebuggerObservationState) {
    if (!observation.snapshot || observation.observation !== 'current') {
      console.debug(
        '[debugger] Observation unavailable',
        observation.observation,
        observation.reason
      )
      this.disconnected()
      return
    }
    const s = DebuggerSnapshotSchema.parse(observation.snapshot)
    if (this.disconnectTarget === JSON.stringify([s.debug_session_id, s.incarnation])) return
    this.disconnectTarget = undefined
    if (
      this.snapshot?.debug_session_id === s.debug_session_id &&
      (s.event_seq < this.snapshot.event_seq ||
        (s.incarnation === this.snapshot.incarnation &&
          s.state_revision < this.snapshot.state_revision))
    )
      return
    const replaced =
      !this.snapshot ||
      s.debug_session_id !== this.snapshot.debug_session_id ||
      s.incarnation !== this.snapshot.incarnation
    const moved = this.snapshot && (replaced || this.snapshot.stop_epoch !== s.stop_epoch)
    if (replaced) {
      this.loadedStackEpoch = undefined
      this.watchesEpoch = undefined
      const restoredWatches = this.snapshot ? [] : this.session.watches
      ++this.serial
      this.markSubmittedUnknown('Target replaced; approval outcome unknown')
      this.session = empty()
      this.session.watches = restoredWatches
      this.grantId = undefined
      this.modeUnavailableReason = 'A live agent grant must be loaded for this target'
      this.frameHandles = []
      this.historyAfter = 0
      this.outputAfter = 0
      this.sources.clear()
      this.inspections.clear()
      this.disabledBreakpoints.clear()
      this.exceptionFilters = []
    }
    if (moved) {
      this.loadedStackEpoch = undefined
      this.expireLocal()
      this.session.watches = this.session.watches.map((watch) => ({ ...watch, stale: true }))
      this.session.frames = []
      this.session.variables = []
      this.frameHandles = []
    }
    this.snapshot = s
    // Current node state wins, including another window enabling the same point.
    for (const b of s.breakpoints) this.disabledBreakpoints.delete(b.breakpoint_id)
    this.lost = s.lifecycle === 'connection-lost'
    this.session.status = this.lost
      ? 'lost'
      : ['terminated', 'detached', 'failed'].includes(s.lifecycle)
        ? 'exited'
        : s.execution === 'stopped'
          ? 'paused'
          : s.execution === 'running' ||
              (s.lifecycle === 'active' &&
                s.execution === 'unknown' &&
                s.target.process_ownership === 'external' &&
                !s.threads.some((thread) => thread.status === 'stopped'))
            ? 'running'
            : 'starting'
    this.session.program = s.target.launch_configuration_id
    this.session.attached = s.target.process_ownership === 'external'
    this.session.detached = s.lifecycle === 'detached'
    this.session.seen = formatTimestamp(s.observed_at, { diagnostic: true }).label
    const stop = s.threads.find((t) => t.thread_id === s.selected_thread_id)?.stop
    this.session.reason =
      stop?.reason === 'entry' ? 'entry' : pauseReason(stop?.description ?? stop?.reason)
    this.session.breakpoints = this.knownBreakpoints()
    if (!this.session.frames.length && stop?.location)
      this.session.frames = [
        {
          name: s.threads.find((t) => t.thread_id === s.selected_thread_id)?.name ?? '',
          file: this.sources.get(stop.location.source_id) ?? stop.location.source_id,
          line: stop.location.line,
        },
      ]
    if (this.lost) this.expireLocal()
    this.notify()
  }
  disconnected() {
    this.loadedStackEpoch = undefined
    this.watchesEpoch = undefined
    ++this.serial
    this.lost = true
    this.session.status = ['terminated', 'detached', 'failed'].includes(
      this.snapshot?.lifecycle ?? ''
    )
      ? 'exited'
      : 'lost'
    this.expireLocal()
    this.markSubmittedUnknown('Outcome unknown; no action will be replayed')
    this.notify()
  }
  get current() {
    return !!this.snapshot && !this.lost && !this.disconnectRequested
  }
  private invocation(): Invocation {
    if (!this.current || !this.snapshot) throw new Error('A fresh debugger snapshot is required')
    return {
      snapshot: this.snapshot,
      generation: this.serial,
      frameHandles: this.frameHandles.slice(),
      frame: this.session.frame,
      grantId: this.grantId,
    }
  }
  private matches(invocation: Invocation) {
    return (
      this.current &&
      invocation.generation === this.serial &&
      invocation.snapshot.debug_session_id === this.snapshot?.debug_session_id &&
      invocation.snapshot.incarnation === this.snapshot?.incarnation
    )
  }
  private precondition(invocation = this.invocation()) {
    const s = invocation.snapshot
    return {
      debug_session_id: s.debug_session_id,
      incarnation: s.incarnation,
      expected_state_revision: s.state_revision,
    }
  }
  private markSubmittedUnknown(reason: string) {
    for (const a of this.actions)
      if (a.status === 'asked' && a.awaitingResult) {
        a.status = 'unknown'
        a.awaitingResult = false
        a.result = reason
      }
  }
  private applyReceipt(
    action: DebugAction,
    receipt: ReturnType<typeof DebuggerReceiptSchema.parse>,
    deny: boolean
  ) {
    action.awaitingResult = receipt.outcome === 'pending'
    if (receipt.outcome === 'completed') {
      action.status = 'done'
      action.result = undefined
    } else if (receipt.outcome === 'pending') action.status = 'asked'
    else if (
      deny &&
      receipt.outcome === 'rejected' &&
      receipt.dispatch === 'not_dispatched' &&
      ['denied', 'approval_denied'].includes(receipt.code ?? '')
    ) {
      action.status = 'denied'
      action.result = t('streamC.176a60da255fb23b')
    } else if (receipt.dispatch !== 'not_dispatched' || receipt.outcome === 'outcome_unknown') {
      action.status = 'unknown'
      action.result = t('streamC.de044a672af115e3', { v1: String(receipt.code ?? receipt.outcome) })
    } else {
      action.status = 'expired'
      action.result = receipt.code ?? receipt.outcome
    }
  }
  private expireLocal() {
    for (const a of this.actions)
      if (a.status === 'asked' && !a.awaitingResult) a.status = 'expired'
  }
  private async expireRemote(proposals: Proposal[], invocation: Invocation) {
    for (const p of proposals) {
      if (!this.matches(invocation)) return
      const hash = p.receipt.proposal_hash
      if (!hash) throw new Error('Missing exact proposal hash')
      const receipt = DebuggerReceiptSchema.parse(
        await this.rpc('approve', {
          principal_key: p.principal_key,
          operation_id: p.receipt.operation_id,
          proposal_hash: hash,
          decision: 'deny',
        })
      )
      if (!this.matches(invocation)) return
      if (
        receipt.outcome === 'pending' ||
        receipt.outcome === 'outcome_unknown' ||
        receipt.dispatch === 'possible'
      )
        throw new Error('Debugger proposal retirement is not confirmed')
      if (receipt.outcome === 'completed') {
        const action = this.actions.find((a) => this.proposals.get(a.id)?.key === p.key)
        if (action) {
          action.status = 'done'
          action.result = 'Agent action completed; retirement was not confirmed'
          this.notify()
        }
        throw new Error(
          'Debugger proposal retirement was not confirmed; a fresh observation is required'
        )
      }
    }
  }
  /** Expire synchronously: even a click arriving before the RPC settles cannot run an old ask.
   * Retire exact node proposals before mode switches or mutations, not just their cards. */
  private human<T>(work: (invocation: Invocation) => Promise<T>): Promise<T | undefined> {
    if (!this.current) return Promise.resolve(undefined)
    const invocation = this.invocation()
    const pending = this.actions
      .filter((a) => a.status === 'asked' && !a.awaitingResult)
      .map((a) => this.proposals.get(a.id))
      .filter((p): p is Proposal => !!p)
    this.expireLocal()
    // Submitted approval is not a cancellable ask. Do not wait behind its RPC or claim no execution.
    this.markSubmittedUnknown('Owner move requested; approved action retirement needs a node fence')
    this.notify()
    return this.enqueue(async () => {
      if (!this.matches(invocation)) return undefined
      try {
        const fresh = await this.refreshApprovals()
        this.expireLocal()
        this.notify()
        if (!this.matches(invocation)) return undefined
        await this.expireRemote(
          [
            ...new Map(
              [...pending, ...fresh]
                .filter(
                  (p) =>
                    !this.submitted.has(JSON.stringify([p.principal_key, p.receipt.operation_id]))
                )
                .map((p) => [p.key, p])
            ).values(),
          ],
          invocation
        )
        if (!this.matches(invocation)) return undefined
        return await work(invocation)
      } catch (e) {
        if (!this.matches(invocation)) return undefined
        this.error = e instanceof Error ? e.message : t('streamC.6fd9013400843e8c')
        this.disconnected()
        throw e
      }
    })
  }
  async rpc(method: string, params: unknown) {
    const schema =
      DebuggerControlMethodSchemas[
        `debugger.v1.${method}` as keyof typeof DebuggerControlMethodSchemas
      ]
    if (!schema) throw new Error('Unsupported debugger operation')
    return this.pendingRequest(this.transport.rpc(`debugger.v1.${method}`, schema.parse(params)))
  }
  addProposal(raw: unknown) {
    const p = ProposalSchema.parse(raw)
    // A click is the owner's approval. Only agent requests belong in approval cards.
    if (p.actor.kind !== 'agent') return
    const schema =
      DebuggerControlMethodSchemas[
        `debugger.v1.${p.method}` as keyof typeof DebuggerControlMethodSchemas
      ]
    if (!schema || !p.receipt.proposal_hash) throw new Error('Invalid debugger proposal')
    schema.parse(p.params)
    if (p.receipt.snapshot.debug_session_id !== this.snapshot?.debug_session_id)
      throw new Error('Debugger proposal session mismatch')
    const id = JSON.stringify([p.principal_key, p.receipt.operation_id])
    this.proposals.set(id, p)
    const existing = this.actions.find((a) => a.id === id)
    if (existing) return
    const stale =
      !this.current ||
      p.params.incarnation !== this.snapshot?.incarnation ||
      p.params.expected_state_revision !== this.snapshot?.state_revision
    this.actions.push({
      id,
      timestamp: Date.parse(p.receipt.completed_at),
      kind:
        p.method === 'step'
          ? `step-${p.params.kind === 'over' ? 'over' : p.params.kind === 'in' ? 'into' : 'out'}`
          : ({ setVariable: 'set', 'breakpoints.patch': 'breakpoint', terminate: 'stop' }[
              p.method
            ] ?? p.method),
      detail:
        typeof p.params.expression === 'string'
          ? p.params.expression
          : p.method === 'setVariable' &&
              typeof p.params.name === 'string' &&
              typeof p.params.value === 'string'
            ? `${p.params.name} = ${p.params.value}`
            : undefined,
      // Exact normalized arguments and complete breakpoint intent remain available in the card.
      exact: JSON.stringify({
        params: p.params,
        ...(p.effective_breakpoints ? { effective_breakpoints: p.effective_breakpoints } : {}),
      }),
      at: this.location()
        ? `${this.path(this.location().source_id) ?? this.location().source_id}:${this.location().line}`
        : '',
      status: stale ? 'expired' : 'asked',
    })
    this.notify()
  }
  async refreshApprovals(current: () => boolean = () => this.current): Promise<Proposal[]> {
    if (!current() || !this.snapshot) return []
    const generation = this.serial,
      sessionId = this.snapshot.debug_session_id
    const proposals: Proposal[] = []
    let after = ''
    do {
      const page = ApprovalPageSchema.parse(
        await this.rpc('approvals', { debug_session_id: sessionId, after })
      )
      if (!current() || generation !== this.serial) return []
      for (const p of page.proposals) {
        this.addProposal(p)
        proposals.push(p)
      }
      if (!page.truncated) break
      if (!page.next || page.next === after)
        throw new Error('Debugger approval cursor did not advance')
      if (proposals.length >= 128) throw new Error('Too many pending debugger proposals')
      after = page.next
    } while (after !== '')
    return proposals
  }
  private async ownerCommand(
    method: string,
    params: Record<string, unknown>,
    current: () => boolean = () => this.current
  ) {
    const generation = this.serial
    const result = DebuggerReceiptSchema.parse(
      await this.pendingRequest(this.transport.command(method, params))
    )
    if (result.outcome !== 'pending' || !current() || generation !== this.serial) return result
    const proposals = await this.refreshApprovals(current)
    if (!current() || generation !== this.serial) return result
    const own = proposals.find(
      (p) =>
        p.actor.kind === 'human' &&
        p.method === method &&
        p.receipt.operation_id === params.operation_id &&
        p.params.operation_id === params.operation_id &&
        p.params.debug_session_id === params.debug_session_id &&
        p.params.incarnation === params.incarnation &&
        p.receipt.proposal_hash === result.proposal_hash
    )
    if (!own?.receipt.proposal_hash) throw new Error(t('node.error.generic'))
    console.debug('[debugger] Approving owner control', method)
    return DebuggerReceiptSchema.parse(
      await this.rpc('approve', {
        principal_key: own.principal_key,
        operation_id: own.receipt.operation_id,
        proposal_hash: own.receipt.proposal_hash,
        decision: 'approve',
      })
    )
  }
  async decide(id: string, allow: boolean) {
    const a = this.actions.find((a) => a.id === id),
      p = this.proposals.get(id)
    if (
      !this.current ||
      !a ||
      a.status !== 'asked' ||
      a.awaitingResult ||
      !p?.receipt.proposal_hash ||
      this.deciding.has(id)
    )
      return
    const invocation = this.invocation()
    this.deciding.add(id)
    try {
      await (async () => {
        if (!this.matches(invocation) || a.status !== 'asked') return
        a.awaitingResult = true
        this.submitted.add(id)
        this.notify()
        const result = DebuggerReceiptSchema.parse(
          await this.rpc('approve', {
            principal_key: p.principal_key,
            operation_id: p.receipt.operation_id,
            proposal_hash: p.receipt.proposal_hash,
            decision: allow ? 'approve' : 'deny',
          })
        )
        if (!this.matches(invocation)) return
        this.applyReceipt(a, result, !allow)
        this.observe({ observation: 'current', snapshot: result.snapshot })
        this.notify()
      })()
    } catch (e) {
      if (!this.matches(invocation)) return
      this.disconnected()
      throw e
    } finally {
      this.deciding.delete(id)
    }
  }
  private async disconnect(method: 'detach' | 'terminate') {
    const invocation = this.invocation()
    this.disconnectTarget = JSON.stringify([
      invocation.snapshot.debug_session_id,
      invocation.snapshot.incarnation,
    ])
    this.disconnected()
    const generation = this.serial
    const current = () => generation === this.serial && this.disconnectRequested
    this.session.status = 'exited'
    this.session.detached = method === 'detach'
    this.error = ''
    for (const cancel of this.pendingRequests) cancel()
    this.pendingRequests.clear()
    this.transport.cancelPending?.()
    this.notify()
    console.debug('[debugger] Disconnect requested', method, invocation.snapshot.debug_session_id)
    try {
      // The node fences prior work when this control arrives. Do not queue it behind the work
      // it is meant to stop, or wait for proposal retirement before dispatching it.
      let result = await this.ownerCommand(
        method,
        {
          ...this.precondition(invocation),
          operation_id: crypto.randomUUID(),
        },
        current
      )
      // Recording can advance the state fence while disconnect is in flight. Only a
      // confirmed non-dispatch may be rebased, once, against the same live target.
      const fresh = result.snapshot
      const original = invocation.snapshot
      if (
        current() &&
        result.outcome === 'rejected' &&
        result.dispatch === 'not_dispatched' &&
        result.code === 'stale_state' &&
        fresh.debug_session_id === original.debug_session_id &&
        fresh.incarnation === original.incarnation &&
        fresh.target.target_id === original.target.target_id &&
        fresh.state_revision > original.state_revision &&
        fresh.lifecycle === 'active'
      ) {
        result = await this.ownerCommand(
          method,
          {
            ...this.precondition({ ...invocation, snapshot: fresh }),
            operation_id: crypto.randomUUID(),
          },
          current
        )
      }
      if (!current()) return
      if (
        result.snapshot.debug_session_id !== invocation.snapshot.debug_session_id ||
        result.snapshot.incarnation !== invocation.snapshot.incarnation
      )
        throw new Error(t('node.error.generic'))
      this.snapshot = result.snapshot
      if (result.outcome !== 'completed') {
        this.session.status = 'lost'
        this.session.detached = false
        this.error = receiptMessage(result.code ?? result.outcome)
      }
      this.notify()
    } catch (error) {
      if (!current()) return
      this.session.status = 'lost'
      this.session.detached = false
      this.error = error instanceof Error ? error.message : t('node.error.generic')
      this.notify()
      throw error
    }
  }
  command(action: string) {
    const paused = this.session.status === 'paused'
    if (
      !this.current ||
      action === 'restart' ||
      (['continue', 'step-over', 'step-into', 'step-out'].includes(action) && !paused) ||
      (action === 'pause' && this.session.status !== 'running')
    )
      return Promise.resolve()
    if (action === 'stop' || action === 'detach' || action === 'terminate')
      return this.disconnect(
        action === 'detach' || this.snapshot?.target.process_ownership !== 'owned'
          ? 'detach'
          : 'terminate'
      )
    return this.human(async (invocation) => {
      const s = invocation.snapshot,
        thread = s.selected_thread_id ?? s.threads.find((t) => t.status === 'stopped')?.thread_id
      const method = action.startsWith('step-') ? 'step' : action
      const params = {
        ...this.precondition(invocation),
        operation_id: crypto.randomUUID(),
        ...(method === 'step'
          ? {
              thread_id: thread,
              kind: action === 'step-over' ? 'over' : action === 'step-into' ? 'in' : 'out',
            }
          : {}),
      }
      const generation = this.serial
      const result = DebuggerReceiptSchema.parse(await this.ownerCommand(method, params))
      if (!this.current || generation !== this.serial) return
      this.observe({ observation: 'current', snapshot: result.snapshot })
      if (result.outcome !== 'completed') this.error = receiptMessage(result.code ?? result.outcome)
      this.notify()
      return result
    })
  }
  setMode(mode: 'ask' | 'allow') {
    if (!this.grantId) {
      this.error = t('streamC.52b7148b81772c48')
      this.notify()
      return Promise.resolve()
    }
    return this.human(async (invocation) => {
      const generation = this.serial
      const result = await this.rpc('grant.setMode', {
        grant_id: invocation.grantId,
        mode: mode === 'allow' ? 'allow-all' : 'ask',
      })
      if (!this.current || generation !== this.serial) return
      // Never change the owner policy/default: this switch belongs to one live grant.
      const grant = DebuggerGrantSchema.parse(result)
      if (grant.grant_id !== invocation.grantId || grant.grant_id !== this.grantId)
        throw new Error('Debugger grant identity changed')
      this.bindGrant(grant)
    })
  }
  toggleBreakpoint(sourceId: string, line: number) {
    const disabled = [...this.disabledBreakpoints.values()].find(
      (b) => b.source_id === sourceId && b.line === line
    )
    if (disabled) return this.removeBreakpoint(disabled.breakpoint_id)
    return this.patchBreakpoints((s) => {
      const existing = s.breakpoints.filter(
        (b) => b.source_id === sourceId && (b.resolved_line ?? b.line) === line
      )
      return existing.length
        ? { upsert: [], remove: existing.map((b) => b.breakpoint_id) }
        : {
            upsert: [{ breakpoint_id: crypto.randomUUID(), source_id: sourceId, line }],
            remove: [],
          }
    })
  }
  /** A breakpoint by the identity a record point shares with it; a condition goes to the owner's
   * approval as any conditional breakpoint does. */
  setBreakpoint(
    breakpointId: string,
    sourceId: string,
    line: number,
    condition?: string,
    options?: { log_message?: string; enabled?: boolean; hit_condition?: string }
  ) {
    if (options?.hit_condition && !this.supportsHitCondition)
      return Promise.reject(new Error(t('debug.hitCountUnavailable')))
    if (options?.enabled === false && !this.breakpointCapabilities.breakpoint_enabled)
      return this.human(async () => {
        this.disabledBreakpoints.set(breakpointId, {
          breakpoint_id: breakpointId,
          source_id: sourceId,
          line,
          ...(condition ? { condition } : {}),
          ...(options.log_message ? { log_message: options.log_message } : {}),
          ...(options.hit_condition ? { hit_condition: options.hit_condition } : {}),
        })
        this.session.breakpoints = this.knownBreakpoints()
        this.notify()
      })
    return this.patchBreakpoints(() => ({
      upsert: [
        {
          breakpoint_id: breakpointId,
          source_id: sourceId,
          line,
          ...(condition ? { condition } : {}),
          ...(options?.log_message ? { log_message: options.log_message } : {}),
          ...(options?.hit_condition ? { hit_condition: options.hit_condition } : {}),
          ...(this.breakpointCapabilities.breakpoint_enabled && options?.enabled !== undefined
            ? { enabled: options.enabled }
            : {}),
        },
      ],
      remove: [],
    }))
  }
  removeBreakpoint(breakpointId: string) {
    if (this.disabledBreakpoints.has(breakpointId))
      return this.human(async () => {
        this.disabledBreakpoints.delete(breakpointId)
        this.session.breakpoints = this.knownBreakpoints()
        this.notify()
      })
    return this.patchBreakpoints(() => ({ upsert: [], remove: [breakpointId] }))
  }
  editBreakpoint(
    id: string,
    edit: { condition?: string; log_message?: string; hit_condition?: string }
  ) {
    if (edit.hit_condition !== undefined && !this.supportsHitCondition)
      return Promise.reject(new Error(t('debug.hitCountUnavailable')))
    return this.patchBreakpoints((s) => {
      const b = s.breakpoints.find((b) => b.breakpoint_id === id)
      if (!b) throw new Error('Breakpoint is unavailable')
      const request = { ...this.breakpointRequest(b), ...edit }
      for (const key of ['condition', 'log_message', 'hit_condition'] as const)
        if (!request[key]) delete request[key]
      return { upsert: [request], remove: [] }
    })
  }
  private breakpointRequest(b: DebuggerBreakpointRequest): DebuggerBreakpointRequest {
    return {
      breakpoint_id: b.breakpoint_id,
      source_id: b.source_id,
      line: b.line,
      ...(b.column !== undefined ? { column: b.column } : {}),
      ...(b.condition ? { condition: b.condition } : {}),
      ...(b.log_message ? { log_message: b.log_message } : {}),
      ...(this.breakpointCapabilities.breakpoint_hit_condition && b.hit_condition
        ? { hit_condition: b.hit_condition }
        : {}),
      ...(this.breakpointCapabilities.breakpoint_enabled && b.enabled !== undefined
        ? { enabled: b.enabled }
        : {}),
    }
  }
  async setBreakpointEnabled(id: string, enabled: boolean) {
    if (this.breakpointCapabilities.breakpoint_enabled) {
      const result = await this.patchBreakpoints((s) => {
        const point =
          s.breakpoints.find((b) => b.breakpoint_id === id) ?? this.disabledBreakpoints.get(id)
        if (!point) throw new Error('Breakpoint is unavailable')
        return { upsert: [{ ...this.breakpointRequest(point), enabled }], remove: [] }
      })
      if (result?.outcome === 'completed') this.disabledBreakpoints.delete(id)
      return result
    }
    const b = enabled
      ? this.disabledBreakpoints.get(id)
      : this.snapshot?.breakpoints.find((b) => b.breakpoint_id === id)
    if (!b) return
    const request = this.breakpointRequest(b)
    const result = await this.patchBreakpoints(() =>
      enabled ? { upsert: [request], remove: [] } : { upsert: [], remove: [id] }
    )
    if (!result) return
    if (result.outcome !== 'completed') return
    if (enabled) this.disabledBreakpoints.delete(id)
    else this.disabledBreakpoints.set(id, request)
    this.session.breakpoints = this.knownBreakpoints()
    this.notify()
  }
  async removeAllBreakpoints() {
    const result = await this.patchBreakpoints((s) => ({
      upsert: [],
      remove: s.breakpoints.map((b) => b.breakpoint_id),
    }))
    if (result?.outcome === 'completed') {
      this.disabledBreakpoints.clear()
      this.session.breakpoints = this.knownBreakpoints()
      this.notify()
    }
  }
  setExceptionFilters(filters: string[]) {
    return this.human(async (invocation) => {
      const result = DebuggerReceiptSchema.parse(
        await this.ownerCommand('exceptionBreakpoints.set', {
          ...this.precondition(invocation),
          operation_id: crypto.randomUUID(),
          // js-debug names its caught-exception filter "all".
          filters: filters.map((filter) => (filter === 'caught' ? 'all' : filter)),
        })
      )
      if (!this.matches(invocation)) return
      this.observe({ observation: 'current', snapshot: result.snapshot })
      if (result.outcome === 'completed') this.exceptionFilters = filters.slice()
      else this.error = receiptMessage(result.code ?? result.outcome)
      this.notify()
    })
  }
  /** The breakpoints with the identities and conditions the node holds for them. */
  knownBreakpoints() {
    return [
      ...(this.snapshot?.breakpoints ?? []).filter(
        (b) => !this.disabledBreakpoints.has(b.breakpoint_id)
      ),
      ...this.disabledBreakpoints.values(),
    ].map((b) => ({
      file: this.path(b.source_id) ?? b.source_id,
      line: 'resolved_line' in b ? ((b.resolved_line as number | null) ?? b.line) : b.line,
      state:
        this.disabledBreakpoints.has(b.breakpoint_id) || b.enabled === false
          ? ('disabled' as const)
          : 'status' in b && (b.status === 'verified' || b.status === 'relocated')
            ? ('set' as const)
            : 'status' in b && b.status === 'rejected'
              ? ('rejected' as const)
              : ('pending' as const),
      reason: breakpointMessage(
        'message' in b && typeof b.message === 'string' ? b.message : undefined
      ),
      enabled: !this.disabledBreakpoints.has(b.breakpoint_id) && b.enabled !== false,
      id: b.breakpoint_id,
      sourceId: b.source_id,
      requestedLine: b.line,
      ...(b.condition ? { condition: b.condition } : {}),
      ...(b.log_message ? { log_message: b.log_message } : {}),
      ...(b.hit_condition ? { hit_condition: b.hit_condition } : {}),
      ...(b.log_message ? { kind: 'log' as const, logMessage: b.log_message } : {}),
    }))
  }
  private patchBreakpoints(
    change: (s: DebuggerSnapshot) => {
      upsert: DebuggerBreakpointRequest[]
      remove: string[]
    },
    allowRebase = true
  ): Promise<DebuggerReceipt | undefined> {
    return this.human(async () => {
      // Earlier queued clicks may have confirmed a new set while this click waited.
      const invocation = this.invocation()
      const s = invocation.snapshot
      const generation = this.serial
      const patch = change(s)
      const result = DebuggerReceiptSchema.parse(
        await this.ownerCommand('breakpoints.patch', {
          ...this.precondition(invocation),
          operation_id: crypto.randomUUID(),
          expected_breakpoint_revision: s.breakpoint_revision,
          ...patch,
        })
      )
      if (!this.current || generation !== this.serial) return
      const rebase =
        allowRebase &&
        result.outcome === 'rejected' &&
        result.dispatch === 'not_dispatched' &&
        result.code === 'stale_state' &&
        result.snapshot.debug_session_id === s.debug_session_id &&
        result.snapshot.incarnation === s.incarnation &&
        result.snapshot.target.target_id === s.target.target_id &&
        result.snapshot.breakpoint_revision === s.breakpoint_revision &&
        result.snapshot.state_revision > s.state_revision
      this.observe({ observation: 'current', snapshot: result.snapshot })
      if (rebase)
        return {
          rebase: {
            patch,
            sessionId: s.debug_session_id,
            incarnation: s.incarnation,
            targetId: s.target.target_id,
            breakpointRevision: s.breakpoint_revision,
          },
        }
      if (result.outcome === 'pending') {
        this.error = ''
        await this.refreshApprovals()
      } else if (result.outcome !== 'completed')
        this.error = receiptMessage(result.code ?? result.outcome)
      this.notify()
      return { result }
    }).then((outcome): Promise<DebuggerReceipt | undefined> | DebuggerReceipt | undefined => {
      if (!outcome) return undefined
      if ('result' in outcome) return outcome.result
      const rebase = outcome.rebase
      const current = this.snapshot
      if (
        !this.current ||
        !current ||
        current.debug_session_id !== rebase.sessionId ||
        current.incarnation !== rebase.incarnation ||
        current.target.target_id !== rebase.targetId ||
        current.breakpoint_revision !== rebase.breakpointRevision
      )
        return undefined
      // A rejected, non-dispatched patch had no effect. Keep its exact intent, retire fresh
      // proposals again, and rebase only its state fence once; never retry uncertain effects.
      return this.patchBreakpoints(() => rebase.patch, false)
    })
  }
  async refreshHistory() {
    if (!this.current || !this.snapshot) return
    const generation = this.serial
    const page = DebuggerHistoryResultSchema.parse(
      await this.rpc('history', {
        debug_session_id: this.snapshot.debug_session_id,
        after: this.historyAfter,
      })
    )
    if (!this.current || generation !== this.serial) return
    for (const entry of page.entries) {
      this.historyAfter = Math.max(this.historyAfter, entry.history_seq)
      const data = entry.requested_data as Record<string, unknown> | undefined
      if (entry.actor.kind === 'agent' && entry.operation_id) {
        const actorKey = JSON.stringify(entry.actor),
          historyId = JSON.stringify(['history', entry.actor, entry.operation_id])
        let a = this.actions.find((a) => {
          const proposal = this.proposals.get(a.id)
          return (
            (proposal?.receipt.operation_id === entry.operation_id &&
              JSON.stringify(proposal.actor) === actorKey) ||
            a.id === historyId
          )
        })
        if (!a) {
          a = {
            id: historyId,
            awaitingResult: true,
            timestamp: Date.parse(entry.observed_at),
            kind: entry.operation,
            at: '',
            status: 'asked',
          }
          this.actions.push(a)
        }
        if (
          ['completed', 'denied', 'rejected', 'outcome_unknown', 'failed'].includes(entry.outcome)
        )
          a.awaitingResult = false
        if (entry.outcome === 'completed') a.status = 'done'
        if (entry.outcome === 'denied') a.status = 'denied'
        if (
          entry.outcome === 'rejected' ||
          entry.outcome === 'outcome_unknown' ||
          entry.outcome === 'failed'
        ) {
          a.status =
            entry.outcome === 'outcome_unknown' || a.status === 'unknown' ? 'unknown' : 'expired'
          const detail =
            typeof data?.code === 'string' ? data.code : entry.outcome.replaceAll('_', ' ')
          a.result =
            a.status === 'unknown' ? t('streamC.90e0c7eafb4fa1a1', { v1: String(detail) }) : detail
        }
        if (entry.outcome === 'completed' && entry.payload_status === 'expired')
          a.result = t('streamC.293e117d569d3395')
        if (entry.outcome === 'proposed' && entry.stop?.location)
          a.at = `${this.path(entry.stop.location.source_id) ?? entry.stop.location.source_id}:${entry.stop.location.line}`
        if (data) {
          if (entry.outcome === 'proposed') a.exact = JSON.stringify(data)
          else if (entry.outcome === 'completed') a.result = JSON.stringify(data)
        }
      }
      const inspection = entry.operation_id ? this.inspections.get(entry.operation_id) : undefined
      if (
        inspection?.expression &&
        ['failed', 'rejected', 'timed_out', 'outcome_unknown'].includes(entry.outcome)
      ) {
        const watch = this.session.watches.find((w) => w.expression === inspection.expression)
        if (watch) {
          watch.error = receiptMessage(typeof data?.code === 'string' ? data.code : entry.outcome)
          watch.stale =
            this.session.status !== 'paused' || entry.stop_epoch !== this.snapshot?.stop_epoch
        }
        this.inspections.delete(entry.operation_id)
      }
      if (inspection && entry.outcome === 'completed' && data) {
        if (inspection.expression) {
          const watch = this.session.watches.find((w) => w.expression === inspection.expression)
          if (watch) {
            watch.error = undefined
            watch.value = typeof data.value === 'string' ? data.value : JSON.stringify(data)
            watch.stale =
              this.session.status !== 'paused' ||
              (data.observation_stop_epoch ?? entry.stop_epoch) !== this.snapshot?.stop_epoch
          }
        } else if (inspection.handle && Array.isArray(data.items)) {
          const page = z
            .array(
              z.object({
                name: z.string(),
                value: z.string(),
                handle: z.string().nullish(),
              })
            )
            .parse(data.items)
          const children = page.map((v) => ({
            ...v,
            handle: v.handle ?? undefined,
            type: t('streamC.b80a82ba3f216c8d', {
              v1: formatTimestamp(entry.observed_at, { diagnostic: true }).label,
            }),
          }))
          this.updateVariable(inspection.handle, (value) => ({
            ...value,
            children,
            handle: undefined,
            value: t('streamC.bde728921e9f7497', { v1: String(children.length) }),
          }))
        }
        this.inspections.delete(entry.operation_id)
      }
    }
    this.notify()
  }
  async refreshOutput() {
    if (!this.current || !this.snapshot) return
    const s = this.snapshot,
      generation = this.serial
    const page = DebuggerReplayResultSchema.parse(
      await this.rpc('replay', {
        cursor: {
          debug_session_id: s.debug_session_id,
          incarnation: s.incarnation,
          event_seq: this.outputAfter,
        },
      })
    )
    if (!this.current || generation !== this.serial) return
    if (page.kind === 'fresh_snapshot_required') {
      if (this.outputAfter > 0)
        this.session.output = `${this.session.output}\n${t('streamC.77d9d5f541c31209')}\n`.slice(
          -65536
        )
      this.outputAfter = page.cursor.event_seq
      this.observe({ observation: 'current', snapshot: page.snapshot })
    } else {
      for (const e of page.events) {
        if (e.event_seq <= this.outputAfter) continue
        if (e.kind === 'output') {
          const data = z
            .object({ text: z.string(), category: z.string().optional() })
            .loose()
            .parse(e.data)
          // DAP telemetry describes adapter operations, not the program's console.
          if (data.category !== 'telemetry')
            this.session.output = (this.session.output + data.text).slice(-65536)
        }
        this.outputAfter = e.event_seq
      }
    }
    this.notify()
  }
  /** Plain controller data crosses Vue props by identity, including every nested branch. */
  private updateVariable(handle: string, update: (value: DebugVariable) => DebugVariable) {
    const visit = (values: DebugVariable[]): DebugVariable[] =>
      values.map((value) =>
        value.handle === handle
          ? update(value)
          : value.children
            ? { ...value, children: visit(value.children) }
            : value
      )
    this.session.variables = visit(this.session.variables)
  }
  inspect(handle: string) {
    return this.human(async (invocation) => {
      const operation_id = crypto.randomUUID(),
        generation = this.serial
      this.inspections.set(operation_id, { handle })
      const result = DebuggerReceiptSchema.parse(
        await this.ownerCommand('variables', {
          ...this.precondition(invocation),
          operation_id,
          handle,
          start: 0,
          count: 50,
          // Retain handles for the next explicit expansion; the node does not recurse.
          depth: 1,
          max_bytes: 8192,
        })
      )
      if (!this.current || generation !== this.serial) return
      this.observe({ observation: 'current', snapshot: result.snapshot })
      this.updateVariable(handle, (value) => ({
        ...value,
        value:
          result.outcome === 'pending'
            ? t('node.error.unknownOutcome')
            : result.outcome === 'completed'
              ? t('streamC.ce9dc7a8bc7d98f2')
              : receiptMessage(result.code ?? result.outcome),
      }))
      this.notify()
      await this.refreshApprovals()
      await this.refreshHistory()
    })
  }
  async loadStack(refreshWatches = true, selectedFrame?: number) {
    if (!this.current || this.session.status !== 'paused' || !this.snapshot?.selected_thread_id)
      return
    const s = this.snapshot,
      epoch = s.stop_epoch,
      generation = this.serial
    const raw = await this.rpc('stack', { ...this.precondition(), thread_id: s.selected_thread_id })
    if (
      !this.current ||
      generation !== this.serial ||
      this.snapshot?.stop_epoch !== epoch ||
      this.session.status !== 'paused'
    )
      return
    const result = z
      .object({
        data: z
          .object({
            items: z.array(
              z
                .object({
                  handle: z.string(),
                  name: z.string(),
                  source_id: z.string().nullable(),
                  path: z.string().optional(),
                  relative_path: z.string().optional(),
                  line: z.number(),
                })
                .loose()
            ),
          })
          .loose(),
      })
      .loose()
      .parse(raw)
    if (!this.current || generation !== this.serial || this.snapshot?.stop_epoch !== epoch) return
    this.frameHandles = result.data.items.map((f) => f.handle)
    for (const frame of result.data.items) {
      const admitted = this.frameSourcePaths ? frame.relative_path : frame.path
      if (
        frame.source_id &&
        admitted &&
        (this.frameSourcePaths || !this.sources.has(frame.source_id))
      )
        this.sources.set(frame.source_id, admitted)
    }
    this.session.frames = result.data.items.map((f) => ({
      name: f.name,
      file: this.frameSourcePaths
        ? f.source_id && f.relative_path
          ? f.relative_path
          : ''
        : f.source_id
          ? (this.path(f.source_id) ?? f.path ?? f.source_id)
          : '',
      line: f.line,
    }))
    if (
      this.frameSourcePaths &&
      this.session.frames.length &&
      !this.session.frames.some((f) => f.file)
    )
      this.error = t('debug.frameSourceUnavailable')
    else if (this.error === t('debug.frameSourceUnavailable')) this.error = ''
    // Held in Node's own code (js-debug's statement, the loader): the program's frame is the one
    // that matters, so it is the one selected; the Node row stays folded above it.
    this.session.frame =
      selectedFrame !== undefined && selectedFrame < this.session.frames.length
        ? selectedFrame
        : Math.max(
            0,
            this.session.frames.findIndex((frame) => frame.file)
          )
    this.notify()
    await this.loadScopes(this.session.frame, this.invocation())
    if (this.current && this.snapshot?.stop_epoch === epoch && this.session.status === 'paused')
      this.loadedStackEpoch = epoch
    if (refreshWatches) await this.refreshWatches()
  }
  selectFrame(index: number) {
    return this.human((invocation) => this.loadScopes(index, invocation)).then(() =>
      this.refreshWatches(true)
    )
  }
  private async refreshWatches(force = false) {
    let epoch = this.snapshot?.stop_epoch
    if (!force && this.watchesEpoch === epoch) return
    for (const { expression } of [...this.session.watches]) {
      if (!this.current || this.session.status !== 'paused' || this.snapshot?.stop_epoch !== epoch)
        return
      if (!this.session.watches.some((watch) => watch.expression === expression)) continue
      const refreshedEpoch = await this.watch(expression, true)
      if (refreshedEpoch === undefined) {
        if (!this.session.watches.some((watch) => watch.expression === expression)) continue
        return
      }
      epoch = refreshedEpoch
    }
  }
  async refreshExitInfo(): Promise<void> {
    const snapshot = this.snapshot
    if (!this.exitCodeSupported || !snapshot || !this.current || this.session.status !== 'exited')
      return
    const serial = this.serial
    const raw = await this.transport.rpc('debugger.v1.exitInfo', {
      debug_session_id: snapshot.debug_session_id,
    })
    const result = z.object({ exit_code: z.number().int().nullable() }).parse(raw)
    if (
      serial !== this.serial ||
      this.snapshot?.incarnation !== snapshot.incarnation ||
      this.snapshot.debug_session_id !== snapshot.debug_session_id
    )
      return
    this.session.exitCode = result.exit_code ?? undefined
    this.notify()
  }
  get awaitingExitCode(): boolean {
    return (
      this.exitCodeSupported &&
      this.current &&
      this.session.status === 'exited' &&
      !this.session.detached &&
      this.session.exitCode === undefined
    )
  }
  private scopeHandles = new Map<string, string | null>()
  private scopeStateRevision?: number
  private async loadScopes(index: number, invocation: Invocation) {
    const frame_handle = invocation.frameHandles[index]
    if (!frame_handle) return
    const generation = this.serial,
      epoch = this.snapshot.stop_epoch
    const raw = await this.rpc('scopes', { ...this.precondition(invocation), frame_handle })
    if (
      !this.current ||
      generation !== this.serial ||
      this.snapshot?.stop_epoch !== epoch ||
      this.session.status !== 'paused'
    )
      return
    const result = z
      .object({
        data: z
          .object({
            items: z.array(z.object({ name: z.string(), handle: z.string().nullable() }).loose()),
          })
          .loose(),
      })
      .loose()
      .parse(raw)
    if (!this.current || generation !== this.serial || this.snapshot.stop_epoch !== epoch) return
    const retained =
      this.loadedStackEpoch === epoch &&
      this.scopeStateRevision === this.snapshot.state_revision &&
      this.session.frame === index
        ? this.session.variables
        : []
    this.session.frame = index
    // No implicit getters, formatters or recursion. Scope handles need explicit inspection.
    this.session.variables = result.data.items.map(
      (s) =>
        (s.handle &&
          this.scopeHandles.get(s.name) === s.handle &&
          retained.find((value) => value.name === s.name)) || {
          name: s.name,
          value: s.handle ? t('streamC.76eedf5e0f835b5e') : t('streamC.ca184496974204a0'),
          handle: s.handle ?? undefined,
        }
    )
    this.scopeHandles = new Map(result.data.items.map((scope) => [scope.name, scope.handle]))
    this.scopeStateRevision = this.snapshot.state_revision
    this.notify()
  }
  watch(expression: string, retained = false) {
    return this.human(async (invocation) => {
      if (retained && !this.session.watches.some((w) => w.expression === expression)) return
      if (!this.session.watches.some((w) => w.expression === expression))
        this.session.watches.push({ expression })
      const current = this.invocation()
      if (current.snapshot.stop_epoch !== invocation.snapshot.stop_epoch) return
      const frame_handle = current.frameHandles[current.frame]
      if (frame_handle !== invocation.frameHandles[invocation.frame]) return
      if (!frame_handle) {
        this.error = t('streamC.8f55c062960e8261')
        this.notify()
        return
      }
      const generation = this.serial,
        operation_id = crypto.randomUUID()
      this.inspections.set(operation_id, { expression })
      let result: DebuggerReceipt
      try {
        result = DebuggerReceiptSchema.parse(
          await this.ownerCommand('evaluate', {
            ...this.precondition(current),
            operation_id,
            frame_handle,
            expression,
          })
        )
      } catch (error) {
        this.inspections.delete(operation_id)
        if (!this.current || generation !== this.serial) return
        const watch = this.session.watches.find((w) => w.expression === expression)
        if (watch) {
          watch.error = error instanceof Error ? error.message : t('node.error.generic')
          watch.stale = this.session.status !== 'paused'
        }
        console.debug('[debugger] Watch evaluation unavailable', expression, error)
        this.notify()
        return
      }
      if (!this.current || generation !== this.serial) return
      this.observe({ observation: 'current', snapshot: result.snapshot })
      const settled = result.outcome === 'completed' || result.outcome === 'failed'
      if (['failed', 'rejected', 'timed_out', 'outcome_unknown'].includes(result.outcome)) {
        const watch = this.session.watches.find((value) => value.expression === expression)
        if (watch) {
          watch.error = receiptMessage(result.code ?? result.outcome)
          watch.stale = false
        }
        this.inspections.delete(operation_id)
      }
      if (settled && this.session.status === 'paused') {
        await this.loadStack(false, current.frame)
        if (/\bstale_state\b/.test(this.error) || this.error === t('streamC.8f55c062960e8261'))
          this.error = ''
      }
      await this.refreshApprovals()
      await this.refreshHistory()
      if (settled && this.session.status === 'paused') {
        if (this.loadedStackEpoch === this.snapshot?.stop_epoch) {
          const watch = this.session.watches.find((value) => value.expression === expression)
          if (watch) watch.stale = false
        }
        this.watchesEpoch = this.snapshot?.stop_epoch
        this.notify()
        return this.watchesEpoch
      }
      this.notify()
    })
  }
  unwatch(expression: string) {
    // Removing local intent needs no live frame or remote approval, and must take effect
    // before an in-flight refresh advances to its next retained expression.
    this.session.watches = this.session.watches.filter((w) => w.expression !== expression)
    this.notify()
    return Promise.resolve()
  }
  invalidate() {
    ++this.serial
    this.disconnected()
  }
}

export function debuggerKey(event: {
  key: string
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  target?: EventTarget | null
}): string | undefined {
  // Popout elements belong to a different DOM realm; main-window instanceof is not a field test.
  const target = event.target as Element | null | undefined
  if (
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    (typeof target?.closest === 'function' &&
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
      ))
  )
    return
  if (event.key === 'F5') return event.shiftKey ? 'stop' : 'continue'
  if (event.shiftKey && event.key !== 'F11') return
  return { F6: 'pause', F10: 'step-over', F11: event.shiftKey ? 'step-out' : 'step-into' }[
    event.key
  ]
}
