import type { Prompt, NodeClient } from '@abele/node-client'
import {
  ManagerRunSchema,
  CommandContextRunSchema,
  CommandContextSchema,
  PromptSchema,
  validateParams,
  type ManagerRun,
  type CommandContextRun,
} from '@abele/node-protocol'
import { z } from 'zod'
import type { NodeClientStore } from './NodeClientStore'
import { openWindow, catchUp } from './sessionWindow'
import { reduceTranscript } from './NodeTranscriptReducer'
import { pendingOwnerPrompts, promptAnswerStates } from './promptAnswers'
import { t } from '@/i18n'
import { nodeErrorDetails } from './errorWords'
import { uncertainReceiptError } from './clientRecords'
const RunSchema = CommandContextRunSchema.or(ManagerRunSchema)
type Run = ManagerRun | CommandContextRun
function runUpdate(raw: unknown, current: Run) {
  // Journals publish run fields; only prepare/status carry the exact approval object.
  if (
    'context_id' in current &&
    raw &&
    typeof raw === 'object' &&
    'context_id' in raw &&
    raw.context_id === current.context_id
  )
    return CommandContextRunSchema.safeParse({
      ...raw,
      approval: 'approval' in raw ? raw.approval : current.approval,
    })
  return RunSchema.safeParse(raw)
}

function outputTail(value: string, capacity: number): { text: string; truncated: boolean } {
  const chars = Array.from(value)
  let bytes = 0,
    start = chars.length
  while (start > 0) {
    const size = new TextEncoder().encode(chars[start - 1]).length
    if (bytes + size > capacity) break
    bytes += size
    start--
  }
  return { text: chars.slice(start).join(''), truncated: start > 0 }
}

export const ManagerOperationSchema = z
  .object({
    parent: z.string(),
    method: z.string(),
    params: z.record(z.string(), z.unknown()),
    run: z.custom<Run>((value) => RunSchema.safeParse(value).success).optional(),
    observedSeq: z.number().optional(),
    notified: z.boolean().optional(),
    stopped: z.boolean().optional(),
    justification: z.string().max(200).optional(),
    request: z.record(z.string(), z.unknown()).optional(),
    fallback: z.custom<Prompt>((value) => PromptSchema.safeParse(value).success).optional(),
  })
  .strict()
export type ManagerOperation = z.infer<typeof ManagerOperationSchema>
function retainedRun(entry: ManagerOperation, receipt: Run, recover = false): Run {
  // A durable receipt replaces local transport uncertainty, never a newer node status.
  if (entry.run?.session_id === 'unsubmitted-command') {
    if (recover) {
      entry.run = receipt
      if (!entry.stopped) entry.notified = false
    }
    return receipt
  }
  return entry.run ?? receipt
}
export type ManagerMethod = 'command.v1.run' | 'command.v1.cancel' | 'git.v1.integrate'
const Description = z.object({
  capabilities: z.object({ capabilities: z.record(z.string(), z.object({ status: z.string() })) }),
})
export function managerCapability(description: unknown, capability: string): boolean {
  const parsed = Description.safeParse(description)
  return parsed.success && parsed.data.capabilities.capabilities[capability]?.status === 'supported'
}

/** Exact durable operations; owner prompt answers are deliberately a separate UI API. */
export class NodeManagerController {
  /** Owner UI checks this again immediately before approving a prepared action. */
  canApprove?: (parent: string, run: CommandContextRun) => Promise<(() => void) | false>
  private readonly subscribed = new Set<string>()
  private readonly pendingPrompts = new Map<string, Prompt[]>()
  connectionChanged() {
    this.subscribed.clear()
    this.pendingPrompts.clear()
  }
  constructor(
    readonly client: NodeClient,
    readonly store: NodeClientStore
  ) {}
  async enableContexts() {
    if (!managerCapability(await this.client.describe(), 'command_context_v1'))
      throw new Error(t('node.manager.contextUpdate'))
    await this.client.request('command.context.v1.enable', {})
  }
  private async contextOperation(
    parent: string,
    method: string,
    raw: unknown,
    operation: string,
    justification?: string,
    guard: () => void = () => {},
    request?: Record<string, unknown>
  ) {
    const params = validateParams(method, raw) as Record<string, unknown>
    await this.store.transaction((s) => {
      guard()
      const previous = s.operationRequests?.[operation]
      const pending = s.outbox.find((e) => e.operation_id === operation)
      const known = previous ?? pending
      if (
        known &&
        (known.method !== method || JSON.stringify(known.params) !== JSON.stringify(params))
      )
        throw new Error('idempotency_mismatch')
      const entry = s.managerOperations?.[operation]
      if (entry && entry.parent !== parent)
        throw new Error('Run does not belong to this parent chat')
      if (method === 'command.context.v1.prepare')
        (s.managerOperations ??= {})[operation] ??= {
          parent,
          method,
          params,
          justification,
          request,
        }
      if (!s.results[operation] && !pending) {
        ;(s.operationRequests ??= {})[operation] = { method, params }
        s.outbox.push({ operation_id: operation, method, params })
      }
    })
    await this.client.flush()
    const receipt = await this.store.read((s) => s.results[operation])
    if (!receipt) throw new Error(`outcome_unknown: retain operation_id ${operation}`)
    if (receipt.error) throw new Error(nodeErrorDetails(receipt.error))
    return receipt.result
  }
  async command(
    parent: string,
    raw: Record<string, unknown>,
    operation: string,
    mode: 'ask' | 'bypass',
    justification: string,
    guard: () => void = () => {}
  ) {
    try {
      await this.enableContexts()
      guard()
      const { project_id, worktree_id, session_id: _session, ...command } = raw
      const target = worktree_id ? { worktree_id } : { project_id }
      const hash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify([parent, target]))
      )
      const contextOperation =
        'context-' +
        Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
      const context = CommandContextSchema.parse(
        await this.contextOperation(
          parent,
          'command.context.v1.create',
          { parent_chat_id: parent, ...target },
          contextOperation
        )
      )
      guard()
      const run = CommandContextRunSchema.parse(
        await this.contextOperation(
          parent,
          'command.context.v1.prepare',
          {
            ...command,
            context_id: context.context_id,
            parent_chat_id: parent,
            permission_mode: mode,
            justification,
          },
          operation,
          justification,
          guard,
          raw
        )
      )
      await this.store.transaction((s) => {
        const entry = s.managerOperations?.[operation]
        if (entry) retainedRun(entry, run, true)
      })
      await this.client
        .subscribe(context.stream_id)
        .catch((error) => console.debug('[Abele node] command context subscription pending', error))
      return run
    } catch (error) {
      return this.refuse(parent, raw, operation, mode, justification, error)
    }
  }
  async refuse(
    parent: string,
    raw: Record<string, unknown>,
    operation: string,
    mode: 'ask' | 'bypass',
    justification: string,
    error: unknown
  ): Promise<never> {
    const reason = error instanceof Error ? error.message : String(error)
    if (reason === 'idempotency_mismatch') throw new Error(reason)
    let uncertain = false
    // A refused preparation is visible as a failed request, never as an executed command.
    await this.store.transaction((s) => {
      const entry = ((s.managerOperations ??= {})[operation] ??= {
        parent,
        method: 'command.context.v1.prepare',
        params: {},
        justification,
      })
      uncertain =
        s.operationRequests?.[operation]?.method === 'command.context.v1.prepare' &&
        !s.results[operation]?.error
      if (entry.parent !== parent || s.results[operation]?.result) return
      entry.request ??= raw
      entry.run ??= {
        run_id: operation,
        prompt_id: operation,
        session_id: 'unsubmitted-command',
        method: 'command.v1.run',
        state: uncertain ? 'outcome_unknown' : 'failed',
        reason: uncertain
          ? `outcome_unknown: ${reason}`
          : t('node.manager.notSubmitted', { reason }),
        stdout: '',
        stderr: '',
        stdout_truncated: false,
        stderr_truncated: false,
      }
      if (mode === 'ask' && !uncertain && entry.run.state === 'failed') {
        const prompt = PromptSchema.parse({
          kind: 'permission',
          prompt_id: crypto.randomUUID(),
          session_id: 'unsubmitted-command',
          run_id: operation,
          revision: 1,
          action_digest: '0'.repeat(64),
          expires_at: Number.MAX_SAFE_INTEGER,
          state: 'pending',
          choice: null,
          installation_id: null,
          delivered: false,
          tool_name: 'node_command_run',
          title: t('node.manager.command'),
          input: {
            ...raw,
            context_id: 'unsubmitted-command',
            cwd: raw.cwd ?? raw.worktree_id ?? raw.workspace_id ?? raw.project_id,
            refusal: reason,
          },
        })
        entry.fallback ??= prompt
        entry.run.state = 'pending_approval'
        entry.run.prompt_id = entry.fallback.prompt_id
      }
    })
    throw new Error(
      uncertain
        ? `outcome_unknown: retain operation_id ${operation}; ${reason}`
        : t('node.manager.notSubmitted', { reason })
    )
  }
  /** Only mounted owner controls call this; never an agent tool. */
  async answer(parent: string, raw: Prompt, choice: 'allow' | 'deny') {
    const prompt = PromptSchema.parse(raw)
    if (prompt.session_id === 'unsubmitted-command') {
      await this.store.transaction((s) => {
        const entry = s.managerOperations?.[prompt.run_id]
        if (
          entry?.parent !== parent ||
          !entry.fallback ||
          entry.fallback.prompt_id !== prompt.prompt_id ||
          entry.fallback.action_digest !== prompt.action_digest
        )
          throw new Error('stale_approval')
        if (entry.fallback.state !== 'pending') return
        entry.fallback.state = 'resolved'
        entry.fallback.choice = choice
        if (entry.run) entry.run.state = choice === 'allow' ? 'failed' : 'denied'
      })
      // Preparation was refused. A local acknowledgement cannot authorize a node action.
      return
    }
    const entry = await this.ownedContext(parent, prompt.session_id, prompt.run_id)
    if (!entry) throw new Error('Run does not belong to this parent chat')
    const run = CommandContextRunSchema.parse(
      await this.status(parent, prompt.session_id, prompt.run_id)
    )
    const approvalGuard =
      choice === 'allow' && this.canApprove ? await this.canApprove(parent, run) : undefined
    if (approvalGuard === false) throw new Error(t('node.manager.permissionChanged'))
    const approval = PromptSchema.parse(run.approval)
    if (approval.prompt_id !== prompt.prompt_id || approval.action_digest !== prompt.action_digest)
      throw new Error('stale_approval')
    await this.enableContexts()
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entry.operation))
    const decision =
      'decision-' +
      Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    await this.contextOperation(
      parent,
      'command.context.v1.execute',
      {
        context_id: run.context_id,
        parent_chat_id: parent,
        run_id: run.run_id,
        action_digest: approval.action_digest,
        choice,
      },
      decision,
      undefined,
      approvalGuard || undefined
    )
    await this.status(parent, prompt.session_id, prompt.run_id)
  }
  private async ownedContext(parent: string, session: string, run: string) {
    return this.store.read(
      (s) =>
        Object.entries(s.managerOperations ?? {}).flatMap(([operation, entry]) => {
          const parsed = CommandContextRunSchema.safeParse(s.results[operation]?.result)
          return entry.parent === parent &&
            parsed.success &&
            parsed.data.session_id === session &&
            parsed.data.run_id === run
            ? [{ operation, run: parsed.data }]
            : []
        })[0]
    )
  }
  async targetFor(parent: string, session: string, run: string) {
    if (session === 'unsubmitted-command')
      return this.store.read((s) => {
        const entry = s.managerOperations?.[run]
        if (entry?.parent !== parent || !entry.request)
          throw new Error('Run does not belong to this parent chat')
        return typeof entry.request.worktree_id === 'string'
          ? { worktree_id: entry.request.worktree_id }
          : { project_id: entry.request.project_id as string }
      })
    const owned = await this.ownedContext(parent, session, run)
    if (!owned) return undefined
    return this.store.read((s) => {
      for (const receipt of Object.values(s.results)) {
        const context = CommandContextSchema.safeParse(receipt.result)
        if (
          context.success &&
          context.data.context_id === owned.run.context_id &&
          context.data.parent_chat_id === parent
        )
          return context.data.worktree_id
            ? { worktree_id: context.data.worktree_id }
            : { project_id: context.data.project_id }
      }
      throw new Error('Command context target is unavailable')
    })
  }
  async stopParent(parent: string) {
    await this.store.transaction((s) => {
      for (const entry of Object.values(s.managerOperations ?? {}))
        if (entry.parent === parent) {
          entry.notified = true
          entry.stopped = true
        }
    })
  }
  async cleanupFor(parent: string, run: string) {
    const card = (await this.cards(parent)).find((entry) => entry.run.run_id === run)
    if (card?.run.method !== 'git.v1.integrate' || card.run.state !== 'applied') return
    return this.store.read((state) => {
      const params = state.managerOperations?.[card.operation]?.params
      const worktree = params?.source_worktree_id
      if (typeof worktree !== 'string') return
      return {
        worktree_id: worktree,
        project_id: params.project_id,
        branch: params.source_branch,
        owner_approval_required: true,
        instruction:
          'The developer worktree remains on the node. Report its location from list_node_worktrees and offer removal. Only remove it if the owner approves; get fresh node_git_status preconditions before node_worktree_remove. The branch is retained.',
      }
    })
  }
  async wakeDelivered(wake: (parent: string, notice: string) => boolean) {
    const entries = await this.store.transaction((s) => {
      for (const [operation, entry] of Object.entries(s.managerOperations ?? {})) {
        if (entry.run?.session_id !== 'unsubmitted-command') continue
        const receipt = RunSchema.safeParse(s.results[operation]?.result)
        if (receipt.success) retainedRun(entry, receipt.data, true)
      }
      return Object.entries(s.managerOperations ?? {}).filter(
        ([, entry]) => !entry.notified && !entry.stopped && entry.method !== 'command.v1.cancel'
      )
    })
    for (const [operation, entry] of entries) {
      const card = (await this.cards(entry.parent)).find((card) => card.operation === operation)
      if (!card || ['pending_approval', 'running'].includes(card.run.state)) continue
      if (
        wake(
          entry.parent,
          `Command “${card.title}” ended: ${card.run.state}. Read node_command_status using the command receipt for its output and exit code.`
        )
      )
        await this.store.transaction((s) => {
          s.managerOperations![operation].notified = true
        })
    }
  }
  async mutate(
    parent: string,
    method: ManagerMethod,
    raw: unknown,
    operation: string,
    legacyAlias?: string,
    justification?: string
  ): Promise<ManagerRun> {
    const localCancel =
      method === 'command.v1.cancel' &&
      typeof raw === 'object' &&
      raw !== null &&
      'session_id' in raw &&
      raw.session_id === 'unsubmitted-command'
    if (!this.client.connected && !localCancel) throw new Error('disconnected')
    if (method === 'command.v1.cancel') {
      const input = raw as { session_id: string; run_id: string }
      if (input.session_id === 'unsubmitted-command')
        return this.store.transaction((s) => {
          const entry = s.managerOperations?.[input.run_id]
          if (entry?.parent !== parent || !entry.run)
            throw new Error('Run does not belong to this parent chat')
          if (entry.run.state === 'pending_approval') {
            entry.run.state = 'cancelled'
            if (entry.fallback) {
              entry.fallback.state = 'resolved'
              entry.fallback.choice = 'deny'
            }
          }
          return entry.run
        })
      const context = await this.ownedContext(parent, input.session_id, input.run_id)
      if (context) {
        await this.enableContexts()
        return RunSchema.parse(
          await this.contextOperation(
            parent,
            'command.context.v1.cancel',
            { context_id: context.run.context_id, parent_chat_id: parent, run_id: input.run_id },
            operation
          )
        )
      }
    }
    if (!operation || operation.length > 128) throw new Error('invalid_params: operation_id')
    const capability = method === 'git.v1.integrate' ? 'git_integrate_v1' : 'command_run_v1'
    if (!managerCapability(await this.client.describe(), capability))
      throw new Error(`unsupported_method: ${method}`)
    let params: Record<string, unknown>
    try {
      params = validateParams(method, raw) as Record<string, unknown>
    } catch {
      throw new Error(
        method === 'command.v1.run'
          ? `invalid_params: ${t('node.manager.invalidCommand')}`
          : method === 'git.v1.integrate'
            ? `invalid_params: ${t('node.manager.invalidIntegration')}`
            : `invalid_params: ${t('node.manager.invalidCancel')}`
      )
    }
    if (method === 'command.v1.cancel')
      await this.status(
        parent,
        z.string().parse(params.session_id),
        z.string().parse(params.run_id)
      )
    await this.store.transaction((s) => {
      const retainedOperation = (id: string): ManagerOperation | undefined => {
        const previous = s.managerOperations?.[id]
        if (previous) return previous
        const receipt = s.results[id]
        if (
          receipt?.managerParent !== parent ||
          receipt.request?.method !== method ||
          JSON.stringify(receipt.request.params) !== JSON.stringify(params)
        )
          return
        return { parent, method, params, notified: true }
      }
      // An upgrade must not replace an already admitted retry in this same chat.
      const legacy = legacyAlias ? retainedOperation(legacyAlias) : undefined
      if (
        legacyAlias &&
        legacy?.parent === parent &&
        legacy.method === method &&
        JSON.stringify(legacy.params) === JSON.stringify(params)
      )
        operation = legacyAlias
      const previous = retainedOperation(operation)
      if (
        previous &&
        (previous.parent !== parent ||
          previous.method !== method ||
          JSON.stringify(previous.params) !== JSON.stringify(params))
      )
        throw new Error(
          'idempotency_mismatch: This retry ID belongs to different action arguments or a different chat. Check the previous result before starting a new action with a new operation_id.'
        )
      if (!previous && (s.results[operation] || s.outbox.some((e) => e.operation_id === operation)))
        throw new Error(
          'idempotency_mismatch: This retry ID is already used by another operation. Check the previous result before starting a new action with a new operation_id.'
        )
      ;(s.managerOperations ??= {})[operation] = previous ?? {
        parent,
        method,
        params,
        justification,
      }
      if (!s.results[operation] && !s.outbox.some((e) => e.operation_id === operation))
        s.outbox.push({ operation_id: operation, method, params })
    })
    await this.client.flush()
    const receipt = await this.store.read((s) => s.results[operation])
    if (!receipt)
      throw new Error(
        'outcome_unknown: Retry the exact action with the same submitted operation_id; do not create a replacement action.'
      )
    if (receipt.error) {
      if (!uncertainReceiptError(receipt.error))
        await this.store.transaction((s) => {
          if (s.managerOperations?.[operation]) s.managerOperations[operation].notified = true
        })
      throw new Error(nodeErrorDetails(receipt.error))
    }
    const run = RunSchema.parse(receipt.result)
    if (
      method === 'command.v1.cancel' &&
      !['pending_approval', 'running', 'outcome_unknown'].includes(run.state)
    )
      await this.store.transaction((s) => {
        if (s.managerOperations?.[operation]) s.managerOperations[operation].notified = true
      })
    await this.client.subscribe(run.session_id).catch((error) => {
      console.debug('[Abele node] accepted command awaits activity refresh', error)
    })
    return run
  }
  async status(parent: string, session: string, run: string) {
    if (session === 'unsubmitted-command')
      return this.store.read((s) => {
        const entry = s.managerOperations?.[run]
        if (entry?.parent !== parent || !entry.run)
          throw new Error('Run does not belong to this parent chat')
        return entry.run
      })
    const owned = await this.store.read((s) =>
      Object.entries(s.managerOperations ?? {}).some(([id, entry]) => {
        const receipt = RunSchema.safeParse(s.results[id]?.result)
        return (
          entry.parent === parent &&
          receipt.success &&
          receipt.data.session_id === session &&
          receipt.data.run_id === run
        )
      })
    )
    if (!owned) throw new Error('Run does not belong to this parent chat')
    const before = await this.store.read((s) => s.cursors[session] ?? 0)
    const context = await this.ownedContext(parent, session, run)
    if (context) await this.enableContexts()
    let status = RunSchema.parse(
      await this.client.request(
        context ? 'command.context.v1.status' : 'command.v1.status',
        context
          ? { context_id: context.run.context_id, parent_chat_id: parent, run_id: run }
          : { session_id: session, run_id: run }
      )
    )
    await this.store.transaction((s) => {
      // A journal update committed while status was in flight is newer evidence.
      // Never mask an exit/unknown outcome with an earlier running response.
      for (const event of s.events[session] ?? []) {
        if (event.seq <= before || event.type !== 'command.updated') continue
        const update = runUpdate(event.data, status)
        if (update.success && update.data.run_id === run) status = update.data
      }
      for (const [operation, entry] of Object.entries(s.managerOperations ?? {})) {
        const receipt = RunSchema.safeParse(s.results[operation]?.result)
        if (
          entry.parent === parent &&
          receipt.success &&
          receipt.data.run_id === run &&
          receipt.data.session_id === session
        ) {
          retainedRun(entry, status, true)
          entry.run = status
          entry.observedSeq = s.cursors[session] ?? 0
        }
      }
    })
    return status
  }
  async restore() {
    if (!this.client.connected) return
    const entries = await this.store.read((s) =>
      Object.entries(s.managerOperations ?? {}).flatMap(([operation, entry]) => {
        const receipt = RunSchema.safeParse(s.results[operation]?.result)
        return receipt.success && entry.method !== 'command.v1.cancel'
          ? [{ parent: entry.parent, run: retainedRun(entry, receipt.data, true) }]
          : []
      })
    )
    for (const entry of entries) {
      try {
        const session = entry.run.session_id
        const reconnect = !this.subscribed.has(session)
        if (reconnect) {
          const window = await openWindow(this.client, session)
          if (window) await catchUp(this.client, session, window.head)
          await this.client.subscribe(session)
          this.subscribed.add(session)
        }
        if (reconnect || ['pending_approval', 'running'].includes(entry.run.state)) {
          const status = await this.status(entry.parent, session, entry.run.run_id)
          if (status.state === 'pending_approval' && !('context_id' in status))
            this.pendingPrompts.set(status.run_id, await pendingOwnerPrompts(this.client, session))
          else this.pendingPrompts.delete(status.run_id)
        }
      } catch (error) {
        console.debug('[Abele node] manager run refresh unavailable', error)
      }
    }
  }
  async cards(parent: string) {
    return this.store.read((s) =>
      Object.entries(s.managerOperations ?? {}).flatMap(([operation, entry]) => {
        if (entry.parent !== parent || entry.method === 'command.v1.cancel') return []
        const receipt = RunSchema.safeParse(s.results[operation]?.result)
        if (!receipt.success && !entry.run) return []
        let run = receipt.success ? retainedRun(entry, receipt.data) : entry.run!
        const display = entry.request ?? entry.params
        const events = s.events[run.session_id] ?? []
        for (const event of events) {
          const data = event.data as Record<string, unknown>
          if (data.run_id !== run.run_id || event.seq <= (entry.observedSeq ?? 0)) continue
          if (event.type === 'command.updated') {
            const updated = runUpdate(data, run)
            if (updated.success) run = updated.data
          } else if (
            event.type === 'command.output' &&
            typeof data.text === 'string' &&
            (data.stream === 'stdout' || data.stream === 'stderr')
          ) {
            const stream = data.stream
            const joined = run[stream] + data.text
            const tail = outputTail(joined, Number(entry.params.output_bytes ?? 16384))
            run = {
              ...run,
              [stream]: tail.text,
              [`${stream}_truncated`]: run[`${stream}_truncated`] || tail.truncated,
            }
          }
        }
        const transcript = reduceTranscript(events)
        const prompts = new Map(
          (this.pendingPrompts.get(run.run_id) ?? []).map((prompt) => [prompt.prompt_id, prompt])
        )
        if (entry.fallback?.state === 'pending')
          prompts.set(entry.fallback.prompt_id, entry.fallback)
        if ('approval' in run && run.approval) {
          const approval = PromptSchema.parse(run.approval)
          prompts.set(approval.prompt_id, approval)
        }
        for (const prompt of transcript.prompts) {
          if (prompt.state === 'pending') prompts.set(prompt.prompt_id, prompt)
          else prompts.delete(prompt.prompt_id)
        }
        return [
          {
            operation,
            command: typeof display.command === 'string' ? display.command : undefined,
            argv: Array.isArray(display.argv)
              ? display.argv.filter((v): v is string => typeof v === 'string')
              : undefined,
            folder:
              ('approval' in run && run.approval
                ? ((run.approval.input as Record<string, unknown> | undefined)?.cwd as
                    | string
                    | undefined)
                : undefined) ??
              (typeof display.cwd === 'string'
                ? display.cwd
                : typeof display.worktree_id === 'string'
                  ? display.worktree_id
                  : typeof display.workspace_id === 'string'
                    ? display.workspace_id
                    : typeof display.project_id === 'string'
                      ? display.project_id
                      : undefined),
            justification: entry.justification,
            title:
              typeof display.command === 'string'
                ? display.command
                : Array.isArray(display.argv)
                  ? display.argv
                      .filter((value): value is string => typeof value === 'string')
                      .join(' ')
                  : typeof display.source_branch === 'string' &&
                      typeof display.target_branch === 'string'
                    ? `${display.source_branch} → ${display.target_branch}`
                    : 'git.v1.integrate',
            run,
            prompts: [...prompts.values()].filter(
              (p) =>
                run.state === 'pending_approval' &&
                p.prompt_id === run.prompt_id &&
                p.state === 'pending'
            ),
            answers: {
              ...promptAnswerStates(s, run.session_id),
              ...Object.fromEntries(
                Object.entries(s.operationRequests ?? {}).flatMap(([id, request]) => {
                  const p = request.params as Record<string, unknown>
                  const pending = s.outbox.some((e) => e.operation_id === id)
                  if (
                    request.method !== 'command.context.v1.execute' ||
                    p.run_id !== run.run_id ||
                    p.parent_chat_id !== parent ||
                    (p.choice !== 'allow' && p.choice !== 'deny')
                  )
                    return []
                  return [
                    [
                      run.prompt_id,
                      {
                        choice: p.choice,
                        state: pending
                          ? ('pending' as const)
                          : s.results[id]?.error
                            ? ('rejected' as const)
                            : ('answered' as const),
                        error: s.results[id]?.error,
                      },
                    ],
                  ]
                })
              ),
            },
          },
        ]
      })
    )
  }
}
