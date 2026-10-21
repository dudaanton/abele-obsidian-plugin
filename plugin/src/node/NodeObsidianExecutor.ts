/** The node journal is authoritative; these envelopes never authorize execution by themselves. */
export interface ObsidianInvocation {
  invocation_id: string
  session_id: string
  run_id: string
  call_id: string
  installation_id: string
  vault_id: string
  agent_id: string
  revision: string
  tool_name: string
  arguments: Record<string, unknown>
  state: string
  executor: { installation_id: string; client_id: string } | null
  created_at: number
  preview?: Record<string, unknown>
  cancel_requested?: boolean
  prepared_needs_approval?: boolean
  hosted?: 'questions' | 'delegate'
  action: 'prepare' | 'claim' | 'waiting_approval' | 'reconcile' | 'cancel' | 'hosted'
}

export interface ObsidianExecutionReceipt {
  at?: number
  sessionId?: string
  runId?: string
  state: 'executing' | 'succeeded' | 'failed' | 'outcome_unknown'
  result: Record<string, unknown>
}

/** A checked refusal before the ordinary handler's first effect. */
export class ObsidianNotExecuted extends Error {}

export interface ObsidianToolAdapter {
  revision: string
  /** Resolves arguments, read guards, policy and current source without a handler effect. */
  prepare(invocation: ObsidianInvocation): Promise<{
    preview: Record<string, unknown>
    needsApproval: boolean
  }>
  /** Rechecks ordinary policy and prerequisites immediately before calling the handler. */
  execute(
    invocation: ObsidianInvocation,
    bypass: boolean,
    signal: AbortSignal
  ): Promise<Record<string, unknown>>
}

export interface ObsidianExecutorHost {
  clientId: string
  vaultId: string
  request(method: string, params: Record<string, unknown>): Promise<unknown>
  receipt(id: string): Promise<ObsidianExecutionReceipt | undefined>
  /** Must resolve only after durable storage, never after merely queuing an IDB write. */
  save(id: string, receipt: ObsidianExecutionReceipt): Promise<void>
  resolve(invocation: ObsidianInvocation): Promise<ObsidianToolAdapter | null>
  hosted?(invocation: ObsidianInvocation, signal: AbortSignal): Promise<void>
}

const method = (name: string) => `obsidian.tools.v1.${name}`
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const unknownResult = (text: string): ObsidianExecutionReceipt => ({
  state: 'outcome_unknown',
  result: { content: [{ type: 'text', text }] },
})

/** One execution claim, durable local intent, and receipt-only recovery. No transport outbox. */
export class NodeObsidianExecutor {
  private readonly active = new Map<string, { task: Promise<void>; controller: AbortController }>()
  private disposed = false
  constructor(private readonly host: ObsidianExecutorHost) {}

  accept(invocation: ObsidianInvocation): Promise<void> {
    if (this.disposed || invocation.vault_id !== this.host.vaultId) return Promise.resolve()
    if (invocation.executor?.client_id !== this.host.clientId) return Promise.resolve()
    const previous = this.active.get(invocation.invocation_id)
    if (previous) {
      if (invocation.action === 'cancel' || invocation.cancel_requested) previous.controller.abort()
      return previous.task
    }
    const controller = new AbortController()
    const task = this.perform(invocation, controller.signal).finally(() => {
      this.active.delete(invocation.invocation_id)
    })
    this.active.set(invocation.invocation_id, { task, controller })
    return task
  }

  private async complete(i: ObsidianInvocation, receipt: ObsidianExecutionReceipt): Promise<void> {
    const wireResult = { ...receipt.result }
    // The ordinary result store retains the full answer locally. Only its preview crosses
    // the bounded node protocol; read_result retrieves the rest through the same handler.
    delete wireResult.stored
    const result =
      JSON.stringify(wireResult).length <= 65536
        ? wireResult
        : {
            content: [
              {
                type: 'text',
                text: 'The tool finished, but its result exceeds the node size limit. Request a smaller page or passage. Do not repeat a mutation to retrieve its output.',
              },
            ],
          }
    await this.host.request(method('complete'), {
      invocation_id: i.invocation_id,
      client_id: this.host.clientId,
      revision: i.revision,
      state: receipt.state,
      result,
    })
  }

  private async perform(i: ObsidianInvocation, signal: AbortSignal): Promise<void> {
    const hosted = i.tool_name === 'questions' || i.tool_name === 'delegate'
    const openHosted = async () => {
      if (i.tool_name === 'questions')
        await this.host.request(method('questions.open'), {
          invocation_id: i.invocation_id,
          client_id: this.host.clientId,
          revision: i.revision,
        })
      else if (this.host.hosted) await this.host.hosted(i, signal)
      else throw new Error('The node conversation host is unavailable')
    }
    // Hosted calls own their terminal result on the node, including the claim/open crash gap.
    if (hosted && ['reconcile', 'hosted', 'cancel'].includes(i.action)) {
      if (i.action !== 'cancel' && !i.cancel_requested) await openHosted()
      else if (i.tool_name === 'delegate') await this.host.hosted?.(i, signal)
      return
    }
    const saved = await this.host.receipt(i.invocation_id)
    if (saved || i.action === 'reconcile' || (i.action === 'cancel' && i.state === 'executing')) {
      const receipt =
        saved && saved.state !== 'executing'
          ? saved
          : unknownResult(
              'Execution was claimed but its result could not be confirmed. Check the affected files before requesting another action.'
            )
      if (receipt !== saved) await this.host.save(i.invocation_id, receipt)
      await this.complete(i, receipt)
      return
    }
    if (i.action === 'cancel' || i.cancel_requested || this.disposed) return
    if (i.action === 'waiting_approval') return
    const adapter = await this.host.resolve(i)
    if (!adapter || adapter.revision !== i.revision) {
      await this.host.request(method('cancel'), { invocation_id: i.invocation_id })
      return
    }
    let refusal: ObsidianNotExecuted | undefined
    let prepared: Awaited<ReturnType<ObsidianToolAdapter['prepare']>>
    try {
      prepared = await adapter.prepare(i)
    } catch (error) {
      if (!(error instanceof ObsidianNotExecuted)) throw error
      refusal = error
      prepared = { preview: { error: error.message }, needsApproval: false }
    }
    signal.throwIfAborted()
    if (
      i.action === 'prepare' ||
      !equal(i.preview, prepared.preview) ||
      (i.prepared_needs_approval ?? false) !== prepared.needsApproval
    ) {
      await this.host.request(method('prepare'), {
        invocation_id: i.invocation_id,
        client_id: this.host.clientId,
        revision: i.revision,
        preview: prepared.preview,
        needs_approval: prepared.needsApproval,
      })
      return
    }
    const claim = (await this.host.request(method('claim'), {
      invocation_id: i.invocation_id,
      client_id: this.host.clientId,
      revision: i.revision,
    })) as { execute: boolean; bypass?: boolean }
    if (claim.execute !== true) return
    // If this flush fails, nothing executes. The next poll reconciles the node's claim as unknown.
    await this.host.save(i.invocation_id, {
      state: 'executing',
      result: {},
      sessionId: i.session_id,
      runId: i.run_id,
    })
    if (hosted && !refusal) {
      signal.throwIfAborted()
      await openHosted()
      return
    }
    let receipt: ObsidianExecutionReceipt
    try {
      signal.throwIfAborted()
      if (refusal) throw refusal
      const result = await adapter.execute(i, claim.bypass === true, signal)
      receipt = { state: 'succeeded', result }
    } catch (error) {
      // Generic handlers may throw after a partial effect. A failure is not proof of no write.
      receipt = unknownResult(
        error instanceof Error ? error.message : 'Tool outcome could not be confirmed'
      )
      if (error instanceof ObsidianNotExecuted) receipt.state = 'failed'
    }
    receipt.sessionId = i.session_id
    receipt.runId = i.run_id
    receipt.at = Date.now()
    await this.host.save(i.invocation_id, receipt)
    await this.complete(i, receipt)
  }

  async destroy(): Promise<void> {
    this.disposed = true
    const active = [...this.active.values()]
    for (const entry of active) entry.controller.abort()
    await Promise.allSettled(active.map((entry) => entry.task))
  }
}
