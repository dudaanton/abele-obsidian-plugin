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
  action: 'prepare' | 'claim' | 'waiting_approval' | 'reconcile' | 'cancel'
}

export interface ObsidianExecutionReceipt {
  state: 'executing' | 'succeeded' | 'failed' | 'outcome_unknown'
  result: Record<string, unknown>
}

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
    await this.host.request(method('complete'), {
      invocation_id: i.invocation_id,
      client_id: this.host.clientId,
      revision: i.revision,
      state: receipt.state,
      result: receipt.result,
    })
  }

  private async perform(i: ObsidianInvocation, signal: AbortSignal): Promise<void> {
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
    const prepared = await adapter.prepare(i)
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
    await this.host.save(i.invocation_id, { state: 'executing', result: {} })
    let receipt: ObsidianExecutionReceipt
    try {
      signal.throwIfAborted()
      const result = await adapter.execute(i, claim.bypass === true, signal)
      receipt = { state: 'succeeded', result }
    } catch (error) {
      // Generic handlers may throw after a partial effect. A failure is not proof of no write.
      receipt = unknownResult(
        error instanceof Error ? error.message : 'Tool outcome could not be confirmed'
      )
    }
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
