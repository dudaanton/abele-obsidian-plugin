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
  private readonly denied = new Set<string>()
  private readonly stoppedParents = new Set<string>()
  private readonly wakeEpochs = new Map<string, number>()
  constructor(
    readonly client: NodeClient,
    readonly store: NodeClientStore
  ) {}

  /** Server subscriptions belong to a transport, never to this controller's lifetime. */
  connectionChanged() { this.subscribed.clear(); this.denied.clear() }

  /** Synchronous fence first; durable waiter removal is serialized with status writes. */
  stopParent(parent: string): Promise<void> {
    this.stoppedParents.add(parent)
    this.wakeEpochs.set(parent, (this.wakeEpochs.get(parent) ?? 0) + 1)
    return this.store.transaction((s) => {
      for (const task of Object.values(storage(s).tasks))
        if (task.parentId === parent) task.awaitingResult = false
    })
  }
  /** Only an explicitly resumed parent turn can arm new waiters after Stop. */
  resumeParent(parent: string): void { this.stoppedParents.delete(parent) }

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
    const grants = (await this.grants()).filter((g) => !g.revoked && g.parent_id === parent)
    if (!grants.length) return []
    const providers = nodeProviders(await this.client.describe()).filter(providerAvailable)
    const allowed = new Set(grants.flatMap((g) => g.project_ids))
    const projects = new Map<string, { project_id: string; root_path: string }>()
    let after: string | undefined
    while (projects.size < allowed.size) {
      const page = await this.client.listProjects(after)
      if (!page.length) break
      for (const project of page)
        if (allowed.has(project.project_id))
          projects.set(project.project_id, {
            project_id: project.project_id,
            root_path: project.root_path,
          })
      const next = page.at(-1)!.project_id
      if (next === after) throw new Error('Node project pagination did not advance')
      after = next
    }
    return grants.map((g) => ({
      project_ids: g.project_ids,
      projects: g.project_ids.map((id) => projects.get(id) ?? { project_id: id }),
      providers: g.providers.filter(
        (p) => providers.some((v) => v.provider === p) && (p !== 'fake' || g.allow_fake)
      ),
      actions: g.actions,
    }))
  }
  async create(parent: string, raw: DelegationTaskInput, signal?: AbortSignal) {
    const input = DelegationTaskInputSchema.parse(raw)
    const key = await taskKey(parent, input.task_key)
    if (signal?.aborted) throw new Error('Delegation call cancelled')
    const request = await this.store.transaction((s) => {
      const local = storage(s)
      const previous = local.tasks[key]
      if (previous) {
        if (previous.cancelled) throw new Error('Delegation call cancelled; use a new task key')
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
    let child: Awaited<ReturnType<NodeClient['createDelegation']>> | undefined
    const retainCancellation = () => this.store.transaction((s) => {
      const task = storage(s).tasks[key]
      task.cancelled = true
      // A failed child-record write must not lose an already accepted child identity.
      if (child && !task.child) task.child = child
    })
    let cancelling: Promise<void> | undefined
    const onAbort = () => {
      // Start durable intent on Stop itself, independently of whether an outstanding
      // create/write/subscription ever resolves. Never request remote cancellation first.
      cancelling = retainCancellation().then(async () => {
        if (child) await this.cancelAborted(key, child.delegation_id)
      })
      void cancelling.catch(() => { /* The finally path retries a failed intent write. */ })
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      if (signal?.aborted) throw new Error('Delegation call cancelled')
      const available = nodeProviders(await this.client.describe()).some(
        (p) => p.provider === input.provider && providerAvailable(p)
      )
      if (signal?.aborted) throw new Error('Delegation call cancelled')
      if (!available) throw new Error('Provider unavailable on this node')
      // Exact retained body even when a prior reply was lost. Node deduplicates the task key.
      child = await this.client.createDelegation(request)
      await this.store.transaction((s) => {
        const task = storage(s).tasks[key]
        if (!task.cancelSettled) task.child = child
      })
      if (signal?.aborted) throw new Error('Delegation call cancelled')
      await this.client.subscribeDelegation(child)
      if (signal?.aborted) throw new Error('Delegation call cancelled')
      return this.publicChild(child)
    } finally {
      try {
        if (signal?.aborted) {
          await cancelling?.catch(() => {})
          // Also covers Stop during the child write and rejection of subscription;
          // persist the known child before another await can fail or the call unwinds.
          await retainCancellation()
          if (child) await this.cancelAborted(key, child.delegation_id)
        }
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    }
  }
  private async commitCancellation(key: string, id: string) {
    const cancelled = await this.client.cancelDelegation(id)
    await this.store.transaction((s) => {
      const task = storage(s).tasks[key]
      task.cancelSettled = true
      if (task.child) task.child.state = cancelled.state
      if (task.status) task.status = { ...task.status, state: cancelled.state }
    })
    return cancelled
  }
  private async cancelAborted(key: string, id: string) {
    try {
      if (await this.store.transaction((s) => storage(s).tasks[key].cancelSettled)) return
      await this.commitCancellation(key, id)
    } catch { /* Retain the intent for retry on restore. */ }
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
    const wakeEpoch = this.wakeEpochs.get(parent) ?? 0
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
    const delivered = await this.store.transaction((s) => {
      const cursor = s.cursors[status.mailbox_stream_id] ?? 0
      const events = s.events[status.mailbox_stream_id] ?? []
      return cursor >= status.mailbox_head_seq &&
        (status.state !== 'completed' || events.some((e) => e.type === 'delegation.result' &&
          (e.data as { delegation_id?: string }).delegation_id === id))
    })
    if (status.state === 'completed')
      await this.store.transaction((s) => {
        const task = Object.values(storage(s).tasks).find((t) => t.child?.delegation_id === id)
        if (task) task.awaitingResult = !delivered && !this.stoppedParents.has(parent) &&
          wakeEpoch === (this.wakeEpochs.get(parent) ?? 0)
      })
    const card = canRead ? (await this.cards(parent)).find((c) => c.delegationId === id) : undefined
    return {
      ...this.publicChild(status),
      state: status.state === 'completed' && !delivered ? 'receiving mailbox' : status.state,
      session_head_seq: status.session_head_seq,
      pending_human_prompts: status.pending_human_prompts,
      reports: card?.reports ?? [],
    }
  }
  async send(parent: string, id: string, text: string, signal?: AbortSignal) {
    await this.owned(parent, id, 'send')
    if (signal?.aborted) throw new Error('Delegation call cancelled')
    const status = await this.client.delegationStatus(id)
    if (signal?.aborted) throw new Error('Delegation call cancelled')
    return this.client.sendDelegation(id, text, status.session_head_seq)
  }
  async cancel(parent: string, id: string) {
    const child = await this.owned(parent, id, 'cancel')
    // Also covers Stop racing the tool wrapper's post-create refresh, after create's
    // signal listener has been released. A disconnected cancel still has durable intent.
    await this.store.transaction((s) => { storage(s).tasks[child.delegation_key].cancelled = true })
    return this.publicChild(await this.commitCancellation(child.delegation_key, id))
  }
  /** Recover receipts before subscribing. Does not depend on an open parent/child tab. */
  async restore() {
    const { children, cancellations } = await this.store.transaction((s) => {
      const local = storage(s)
      // Retry waiter clearing if Stop's initial durable write failed.
      for (const task of Object.values(local.tasks))
        if (this.stoppedParents.has(task.parentId)) task.awaitingResult = false
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
              !task.cancelSettled &&
              task.parentId === child.data.parent_id &&
              task.request.grant_id === child.data.grant_id
            )
              task.child = child.data
          }
        }
      }
      return {
        children: Object.values(local.tasks).flatMap((t) =>
          t.child && !t.cancelled && !local.grants[t.child.grant_id]?.revoked ? [t.child] : []
        ),
        cancellations: Object.entries(local.tasks).flatMap(([key, t]) =>
          t.child && t.cancelled && !t.cancelSettled ? [{ key, id: t.child.delegation_id }] : []
        ),
      }
    })
    if (this.client.connected) {
      await Promise.all(cancellations.map(({ key, id }) => this.cancelAborted(key, id)))
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
          .filter((c) => !this.subscribed.has(c.mailbox_stream_id) && !this.denied.has(c.mailbox_stream_id))
          .map(async (c) => {
            try {
              await this.client.subscribeDelegation(c)
              this.subscribed.add(c.mailbox_stream_id)
            } catch {
              // One revoked grant cannot prevent unrelated mailboxes from recovering.
              // Retry on the next connection, not on every foreground tick.
              this.denied.add(c.mailbox_stream_id)
            }
          })
      )
    }
  }
  /** Wake only a waiting model, once the result is durably present in its parent card. */
  async wakeDelivered(cards: Record<string, DelegationCard[]>, wake: (parent: string, id: string) => boolean): Promise<void> {
    const epochs = new Map(this.wakeEpochs)
    const pending = await this.store.transaction((s) => Object.entries(storage(s).tasks)
      .filter(([, task]) => task.awaitingResult && task.child)
      .map(([key, task]) => ({ key, parent: task.parentId, id: task.child!.delegation_id })))
    for (const { key, parent, id } of pending) {
      // Stop may have won after enumeration but before dispatch (or before a new
      // explicit turn). Neither a stale snapshot nor that new turn revives this wake.
      if (this.stoppedParents.has(parent) ||
        (epochs.get(parent) ?? 0) !== (this.wakeEpochs.get(parent) ?? 0)) continue
      const card = cards[parent]?.find((c) => c.delegationId === id)
      if (card?.state === 'completed' && card.reports.some((r) => r.kind === 'result') && wake(parent, id))
        await this.store.transaction((s) => { storage(s).tasks[key].awaitingResult = false })
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
          // Session status can arrive before the independent mailbox replay. Do not
          // announce settled parent delivery while its result/terminal bytes are still
          // outstanding; the mailbox's committed terminal event settles this card.
          if (
            child &&
            t.status &&
            ['completed', 'failed', 'cancelled', 'unknown'].includes(t.status.state) &&
            (s.cursors[child.mailbox_stream_id] ?? 0) < t.status.mailbox_head_seq
          )
            state = `${t.status.state} · receiving mailbox`
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
