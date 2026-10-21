import { z } from 'zod'
import type { NodeClient } from '@abele/node-client'
import type { ObsidianToolsSnapshot } from '@abele/node-protocol'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { boundRunToParent, resolveTargetAgent } from '@/ai/DelegateRun'
import type { AgentDefinition } from '@/ai/agents/types'
import type { AgentToolResult } from '@/ai/client'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { offeredSkills } from '@/ai/tools/SkillTool'
import type { ObsidianInvocation } from './NodeObsidianExecutor'
import { NodeClientStore } from './NodeClientStore'
import { NodeObsidianAdapter, wireName } from './NodeObsidianAdapter'

const Modes = z.record(z.string(), z.enum(['off', 'ask', 'auto']))
const Context = z.object({
  scope: z
    .array(z.object({ type: z.enum(['file', 'folder', 'pattern', 'group']), path: z.string() }))
    .default([]),
  fullVaultAccess: z.boolean().default(false),
  permissionMode: z.enum(['confirm-all', 'allow-edit', 'allow-all']).default('confirm-all'),
  skills: z.array(z.string()).default([]),
  sections: z.array(z.string()).default([]),
  githubConnections: Modes.default({}),
  toolModes: Modes.default({}),
  ceilings: z.array(z.unknown()).default([]),
})
const Branch = z.object({ branch_id: z.string(), state: z.string(), item: z.string().optional() })
const Run = z.object({
  run_id: z.string(),
  root_id: z.string(),
  depth: z.number(),
  depth_limit: z.number(),
  batch_size: z.number().int().min(1).max(10),
  branches: z.array(Branch),
  configuration: z.object({
    agent_id: z.string(),
    tools: z.array(z.object({ name: z.string(), mode: z.enum(['off', 'ask', 'auto']) })),
    conversation: z.unknown().optional(),
  }),
  parent_context: z.unknown(),
  status: z.string(),
})
type RunView = z.infer<typeof Run>
const stricterModes = (
  a: Record<string, 'off' | 'ask' | 'auto'>,
  b: Record<string, 'off' | 'ask' | 'auto'>
) => {
  const rank = { off: 0, ask: 1, auto: 2 }
  return Object.fromEntries(
    [...new Set([...Object.keys(a), ...Object.keys(b)])].map((key) => {
      const x = a[key] ?? 'off',
        y = b[key] ?? 'off'
      return [key, rank[x] <= rank[y] ? x : y]
    })
  )
}
export function boundedConversation(target: unknown, rawParent: unknown) {
  const child = Context.parse(target),
    parent = Context.parse(rawParent)
  const rank = { 'confirm-all': 0, 'allow-edit': 1, 'allow-all': 2 }
  return {
    ...child,
    ...(child.fullVaultAccess || child.scope.length
      ? {}
      : { scope: parent.scope, fullVaultAccess: parent.fullVaultAccess }),
    permissionMode:
      rank[child.permissionMode] <= rank[parent.permissionMode]
        ? child.permissionMode
        : parent.permissionMode,
    skills: child.skills.filter((skill) => parent.skills.includes(skill)),
    sections: [...new Set([...child.sections, ...parent.sections])],
    toolModes: stricterModes(child.toolModes, parent.toolModes),
    githubConnections: stricterModes(child.githubConnections, parent.githubConnections),
    ceilings: [{ ...parent, ceilings: [] }, ...parent.ceilings],
  }
}

export function nodeConversation(agent: AgentDefinition): Record<string, unknown> {
  const scope = new ScopeResolver()
  scope.entries.value = agent.scope.map((entry) => ({ ...entry }))
  scope.setFullVaultAccess(agent.fullVaultAccess)
  try {
    const adapter = new NodeObsidianAdapter(agent.id, 'context', async () => [])
    try {
      return JSON.parse(
        JSON.stringify({
          scope: agent.scope,
          fullVaultAccess: agent.fullVaultAccess,
          permissionMode: agent.permissionMode,
          skills: offeredSkills(agent, scope).map((skill) => skill.name),
          sections: Object.entries(agent.toolSectionOpening ?? {})
            .filter(([, mode]) => mode === 'always')
            .map(([name]) => name),
          githubConnections: agent.githubConnections ?? {},
          toolModes: {
            ...Object.fromEntries(adapter.tools().map((tool) => [tool.name, tool.mode])),
            ...agent.toolModes,
          },
        })
      ) as Record<string, unknown>
    } finally {
      adapter.destroy()
    }
  } finally {
    scope.destroy()
  }
}

/** Node owns admission and immutable history; private ordinary sessions own inference. */
export class NodeObsidianDelegate {
  constructor(
    private readonly client: NodeClient,
    private readonly store: NodeClientStore,
    private readonly clientId: string,
    private readonly targetSnapshot: (id: string) => Promise<ObsidianToolsSnapshot>,
    private readonly makeSession: (
      id: string,
      options: ConstructorParameters<typeof ChatSession>[2]
    ) => ChatSession = (id, options) => new ChatSession(ChatService.getInstance(), id, options)
  ) {}
  private request(i: ObsidianInvocation, method: string, params: Record<string, unknown> = {}) {
    return this.client.request('obsidian.tools.v1.delegate.' + method, {
      invocation_id: i.invocation_id,
      ...params,
      ...(['begin', 'claim', 'record'].includes(method)
        ? { client_id: this.clientId, revision: i.revision }
        : {}),
    })
  }
  private async durable(
    i: ObsidianInvocation,
    key: string,
    method: string,
    params: Record<string, unknown>
  ) {
    const immutable = JSON.parse(JSON.stringify(params)) as Record<string, unknown>
    const request = await this.store.transaction((state) => {
      const requests = (state.operationRequests ??= {})
      return (requests[key] ??= {
        method: 'obsidian.tools.v1.delegate.' + method,
        params: {
          invocation_id: i.invocation_id,
          client_id: this.clientId,
          revision: i.revision,
          ...immutable,
        },
      })
    })
    return this.client.request(request.method, request.params as Record<string, unknown>)
  }
  async handle(i: ObsidianInvocation, signal: AbortSignal): Promise<void> {
    if (i.action === 'cancel' || i.cancel_requested) {
      await this.recover(i, signal)
      return
    }
    // Replay only immutable owner intents. Physical branch claims never enter an outbox.
    const retained = await this.store.read((state) =>
      Object.entries(state.operationRequests ?? {})
        .filter(([key]) => key.startsWith(`host:${i.invocation_id}:`))
        .map(([, value]) => value)
    )
    for (const request of retained)
      await this.client.request(request.method, request.params as Record<string, unknown>)
    const view = z
      .object({ runs: z.array(z.object({ run_id: z.string() })) })
      .parse(await this.request(i, 'get'))
    if (view.runs.length) {
      await this.recover(i, signal)
      return
    }
    await this.begin(i, i.call_id, i.arguments, signal)
  }
  private async begin(
    i: ObsidianInvocation,
    callId: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    parentBranch?: string,
    parentContext?: unknown
  ): Promise<AgentToolResult> {
    const target = resolveTargetAgent(String(args.agent ?? ''))
    if (!target || target.node) throw new Error(`Agent "${String(args.agent)}" not found`)
    const snapshot = await this.targetSnapshot(target.id)
    const context =
      parentContext ??
      z
        .object({ configuration: z.object({ conversation: z.unknown() }) })
        .parse(
          await this.client.request('obsidian.tools.v1.configuration', { session_id: i.session_id })
        ).configuration.conversation
    snapshot.conversation = boundedConversation(snapshot.conversation, context)
    const run = Run.parse(
      await this.durable(i, `host:${i.invocation_id}:begin:${callId}`, 'begin', {
        call_id: callId,
        agent_name: target.name,
        target: snapshot,
        ...(parentBranch ? { parent_branch_id: parentBranch, arguments: args } : {}),
      })
    )
    await this.run(i, run, signal)
    const results = await Promise.all(
      run.branches.map((branch) => this.request(i, 'branch', { branch_id: branch.branch_id }))
    )
    return {
      content: [
        {
          type: 'text',
          text: results
            .map((raw) => {
              const result = z
                .object({
                  result: z.string().optional(),
                  error: z.string().optional(),
                  state: z.string(),
                })
                .parse(raw)
              return result.result ?? result.error ?? result.state
            })
            .join('\n\n'),
        },
      ],
    }
  }
  private async recover(i: ObsidianInvocation, signal: AbortSignal) {
    const root = z
      .object({ runs: z.array(z.object({ run_id: z.string() })) })
      .parse(await this.request(i, 'get'))
    // Reconcile deepest runs first so a parent can settle only after its children.
    const runs = await Promise.all(
      root.runs.map((run) =>
        this.request(i, 'get', { run_id: run.run_id }).then((raw) => Run.parse(raw))
      )
    )
    for (const run of runs.sort((a, b) => b.depth - a.depth)) await this.run(i, run, signal)
  }
  private async run(i: ObsidianInvocation, run: RunView, signal: AbortSignal) {
    if (run.status !== 'running') return
    for (let offset = 0; offset < run.branches.length; offset += run.batch_size) {
      await Promise.all(
        run.branches.slice(offset, offset + run.batch_size).map(async (branch) => {
          const key = `host:${i.invocation_id}:branch:${branch.branch_id}`
          if (!['queued', 'running'].includes(branch.state)) return
          if (signal.aborted || i.cancel_requested) {
            await this.durable(i, key + ':abort', 'record', {
              branch_id: branch.branch_id,
              record_id: 'abort',
              state: branch.state === 'queued' ? 'aborted' : 'outcome_unknown',
              messages: [],
              error: 'Cancelled; no sub-run was restarted.',
            })
            return
          }
          const claim = z
            .object({
              execute: z.boolean(),
              branch: z.object({ task: z.string(), state: z.string() }),
            })
            .parse(await this.request(i, 'claim', { branch_id: branch.branch_id }))
          if (!claim.execute) {
            if (claim.branch.state === 'running') {
              // Read retained history before declaring uncertainty. There is no provider
              // reattachment for an ordinary ephemeral run, so another start is forbidden.
              await this.history(i, branch.branch_id)
              await this.durable(i, key + ':unknown', 'record', {
                branch_id: branch.branch_id,
                record_id: 'unknown',
                messages: [],
                state: 'outcome_unknown',
                error:
                  'The sub-run was claimed, but its outcome could not be confirmed. It was not restarted.',
              })
            }
            return
          }
          const parent = this.makeSession(run.root_id, {
            kind: 'run',
            agentId: i.agent_id,
            depth: run.depth - 1,
            onPersist: () => {},
          })
          let session: ChatSession | undefined
          const scopes: ScopeResolver[] = []
          const policy = new NodeObsidianAdapter(
            run.configuration.agent_id,
            i.revision,
            async () => []
          )
          let chain = Promise.resolve()
          const seen = new Map<string, string>()
          let version = 0
          const persist = () => {
            if (!session) return
            const messages = session.allMessages.value.flatMap((message) => {
              const serialized = JSON.stringify(message)
              if (seen.get(message.id) === serialized) return []
              seen.set(message.id, serialized)
              const v = ++version,
                parts = Math.max(1, Math.ceil(serialized.length / 6000))
              return Array.from({ length: parts }, (_, part) => ({
                id: message.id,
                version: v,
                part,
                parts,
                text: serialized.slice(part * 6000, (part + 1) * 6000),
              }))
            })
            for (const message of messages) {
              const recordId = crypto.randomUUID()
              chain = chain
                .then(() =>
                  this.durable(i, key + ':record:' + recordId, 'record', {
                    branch_id: branch.branch_id,
                    record_id: recordId,
                    state: 'running',
                    messages: [message],
                  })
                )
                .then(() => {})
            }
          }
          try {
            const context = Context.parse(run.parent_context)
            let scopeCeiling: ScopeResolver | undefined
            for (const raw of [context, ...context.ceilings].reverse()) {
              const ancestor = Context.parse(raw),
                scope = new ScopeResolver()
              scope.entries.value = ancestor.scope
              scope.setFullVaultAccess(ancestor.fullVaultAccess)
              if (scopeCeiling) scope.setCeiling(scopeCeiling)
              scopes.push(scope)
              scopeCeiling = scope
            }
            parent.applyRunScope(context.scope, context.fullVaultAccess, scopeCeiling!)
            parent.permissionMode.value = context.permissionMode
            parent.toolModes.value = context.toolModes
            parent.skillCeiling = new Set(context.skills)
            parent.inheritToolSections(context.sections)
            parent.githubConnectionCeiling = context.githubConnections
            parent.depthLimit = run.depth_limit
            const ceiling = new Map(run.configuration.tools.map((tool) => [tool.name, tool.mode]))
            session = this.makeSession(branch.branch_id, {
              kind: 'run',
              agentId: run.configuration.agent_id,
              depth: run.depth,
              root: parent,
              parent: { sessionId: i.session_id, toolCallId: i.call_id },
              onPersist: persist,
              delegateHost: (id, args, nestedSignal) =>
                this.begin(
                  i,
                  `${branch.branch_id}:${id}`,
                  args,
                  nestedSignal ?? signal,
                  branch.branch_id,
                  {
                    ...nodeConversation(session!.agent.value!),
                    scope: session!.scopeResolver.entries.value,
                    fullVaultAccess: session!.scopeResolver.fullVaultAccess.value,
                    permissionMode: session!.permissionMode.value,
                    toolModes: session!.toolModes.value,
                    skills: [...session!.offeredSkillNames()],
                    sections: [...session!.openToolSections()],
                    githubConnections: session!.githubAgent()?.githubConnections ?? {},
                    ceilings: [{ ...context, ceilings: [] }, ...context.ceilings],
                  }
                ),
              toolCeiling: (tool) =>
                ceiling.get(wireName(tool.name)) === 'auto' &&
                policy.tools().find((current) => current.name === wireName(tool.name))?.mode ===
                  'auto',
            })
            boundRunToParent(session, parent)
            session.depthLimit = Math.min(session.depthLimit, run.depth_limit)
            session.toolModes.value = policy.permissionModes(ceiling)
            const abort = () => session?.abort()
            signal.addEventListener('abort', abort, { once: true })
            try {
              signal.throwIfAborted()
              await session.sendMessage(claim.branch.task)
            } finally {
              signal.removeEventListener('abort', abort)
            }
            persist()
            await chain
            await this.durable(i, key + ':final', 'record', {
              branch_id: branch.branch_id,
              record_id: 'final',
              messages: [],
              state: signal.aborted ? 'aborted' : session.error.value ? 'error' : 'done',
              result:
                session.lastAssistantText().length <= 12000
                  ? session.lastAssistantText()
                  : 'The full result is retained in this branch history; open the run to read it.',
              ...(session.error.value
                ? {
                    error:
                      session.error.value.length <= 2000
                        ? session.error.value
                        : 'The sub-run failed; inspect its retained history.',
                  }
                : {}),
            })
          } catch (error) {
            persist()
            await chain
            await this.durable(i, key + ':error', 'record', {
              branch_id: branch.branch_id,
              record_id: 'error',
              messages: [],
              state: 'outcome_unknown',
              error:
                error instanceof Error && error.message.length <= 2000
                  ? error.message
                  : 'Sub-run outcome unknown; inspect the retained history.',
            })
          } finally {
            session?.destroy()
            parent.destroy()
            policy.destroy()
            for (const scope of scopes) scope.destroy()
          }
        })
      )
    }
  }
  async history(i: Pick<ObsidianInvocation, 'invocation_id'>, branch: string): Promise<unknown[]> {
    const messages: unknown[] = []
    let after = 0
    for (;;) {
      const page = z
        .object({
          entries: z.array(z.object({ seq: z.number(), message: z.unknown() })),
          next_seq: z.number(),
          has_more: z.boolean(),
        })
        .parse(
          await this.client.request('obsidian.tools.v1.delegate.history', {
            invocation_id: i.invocation_id,
            branch_id: branch,
            after_seq: after,
          })
        )
      messages.push(...page.entries.map((entry) => entry.message))
      if (!page.has_more) return messages
      if (page.next_seq <= after) throw new Error('Delegate history did not advance')
      after = page.next_seq
    }
  }
}
