import type { Prompt, NodeClient } from '@abele/node-client'
import { ManagerRunSchema, validateParams, type ManagerRun } from '@abele/node-protocol'
import { z } from 'zod'
import type { NodeClientStore } from './NodeClientStore'
import { openWindow, catchUp } from './sessionWindow'
import { reduceTranscript } from './NodeTranscriptReducer'
import { pendingOwnerPrompts, promptAnswerStates } from './promptAnswers'
import { t } from '@/i18n'
import { nodeErrorDetails } from './errorWords'
import { uncertainReceiptError } from './clientRecords'

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
    run: z.custom<ManagerRun>((value) => ManagerRunSchema.safeParse(value).success).optional(),
    observedSeq: z.number().optional(),
    notified: z.boolean().optional(),
    justification: z.string().max(200).optional(),
  })
  .strict()
export type ManagerOperation = z.infer<typeof ManagerOperationSchema>
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
  async stopParent(parent: string) {
    await this.store.transaction((s) => {
      for (const entry of Object.values(s.managerOperations ?? {}))
        if (entry.parent === parent) entry.notified = true
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
    const entries = await this.store.read((s) =>
      Object.entries(s.managerOperations ?? {}).filter(
        ([, entry]) => !entry.notified && entry.method !== 'command.v1.cancel'
      )
    )
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
    if (!this.client.connected) throw new Error('disconnected')
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
    const run = ManagerRunSchema.parse(receipt.result)
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
    const owned = await this.store.read((s) =>
      Object.entries(s.managerOperations ?? {}).some(([id, entry]) => {
        const receipt = ManagerRunSchema.safeParse(s.results[id]?.result)
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
    let status = ManagerRunSchema.parse(
      await this.client.request('command.v1.status', { session_id: session, run_id: run })
    )
    await this.store.transaction((s) => {
      // A journal update committed while status was in flight is newer evidence.
      // Never mask an exit/unknown outcome with an earlier running response.
      for (const event of s.events[session] ?? []) {
        if (event.seq <= before || event.type !== 'command.updated') continue
        const update = ManagerRunSchema.safeParse(event.data)
        if (update.success && update.data.run_id === run) status = update.data
      }
      for (const [operation, entry] of Object.entries(s.managerOperations ?? {})) {
        const receipt = ManagerRunSchema.safeParse(s.results[operation]?.result)
        if (
          entry.parent === parent &&
          receipt.success &&
          receipt.data.run_id === run &&
          receipt.data.session_id === session
        ) {
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
        const receipt = ManagerRunSchema.safeParse(s.results[operation]?.result)
        return receipt.success && entry.method !== 'command.v1.cancel'
          ? [{ parent: entry.parent, run: entry.run ?? receipt.data }]
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
          if (status.state === 'pending_approval')
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
        const receipt = ManagerRunSchema.safeParse(s.results[operation]?.result)
        if (!receipt.success) return []
        let run = entry.run ?? receipt.data
        const events = s.events[run.session_id] ?? []
        for (const event of events) {
          const data = event.data as Record<string, unknown>
          if (data.run_id !== run.run_id || event.seq <= (entry.observedSeq ?? 0)) continue
          if (event.type === 'command.updated') {
            const updated = ManagerRunSchema.safeParse(data)
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
        for (const prompt of transcript.prompts) {
          if (prompt.state === 'pending') prompts.set(prompt.prompt_id, prompt)
          else prompts.delete(prompt.prompt_id)
        }
        return [
          {
            operation,
            justification: entry.justification,
            title:
              typeof entry.params.command === 'string'
                ? entry.params.command
                : Array.isArray(entry.params.argv)
                  ? entry.params.argv
                      .filter((value): value is string => typeof value === 'string')
                      .join(' ')
                  : typeof entry.params.source_branch === 'string' &&
                      typeof entry.params.target_branch === 'string'
                    ? `${entry.params.source_branch} → ${entry.params.target_branch}`
                    : 'git.v1.integrate',
            run,
            prompts: [...prompts.values()].filter(
              (p) =>
                run.state === 'pending_approval' &&
                p.prompt_id === run.prompt_id &&
                p.state === 'pending'
            ),
            answers: promptAnswerStates(s, run.session_id),
          },
        ]
      })
    )
  }
}
