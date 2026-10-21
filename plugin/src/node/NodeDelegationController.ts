import type { NodeClient, Prompt } from '@abele/node-client'
import {
  DelegationSchema,
  DelegationSendResultSchema,
  type ExpectedExecutionTarget,
  type ObsidianToolsSnapshot,
} from '@abele/node-protocol'
import {
  supportsExpectedTarget,
  readChatBinding,
  expectedBinding,
  chatMovedNotice,
} from './expectedTarget'
import type { NodeClientStore, NodeClientState } from './NodeClientStore'
import { readStore } from './NodeClientStore'
import { requireGrantFreeDelegation } from './delegationCapability'
import {
  DelegationTaskInputSchema,
  type DelegationTaskInput,
  type DelegationCard,
  type DelegationRequest,
} from './delegation'
import { delegatable, nodeProviders, providerAvailable } from './providers'
import { pendingOwnerPrompts, promptAnswerStates } from './promptAnswers'
import { reduceTranscript } from './NodeTranscriptReducer'
import { openWindow, catchUp } from './sessionWindow'
import {
  ownerPermissionPatch,
  readToolPermissions,
  permissionRefusal,
  legacyProviderRefusal,
  delegatedPermissionMode,
} from './toolPermissions'

/** Child-authored text is quoted data, including any attempted quote/block delimiters. */
function developerData(value: string): string {
  const bounded = value.length > 800 ? `${value.slice(0, 800)}…` : value
  const quoted = JSON.stringify(bounded).replace(/[<>“”`\p{Cf}\u2028\u2029]/gu, (char) =>
    char
      .split('')
      .map((part) => `\\u${part.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join('')
  )
  return `<developer-data>${quoted}</developer-data>`
}

function storage(state: NodeClientState) {
  return (state.delegation ??= { tasks: {} })
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
  ownerPermissionMode?: (provider: string) => string | undefined
  ownerNodeId?: string
  /** Trusted owner snapshot; never read from the model's delegation arguments. */
  obsidianSnapshot?: (
    parent: string,
    provider: string
  ) => Promise<ObsidianToolsSnapshot | undefined>
  configureChildTools?: (session: string, provider: string) => Promise<void>
  private readonly subscribed = new Set<string>()
  private readonly pendingPrompts = new Map<string, Prompt[]>()
  private readonly denied = new Set<string>()
  private readonly stoppedParents = new Set<string>()
  private readonly wakeEpochs = new Map<string, number>()
  private readonly targets = new Map<string, ExpectedExecutionTarget | null>()
  private readonly statusCheckedAt = new Map<string, number>()
  private readonly workspaces = new Map<
    string,
    { branch?: string; files: string[]; state: string; checkedAt: number }
  >()
  constructor(
    readonly client: NodeClient,
    readonly store: NodeClientStore
  ) {}

  /** Server subscriptions belong to a transport, never to this controller's lifetime. */
  connectionChanged() {
    this.subscribed.clear()
    this.pendingPrompts.clear()
    this.denied.clear()
    this.statusCheckedAt.clear()
  }

  /** Synchronous fence first; durable waiter removal is serialized with status writes. */
  stopParent(parent: string): Promise<void> {
    this.stoppedParents.add(parent)
    this.wakeEpochs.set(parent, (this.wakeEpochs.get(parent) ?? 0) + 1)
    return this.store.transaction((s) => {
      for (const task of Object.values(storage(s).tasks))
        if (task.parentId === parent) {
          task.awaitingResult = false
          task.parentStopped = true
        }
    })
  }
  /** Only an explicitly resumed parent turn can arm new waiters after Stop. */
  resumeParent(parent: string): void {
    this.stoppedParents.delete(parent)
  }

  async destinations(_parent: string) {
    const providers = nodeProviders(await this.client.describe())
      .filter(delegatable)
      .filter(providerAvailable)
      .map((p) => p.provider)
    const projects: { project_id: string; root_path: string }[] = []
    let after: string | undefined
    while (true) {
      const page = await this.client.listProjects(after)
      if (!page.length) break
      projects.push(...page.map(({ project_id, root_path }) => ({ project_id, root_path })))
      const next = page.at(-1)!.project_id
      if (next === after) throw new Error('Node project pagination did not advance')
      after = next
    }
    return [
      {
        project_ids: projects.map((p) => p.project_id),
        projects,
        providers,
        actions: ['create', 'send', 'status', 'cancel', 'read'],
      },
    ]
  }
  async create(
    parent: string,
    raw: DelegationTaskInput,
    signal?: AbortSignal,
    parentMode?: string
  ) {
    const input = DelegationTaskInputSchema.parse(raw)
    const description = await this.client.describe()
    const ownerMode = delegatedPermissionMode(
      this.ownerPermissionMode?.(input.provider),
      parentMode
    )
    requireGrantFreeDelegation(description)
    const key = await taskKey(parent, input.task_key)
    const retained = await readStore(this.store, (state) => state.delegation?.tasks[key]?.request)
    const obsidian =
      !retained && this.obsidianSnapshot
        ? await this.obsidianSnapshot(parent, input.provider)
        : undefined
    if (signal?.aborted) throw new Error('Delegation call cancelled')
    const request = await this.store.transaction((s) => {
      const local = storage(s)
      const previous = local.tasks[key]
      if (previous) {
        if (previous.cancelled) throw new Error('Delegation call cancelled; use a new task key')
        if (JSON.stringify(previous.input) !== JSON.stringify(input))
          throw new Error('idempotency_mismatch: preserve the same task key and body')
        return previous.request
      }
      const { task_key: _key, ...body } = input
      const request: DelegationRequest = {
        ...body,
        ...ownerPermissionPatch(description, ownerMode),
        parent_id: parent,
        delegation_key: key,
        ...(obsidian ? { obsidian_tools: obsidian } : {}),
      }
      local.tasks[key] = {
        parentId: parent,
        input,
        request,
        awaitingResult: !this.stoppedParents.has(parent),
      }
      return request
    })
    let child: Awaited<ReturnType<NodeClient['createDelegation']>> | undefined
    const retainCancellation = () =>
      this.store.transaction((s) => {
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
      void cancelling.catch(() => {
        /* The finally path retries a failed intent write. */
      })
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      if (signal?.aborted) throw new Error('Delegation call cancelled')
      const available = nodeProviders(description).some(
        (p) => p.provider === input.provider && delegatable(p) && providerAvailable(p)
      )
      if (signal?.aborted) throw new Error('Delegation call cancelled')
      if (!available) throw new Error('Provider unavailable on this node')
      const refusal = legacyProviderRefusal(description, input.provider, ownerMode)
      if (refusal) throw new Error(refusal)
      // Exact retained body even when a prior reply was lost. Node deduplicates the task key.
      child = await this.client.createDelegation(request)
      await this.store.transaction((s) => {
        const task = storage(s).tasks[key]
        if (!task.cancelSettled) task.child = child
        delete task.permissionRefusal
      })
      await this.configureChildTools?.(child.session_id, input.provider)
      if (signal?.aborted) throw new Error('Delegation call cancelled')
      try {
        await this.client.subscribeDelegation(child)
        await this.observeTarget(child.delegation_id, child.session_id)
      } catch (error) {
        // The create receipt is already durable. A read failure cannot undo accepted work.
        console.debug('[Abele node] accepted child awaits activity refresh', error)
      }
      if (signal?.aborted) throw new Error('Delegation call cancelled')
      return { ...this.publicChild(child), project_id: input.project_id, title: input.title }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (!child && permissionRefusal(reason)) {
        await this.store.transaction((s) => {
          storage(s).tasks[key].permissionRefusal = reason
        })
        return { state: 'unsupported', reason }
      }
      if (
        !child &&
        error instanceof Error &&
        /^(resource_busy|outcome_unknown|disconnected)(:|$)/.test(error.message)
      )
        throw new Error(
          `outcome_unknown (${error.message}): The developer may have started. Check status with node_delegations before retrying; retain the same task_key and exact body.`
        )
      throw error
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
    } catch {
      /* Retain the intent for retry on restore. */
    }
  }
  private publicChild(child: {
    node_id: string
    session_id: string
    delegation_id: string
    state: string
    workspace_id?: string | null
  }) {
    return {
      node_id: child.node_id,
      session_id: child.session_id,
      delegation_id: child.delegation_id,
      state: child.state,
      tool_permissions: readToolPermissions(child),
      workspace_id: child.workspace_id ?? null,
      worktree_id: (() => {
        const binding = this.targets.get(child.delegation_id)?.target
        return binding?.kind === 'worktree' ? binding.worktree_id : null
      })(),
    }
  }
  private owned(parent: string, id: string, _action: string) {
    return this.store.transaction((s) => {
      const task = Object.values(storage(s).tasks).find(
        (t) => t.parentId === parent && t.child?.delegation_id === id
      )
      if (!task?.child) throw new Error('Delegation does not belong to this parent chat')
      return task.child
    })
  }
  /** A parent may review its own child's copy; this never grants edit authority. */
  async childReadGuard(
    parent: string,
    project: string,
    target: string
  ): Promise<(() => Promise<void>) | undefined> {
    const children = await this.store.transaction((s) =>
      Object.values(storage(s).tasks)
        .filter(
          (task) =>
            task.parentId === parent &&
            task.input.project_id === project &&
            task.child?.workspace_id
        )
        .map((task) => task.child!)
    )
    if (!children.length) return
    let workspace = target
    if (!children.some((child) => child.workspace_id === target)) {
      let cursor: string | undefined
      for (let page = 0; page < 64; page++) {
        const result = await this.client.repository.worktrees({
          project_id: project,
          cursor,
          limit: 256,
        })
        const row = result.entries.find((entry) => entry.worktree_id === target)
        if (row) {
          workspace = row.workspace_id ?? ''
          break
        }
        if (!result.cursor || result.cursor === cursor) break
        cursor = result.cursor
      }
    }
    const child = children.find((child) => child.workspace_id === workspace)
    if (!child) return
    await this.owned(parent, child.delegation_id, 'read')
    // Recheck node authority before using locally retained child identity.
    await this.client.subscribeDelegation(child)
    return async () => {
      const current = await this.owned(parent, child.delegation_id, 'read')
      if (current.workspace_id !== workspace) throw new Error('Child workspace changed')
    }
  }
  private async observeTarget(id: string, session: string): Promise<void> {
    if (!supportsExpectedTarget(await this.client.describe())) {
      this.targets.delete(id)
      return
    }
    const binding = await readChatBinding(this.client, session)
    if (binding === null) this.targets.set(id, null)
    else {
      const expected = expectedBinding(binding)
      if (!expected) throw new Error('The delegated chat target is not ready. Nothing was sent.')
      this.targets.set(id, expected)
    }
  }
  async status(parent: string, id: string) {
    const wakeEpoch = this.wakeEpochs.get(parent) ?? 0
    await this.owned(parent, id, 'status')
    const status = await this.client.delegationStatus(id)
    await this.observeTarget(id, status.session_id)
    await this.store.transaction((s) => {
      const task = Object.values(storage(s).tasks).find((t) => t.child?.delegation_id === id)!
      task.status = status
    })
    const canRead = true
    await this.client.subscribeDelegation(status)
    const delivered = await this.store.transaction((s) => {
      const cursor = s.cursors[status.mailbox_stream_id] ?? 0
      const events = s.events[status.mailbox_stream_id] ?? []
      return (
        cursor >= status.mailbox_head_seq &&
        (status.state !== 'completed' ||
          events.some(
            (e) =>
              e.type === 'delegation.result' &&
              (e.data as { delegation_id?: string }).delegation_id === id
          ))
      )
    })
    if (status.state === 'completed')
      await this.store.transaction((s) => {
        const task = Object.values(storage(s).tasks).find((t) => t.child?.delegation_id === id)
        if (task)
          task.awaitingResult =
            !delivered &&
            !this.stoppedParents.has(parent) &&
            wakeEpoch === (this.wakeEpochs.get(parent) ?? 0)
      })
    const card = canRead ? (await this.cards(parent)).find((c) => c.delegationId === id) : undefined
    return {
      ...this.publicChild(status),
      project_id: card?.projectId,
      title: card?.title,
      branch: card?.branch,
      activity: card?.activity,
      state: status.state === 'completed' && !delivered ? 'receiving mailbox' : status.state,
      session_head_seq: status.session_head_seq,
      reason: status.reason,
      pending_human_prompts: status.pending_human_prompts,
      reports: card?.reports ?? [],
    }
  }
  async send(parent: string, id: string, text: string, signal?: AbortSignal) {
    // Use the child binding last projected to its parent, not a send-time target lookup.
    const displayed = this.targets.get(id)
    const expected = displayed && structuredClone(displayed)
    const child = await this.owned(parent, id, 'send')
    if (signal?.aborted) throw new Error('Delegation call cancelled')
    const description = await this.client.describe()
    const guarded = supportsExpectedTarget(description)
    if (guarded && displayed === undefined) {
      await this.observeTarget(id, child.session_id)
      throw new Error(
        'The delegated chat target is not ready. Nothing was sent. Check its status before sending again.'
      )
    }
    const status = await this.client.delegationStatus(id)
    if (signal?.aborted) throw new Error('Delegation call cancelled')
    const result =
      guarded && expected
        ? await this.client.sendDelegation(id, text, status.session_head_seq, expected)
        : await this.client.sendDelegation(id, text, status.session_head_seq)
    if ('code' in result) {
      await this.observeTarget(id, child.session_id).catch(() => {
        console.debug('[Abele node] delegation target refresh failed after refusal')
      })
      throw new Error(chatMovedNotice)
    }
    // A follow-up starts another turn in the same child. Do not retain the previous
    // terminal projection or cancellation waiter while its new mailbox catches up.
    await this.store.transaction((s) => {
      const task = Object.values(storage(s).tasks).find((t) => t.child?.delegation_id === id)!
      delete task.status
      Object.assign(task.child!, { tool_permissions: readToolPermissions(status) })
      task.child!.state = 'running'
      task.cancelled = false
      task.cancelSettled = false
      task.awaitingResult = !this.stoppedParents.has(parent)
      delete task.notifiedAttention
      task.followupMailboxSeq = status.mailbox_head_seq
      task.followupAcceptedSeq = result.accepted_seq
      task.parentStopped = this.stoppedParents.has(parent)
    })
    return result
  }
  async cancel(parent: string, id: string) {
    const child = await this.owned(parent, id, 'cancel')
    // Also covers Stop racing the tool wrapper's post-create refresh, after create's
    // signal listener has been released. A disconnected cancel still has durable intent.
    await this.store.transaction((s) => {
      storage(s).tasks[child.delegation_key].cancelled = true
    })
    return this.publicChild(await this.commitCancellation(child.delegation_key, id))
  }
  /** Recover receipts before subscribing. Does not depend on an open parent/child tab. */
  async restore() {
    const { children, cancellations } = await this.store.transaction((s) => {
      const local = storage(s)
      // Retry waiter clearing if Stop's initial durable write failed.
      for (const task of Object.values(local.tasks))
        if (this.stoppedParents.has(task.parentId)) {
          task.awaitingResult = false
          task.parentStopped = true
        }
      for (const receipt of Object.values(s.results)) {
        const method = receipt.request?.method
        if (method === 'delegation.send') {
          const reply = DelegationSendResultSchema.safeParse(receipt.result)
          const params = receipt.request?.params as { delegation_id?: string } | undefined
          const task = Object.values(local.tasks).find(
            (t) => t.child?.delegation_id === params?.delegation_id
          )
          if (
            task?.child &&
            reply.success &&
            !('code' in reply.data) &&
            reply.data.accepted_seq > (task.followupAcceptedSeq ?? 0)
          ) {
            task.followupAcceptedSeq = reply.data.accepted_seq
            // A newer observed status can include a later cancellation or an already
            // delivered result. Replaying an old send receipt must not undo either.
            if (task.status && task.status.session_head_seq >= reply.data.accepted_seq) {
              if (task.status.state === 'running' && !task.cancelled) {
                task.followupMailboxSeq = task.status.mailbox_head_seq
                task.awaitingResult = !task.parentStopped && !this.stoppedParents.has(task.parentId)
              }
            } else {
              task.followupMailboxSeq =
                task.status?.mailbox_head_seq ?? task.followupMailboxSeq ?? 0
              delete task.status
              task.child.state = 'running'
              // An unconfirmed Stop still has to reach the node. Only an older,
              // already settled cancellation is superseded by the accepted input.
              const cancelPending = task.cancelled === true && task.cancelSettled !== true
              task.cancelled = cancelPending
              task.cancelSettled = false
              task.awaitingResult =
                !cancelPending && !task.parentStopped && !this.stoppedParents.has(task.parentId)
            }
          }
        }
        if (method === 'delegation.create') {
          const child = DelegationSchema.safeParse(receipt.result)
          if (child.success) {
            const task = local.tasks[child.data.delegation_key]
            if (task && !task.cancelSettled && task.parentId === child.data.parent_id)
              task.child = child.data
          }
        }
      }
      return {
        children: Object.values(local.tasks).flatMap((t) =>
          t.child && !t.cancelled ? [t.child] : []
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
          if (
            current &&
            ['completed', 'failed', 'cancelled', 'unknown', 'stopped'].includes(current) &&
            Date.now() - (this.statusCheckedAt.get(child.delegation_id) ?? -Infinity) < 15000
          )
            return
          try {
            const status = await this.client.delegationStatus(child.delegation_id)
            this.statusCheckedAt.set(child.delegation_id, Date.now())
            await this.observeTarget(child.delegation_id, child.session_id)
            await this.store.transaction((s) => {
              const task = storage(s).tasks[child.delegation_key]
              if (!task.status || status.session_head_seq >= task.status.session_head_seq)
                task.status = status
            })
          } catch {
            /* Revoked or offline resources retain their last durable projection. */
          }
        })
      )
      await Promise.all(
        children
          .filter(
            (c) =>
              !this.subscribed.has(c.mailbox_stream_id) && !this.denied.has(c.mailbox_stream_id)
          )
          .map(async (c) => {
            try {
              await this.client.subscribeDelegation(c)
              this.subscribed.add(c.mailbox_stream_id)
            } catch {
              // One refused child cannot prevent unrelated mailboxes from recovering.
              // Retry on the next connection, not on every foreground tick.
              this.denied.add(c.mailbox_stream_id)
            }
          })
      )
      // One sequential read per child keeps the overview within the node's request
      // budget.
      for (const child of children) {
        const count = await this.store.transaction(
          (s) => storage(s).tasks[child.delegation_key].status?.pending_human_prompts
        )
        if (count === 0) this.pendingPrompts.delete(child.session_id)
        else if (count && typeof this.client.prompts === 'function') {
          try {
            this.pendingPrompts.set(
              child.session_id,
              await pendingOwnerPrompts(this.client, child.session_id)
            )
          } catch {
            console.debug('[Abele node] pending child prompts unavailable')
          }
        }
        try {
          if (!this.subscribed.has(child.session_id)) {
            const window = await openWindow(this.client, child.session_id)
            if (window) await catchUp(this.client, child.session_id, window.head)
            await this.client.subscribe(child.session_id)
            this.subscribed.add(child.session_id)
          }
          if (child.workspace_id) {
            const state = await this.store.transaction(
              (s) => storage(s).tasks[child.delegation_key].status?.state ?? child.state
            )
            const previous = this.workspaces.get(child.workspace_id)
            if (
              previous?.state === state &&
              (['completed', 'failed', 'unknown', 'cancelled', 'stopped'].includes(state) ||
                Date.now() - previous.checkedAt < 5000)
            )
              continue
            const workspace = await this.client.getWorkspace(child.workspace_id)
            const status = await this.client.workspaceStatus(child.workspace_id, 0, 20)
            this.workspaces.set(child.workspace_id, {
              branch: workspace.branch ?? undefined,
              files: status.entries.map((entry) => entry.path),
              state,
              checkedAt: Date.now(),
            })
          }
        } catch {
          console.debug('[Abele node] child activity unavailable')
        }
      }
    }
  }
  /** Wake only a waiting model, once the result is durably present in its parent card. */
  async wakeDelivered(
    cards: Record<string, DelegationCard[]>,
    wake: (parent: string, id: string, notice?: string) => boolean
  ): Promise<void> {
    const epochs = new Map(this.wakeEpochs)
    const pending = await this.store.transaction((s) =>
      Object.entries(storage(s).tasks)
        .filter(([, task]) => task.awaitingResult && task.child)
        .map(([key, task]) => ({
          key,
          parent: task.parentId,
          id: task.child!.delegation_id,
          notified: task.notifiedAttention,
        }))
    )
    for (const { key, parent, id, notified } of pending) {
      // Stop may have won after enumeration but before dispatch (or before a new
      // explicit turn). Neither a stale snapshot nor that new turn revives this wake.
      if (
        this.stoppedParents.has(parent) ||
        (epochs.get(parent) ?? 0) !== (this.wakeEpochs.get(parent) ?? 0)
      )
        continue
      const card = cards[parent]?.find((c) => c.delegationId === id)
      if (!card) continue
      const completed = card.state === 'completed' && card.reports.some((r) => r.kind === 'result')
      const terminal = ['failed', 'stopped', 'cancelled', 'unknown'].includes(card.state)
      const question = card.reports.findLast(
        (report) =>
          report.kind === 'question' && !report.text.startsWith('Waiting for owner approval.')
      )
      const attention = completed
        ? 'result'
        : terminal
          ? `${card.state}:${card.reason ?? ''}`
          : question
            ? `question:${question.seq}`
            : undefined
      if (!attention && notified && card.state === 'running')
        await this.store.transaction((s) => {
          delete storage(s).tasks[key].notifiedAttention
        })
      if (
        attention &&
        attention !== notified &&
        wake(
          parent,
          id,
          completed
            ? `Developer “${developerData(card.title)}” finished. Read node_delegation_status for the durable report.`
            : question && !terminal
              ? `Developer “${developerData(card.title)}” asks: ${developerData(question.text)}`
              : `Developer “${developerData(card.title)}” ${card.state}${card.reason ? ` (${developerData(card.reason)})` : ''}. Read node_delegation_status for details.`
        )
      )
        await this.store.transaction((s) => {
          storage(s).tasks[key].notifiedAttention = attention
          if (completed) storage(s).tasks[key].awaitingResult = false
        })
    }
  }

  async snapshot(): Promise<Record<string, DelegationCard[]>> {
    return readStore(this.store, (s) => {
      const parents = new Set(Object.values(s.delegation?.tasks ?? {}).map((t) => t.parentId))
      return Object.fromEntries(
        [...parents].map((parent) => [parent, this.projectCards(s, parent)])
      )
    })
  }
  /** Replaceable projection: replay never appends a second parent message/result. */
  cards(parent: string): Promise<DelegationCard[]> {
    return readStore(this.store, (s) => this.projectCards(s, parent))
  }
  private projectCards(s: NodeClientState, parent: string): DelegationCard[] {
    return Object.values(s.delegation?.tasks ?? {})
      .filter((t) => t.parentId === parent)
      .map((t) => {
        const child = t.child
        const events = child ? (s.events[child.mailbox_stream_id] ?? []) : []
        const reports: DelegationCard['reports'] = []
        let state: string =
          t.status?.state ??
          child?.state ??
          (t.permissionRefusal ? 'unsupported' : 'outcome unknown')
        // Session status can arrive before the independent mailbox replay. Do not
        // announce settled parent delivery while its result/terminal bytes are still
        // outstanding; the mailbox's committed terminal event settles this card.
        if (
          child &&
          t.status &&
          ['completed', 'failed', 'cancelled', 'unknown', 'stopped'].includes(t.status.state) &&
          (s.cursors[child.mailbox_stream_id] ?? 0) < t.status.mailbox_head_seq
        )
          state = `${t.status.state} · receiving mailbox`
        let reason: string | undefined = t.status?.reason ?? t.permissionRefusal
        for (const event of events) {
          const data = event.data as {
            delegation_id?: string
            state?: string
            text?: string
            reason?: string
          }
          if (data.delegation_id !== child?.delegation_id) continue
          if (
            event.type === 'delegation.terminal' &&
            data.state &&
            event.seq > (t.followupMailboxSeq ?? 0)
          ) {
            state = data.state
            reason = data.reason
          }
          if (
            ['delegation.progress', 'delegation.question', 'delegation.result'].includes(
              event.type
            ) &&
            event.seq > (t.followupMailboxSeq ?? 0) &&
            typeof data.text === 'string' &&
            !reports.some((r) => r.seq === event.seq)
          )
            reports.push({ seq: event.seq, kind: event.type.slice(11), text: data.text })
        }
        const canRead = !!child
        const transcript = canRead
          ? reduceTranscript((s.events[child.session_id] ?? []).slice(-400))
          : undefined
        const pending = new Map<string, Prompt>(
          (canRead && child ? (this.pendingPrompts.get(child.session_id) ?? []) : []).map(
            (prompt) => [prompt.prompt_id, prompt]
          )
        )
        for (const prompt of transcript?.prompts ?? []) {
          if (prompt.state === 'pending') pending.set(prompt.prompt_id, prompt)
          else pending.delete(prompt.prompt_id)
        }
        const messages = transcript?.messages ?? []
        const latest = messages.findLast((m) => m.role === 'assistant' && m.content)
        const tool = messages.findLast((m) => m.role === 'tool-call' && m.toolResult === undefined)
        const workspace = child?.workspace_id ? this.workspaces.get(child.workspace_id) : undefined
        return {
          title: t.input.title,
          taskKey: t.input.task_key,
          provider: t.input.provider,
          toolPermissions: readToolPermissions(t.status ?? child),
          delegationId: child?.delegation_id,
          sessionId: child?.session_id,
          nodeId: child?.node_id ?? this.ownerNodeId,
          projectId: t.input.project_id,
          workspaceId: child?.workspace_id ?? undefined,
          branch: workspace?.branch,
          activity: canRead
            ? {
                message: latest?.content.slice(-2000),
                tool: tool?.toolName?.slice(0, 256),
                files: workspace?.files ?? [],
              }
            : undefined,
          state,
          reason,
          prompts: t.status?.pending_human_prompts === 0 ? [] : [...pending.values()],
          promptDiffs: transcript?.promptDiffs,
          answers: child ? promptAnswerStates(s, child.session_id) : {},
          warnings: canRead
            ? (s.events[child!.session_id] ?? [])
                .filter((e) => e.type === 'pi.extension.warning')
                .slice(-5)
                .map((e) => {
                  const data = e.data as { extension?: string; event?: string; error?: string }
                  return [data.extension, data.event, data.error].filter(Boolean).join(': ')
                })
            : [],
          pendingHumanPrompts: t.status?.pending_human_prompts ?? pending.size,
          reports,
        }
      })
  }
}
