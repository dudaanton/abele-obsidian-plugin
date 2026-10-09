import type {
  NodeClient,
  DelegationGrantRequest,
  DelegationCreateRequest,
} from '@abele/node-client'
import { DelegationSchema, DelegationGrantSchema } from '@abele/node-protocol'
import type { NodeClientStore, NodeClientState } from './NodeClientStore'
import {
  DelegationTaskInputSchema,
  type DelegationTaskInput,
  type DelegationCard,
} from './delegation'
import { nodeProviders, providerAvailable } from './providers'

function storage(state: NodeClientState) {
  return (state.delegation ??= { grants: {}, tasks: {} })
}
async function taskKey(parent: string, key: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([parent, key]))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return (
    'plugin-' + Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
  )
}

/** Provider-neutral trusted controller. No Obsidian, secrets, generic RPC or prompt answers. */
export class NodeDelegationController {
  private readonly subscribed = new Set<string>()
  constructor(
    readonly client: NodeClient,
    readonly store: NodeClientStore
  ) {}

  /** Owner UI only. These methods are deliberately absent from the model tools. */
  async approve(params: DelegationGrantRequest) {
    const grant = await this.client.approveDelegationGrant(params)
    await this.store.transaction((s) => {
      storage(s).grants[grant.grant_id] = grant
    })
    return grant
  }
  async revoke(id: string) {
    const grant = await this.client.revokeDelegationGrant(id)
    await this.store.transaction((s) => {
      storage(s).grants[id] = grant
    })
    return grant
  }
  grants() {
    return this.store.transaction((s) => Object.values(storage(s).grants))
  }
  async destinations(parent: string) {
    const providers = nodeProviders(await this.client.describe()).filter(providerAvailable)
    return (await this.grants())
      .filter((g) => !g.revoked && g.parent_id === parent)
      .map((g) => ({
        project_ids: g.project_ids,
        providers: g.providers.filter(
          (p) => providers.some((v) => v.provider === p) && (p !== 'fake' || g.allow_fake)
        ),
        actions: g.actions,
      }))
  }
  async create(parent: string, raw: DelegationTaskInput) {
    const input = DelegationTaskInputSchema.parse(raw)
    const key = await taskKey(parent, input.task_key)
    const request = await this.store.transaction((s) => {
      const local = storage(s)
      const previous = local.tasks[key]
      if (previous) {
        if (JSON.stringify(previous.input) !== JSON.stringify(input))
          throw new Error('idempotency_mismatch: preserve the same task key and body')
        this.requireGrant(s, previous.request.grant_id, parent, 'create')
        return previous.request
      }
      const grant = Object.values(local.grants).find(
        (g) =>
          !g.revoked &&
          g.parent_id === parent &&
          g.actions.includes('create') &&
          g.providers.includes(input.provider) &&
          (input.provider !== 'fake' || g.allow_fake) &&
          (!input.project_id ? input.provider === 'fake' : g.project_ids.includes(input.project_id))
      )
      if (!grant)
        throw new Error(
          'Owner delegation grant required in Settings → Nodes for this parent, project and provider'
        )
      const { task_key: _key, ...body } = input
      const request: DelegationCreateRequest = {
        ...body,
        grant_id: grant.grant_id,
        delegation_key: key,
      }
      local.tasks[key] = { parentId: parent, input, request }
      return request
    })
    const available = nodeProviders(await this.client.describe()).some(
      (p) => p.provider === input.provider && providerAvailable(p)
    )
    if (!available) throw new Error('Provider unavailable on this node')
    // Exact retained body even when a prior reply was lost. Node deduplicates the task key.
    const child = await this.client.createDelegation(request)
    await this.store.transaction((s) => {
      storage(s).tasks[key].child = child
    })
    await this.client.subscribeDelegation(child)
    return this.publicChild(child)
  }
  private publicChild(child: {
    node_id: string
    session_id: string
    delegation_id: string
    state: string
  }) {
    return {
      node_id: child.node_id,
      session_id: child.session_id,
      delegation_id: child.delegation_id,
      state: child.state,
    }
  }
  private requireGrant(s: NodeClientState, id: string, parent: string, action: string) {
    const grant = storage(s).grants[id]
    if (
      !grant ||
      grant.revoked ||
      grant.parent_id !== parent ||
      !grant.actions.some((a) => a === action)
    )
      throw new Error('Owner delegation grant required or revoked')
    return grant
  }
  private owned(parent: string, id: string, action: string) {
    return this.store.transaction((s) => {
      const task = Object.values(storage(s).tasks).find(
        (t) => t.parentId === parent && t.child?.delegation_id === id
      )
      if (!task?.child) throw new Error('Delegation does not belong to this parent chat')
      this.requireGrant(s, task.child.grant_id, parent, action)
      return task.child
    })
  }
  async status(parent: string, id: string) {
    await this.owned(parent, id, 'status')
    const status = await this.client.delegationStatus(id)
    await this.store.transaction((s) => {
      const task = Object.values(storage(s).tasks).find((t) => t.child?.delegation_id === id)!
      task.status = status
    })
    // Read rights are separate from status rights. A mailbox request rechecks current
    // node authority before cached report text is returned to a model.
    const canRead = await this.store.transaction(
      (s) => storage(s).grants[status.grant_id]?.actions.includes('read') === true
    )
    if (canRead) await this.client.subscribeDelegation(status)
    const card = canRead ? (await this.cards(parent)).find((c) => c.delegationId === id) : undefined
    return {
      ...this.publicChild(status),
      session_head_seq: status.session_head_seq,
      pending_human_prompts: status.pending_human_prompts,
      reports: card?.reports ?? [],
    }
  }
  async send(parent: string, id: string, text: string) {
    await this.owned(parent, id, 'send')
    const status = await this.client.delegationStatus(id)
    return this.client.sendDelegation(id, text, status.session_head_seq)
  }
  async cancel(parent: string, id: string) {
    await this.owned(parent, id, 'cancel')
    return this.publicChild(await this.client.cancelDelegation(id))
  }
  /** Recover receipts before subscribing. Does not depend on an open parent/child tab. */
  async restore() {
    const children = await this.store.transaction((s) => {
      const local = storage(s)
      for (const receipt of Object.values(s.results)) {
        const method = receipt.request?.method
        if (method === 'delegation.grant.create' || method === 'delegation.grant.revoke') {
          const parsed = DelegationGrantSchema.safeParse(receipt.result)
          if (parsed.success) {
            const old = local.grants[parsed.data.grant_id]
            // Replaying an old approval must not revive a later revocation.
            if (!old?.revoked) local.grants[parsed.data.grant_id] = parsed.data
          }
        }
        if (method === 'delegation.create') {
          const child = DelegationSchema.safeParse(receipt.result)
          if (child.success) {
            const task = local.tasks[child.data.delegation_key]
            if (
              task &&
              task.parentId === child.data.parent_id &&
              task.request.grant_id === child.data.grant_id
            )
              task.child = child.data
          }
        }
      }
      return Object.values(local.tasks).flatMap((t) =>
        t.child && !local.grants[t.child.grant_id]?.revoked ? [t.child] : []
      )
    })
    if (this.client.connected) {
      // A parent need not subscribe to every child tool event to show running state
      // or direct a human to a pending permission/extension question.
      await Promise.all(
        children.map(async (child) => {
          const current = await this.store.transaction(
            (s) => storage(s).tasks[child.delegation_key].status?.state
          )
          if (current && ['completed', 'failed', 'cancelled', 'unknown'].includes(current)) return
          try {
            const status = await this.client.delegationStatus(child.delegation_id)
            await this.store.transaction((s) => {
              storage(s).tasks[child.delegation_key].status = status
            })
          } catch {
            /* Revoked or offline resources retain their last durable projection. */
          }
        })
      )
      await Promise.all(
        children
          .filter((c) => !this.subscribed.has(c.mailbox_stream_id))
          .map(async (c) => {
            await this.client.subscribeDelegation(c)
            this.subscribed.add(c.mailbox_stream_id)
          })
      )
    }
  }
  async snapshot(): Promise<Record<string, DelegationCard[]>> {
    const parents = await this.store.transaction((s) => [
      ...new Set(Object.values(storage(s).tasks).map((t) => t.parentId)),
    ])
    return Object.fromEntries(
      await Promise.all(parents.map(async (parent) => [parent, await this.cards(parent)]))
    )
  }
  /** Replaceable projection: replay never appends a second parent message/result. */
  cards(parent: string): Promise<DelegationCard[]> {
    return this.store.transaction((s) =>
      Object.values(storage(s).tasks)
        .filter((t) => t.parentId === parent)
        .map((t) => {
          const child = t.child
          const events = child ? (s.events[child.mailbox_stream_id] ?? []) : []
          const reports: DelegationCard['reports'] = []
          let state: string = t.status?.state ?? child?.state ?? 'outcome unknown'
          for (const event of events) {
            const data = event.data as { delegation_id?: string; state?: string; text?: string }
            if (data.delegation_id !== child?.delegation_id) continue
            if (event.type === 'delegation.terminal' && data.state) state = data.state
            if (
              ['delegation.progress', 'delegation.question', 'delegation.result'].includes(
                event.type
              ) &&
              typeof data.text === 'string' &&
              !reports.some((r) => r.seq === event.seq)
            )
              reports.push({ seq: event.seq, kind: event.type.slice(11), text: data.text })
          }
          if (child && storage(s).grants[child.grant_id]?.revoked) state = 'grant revoked'
          return {
            title: t.input.title,
            provider: t.input.provider,
            delegationId: child?.delegation_id,
            sessionId: child?.session_id,
            nodeId: child?.node_id,
            state,
            pendingHumanPrompts: ['completed', 'failed', 'cancelled', 'unknown'].includes(state)
              ? 0
              : (t.status?.pending_human_prompts ?? 0),
            reports,
          }
        })
    )
  }
}
