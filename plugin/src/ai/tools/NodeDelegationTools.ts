import { nodeDelegationProviders, testNodeProvidersEnabled } from '@/node/providers'
import { requireNodeActionPermission } from '../nodeActionPermissions'
import { UiError } from '@/i18n/streamBErrors'
import { requireGrantFreeDelegation } from '@/node/delegationCapability'
import { requireDelegationScope } from './node/delegationScope'
import { nodeScopeEntries } from '../nodeScope'
import { z } from 'zod'
import type { AgentTool } from '../client'
import type { ChatSession } from '../ChatSession'
import { NodeService } from '@/node/NodeService'
import { DelegationTaskInputSchema } from '@/node/delegation'
const Id = z.string().min(1).max(128)
const Target = z.object({ node: Id, delegation_id: Id }).strict()
const Create = DelegationTaskInputSchema.extend({ node: Id })
const Send = Target.extend({ text: z.string().min(1).max(32768) })
const node = {
  type: 'string',
  description:
    'Stable node ID returned by node_nodes or node_delegations; a local registration alias is also accepted',
}
function registrationFor(service: NodeService, id: string) {
  const nodes = service.nodes.value
  const exact = nodes.find((node) => node.id === id)
  if (exact) return exact
  const matches = nodes.filter((node) => node.expectedNodeId === id)
  if (matches.length > 1)
    throw new Error('Choose the node installation explicitly using its local registration alias')
  if (!matches[0]) throw new Error('Unknown node registration')
  return matches[0]
}
const delegation_id = { type: 'string', description: 'Child reference returned by node_delegate' }
const checkCancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error('Delegation call cancelled')
}
const result = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})

/** Model API is bounded to this chat and its node chips. */
export function createNodeDelegationTools(owner?: ChatSession): AgentTool[] {
  const tool = (
    name: string,
    label: string,
    description: string,
    parameters: AgentTool['parameters'],
    execute: (
      parent: string,
      params: Record<string, unknown>,
      service: NodeService,
      signal?: AbortSignal,
      chat?: ChatSession,
      guard?: () => void,
      resolvedConnection?: ReturnType<NodeService['connection']>
    ) => Promise<unknown>
  ): AgentTool => ({
    name,
    label,
    category: 'Nodes',
    description,
    parameters,
    execute: async (_id, params, signal, ctx) => {
      checkCancelled(signal)
      const parent = ctx?.session ?? owner
      if (!parent) throw new Error('Node delegation requires an executing parent chat')
      const permission = () => requireNodeActionPermission(parent, name, ctx?.approved === true)
      permission()
      const parentId = await parent.ensureDelegationParentId()
      permission()
      checkCancelled(signal)
      const service = NodeService.getInstance()
      const scope = nodeScopeEntries(parent)
      const registration =
        typeof params.node === 'string' ? registrationFor(service, params.node) : undefined
      if (registration) params = { ...params, node: registration.id }
      const nodeId =
        registration?.expectedNodeId ??
        registration?.id ??
        (name === 'node_delegations' ? '' : Id.parse(params.node))
      const connection = registration ? service.connection(registration.id) : undefined
      let guard = () => {}
      if (name !== 'node_delegations') {
        if (!scope.some((entry) => entry.node_id === nodeId)) requireDelegationScope(parent, nodeId)
        if (name === 'node_delegate') {
          guard = requireDelegationScope(parent, nodeId, params.project_id as string | undefined)
        } else {
          const cards = await connection!.delegation.cards(parentId)
          const child = cards.find((card) => card.delegationId === params.delegation_id)
          if (!child) throw new Error('Delegation does not belong to this parent chat')
          guard = requireDelegationScope(parent, nodeId, child.projectId, child.workspaceId)
        }
      }
      const scopeGuard = guard
      guard = () => {
        permission()
        scopeGuard()
      }
      const value = await execute(parentId, params, service, signal, parent, guard, connection)
      guard()
      if (name === 'node_delegations') {
        const listed = value as {
          node: string
          approved?: {
            providers?: string[]
            project_ids: string[]
            projects: { project_id: string }[]
          }[]
          children?: { project_id?: string; workspace_id?: string }[]
        }[]
        return result(
          listed
            .filter((item) => nodeScopeEntries(parent).some((entry) => entry.node_id === item.node))
            .map((item) => ({
              ...item,
              approved: item.approved?.map((destination) => ({
                ...destination,
                providers: destination.providers?.filter(
                  (provider) => provider !== 'fake' || testNodeProvidersEnabled()
                ),
                project_ids: destination.project_ids.filter((project) => {
                  try {
                    requireDelegationScope(parent, item.node, project)
                    return true
                  } catch {
                    return false
                  }
                }),
                projects: destination.projects.filter((project) => {
                  try {
                    requireDelegationScope(parent, item.node, project.project_id)
                    return true
                  } catch {
                    return false
                  }
                }),
              })),
              children: item.children?.filter((child) => {
                try {
                  requireDelegationScope(parent, item.node, child.project_id, child.workspace_id)
                  return true
                } catch {
                  return false
                }
              }),
            }))
        )
      }
      if (signal?.aborted && name === 'node_delegate') {
        const child = value as { delegation_id?: string }
        if (child.delegation_id && typeof params.node === 'string')
          await connection!.delegation.cancel(parentId, child.delegation_id).catch(() => {})
      }
      checkCancelled(signal)
      return result(value)
    },
  })
  return [
    tool(
      'node_delegations',
      'Node delegation destinations',
      'List node projects/providers available through this chat’s node chips. Add a missing node or project using those chips.',
      { type: 'object', properties: {} },
      async (parent, _params, service, _signal, chat, guard) => {
        const destinations = []
        for (const n of service.nodes.value) {
          if (
            !chat ||
            !nodeScopeEntries(chat).some((entry) => entry.node_id === (n.expectedNodeId ?? n.id))
          )
            continue
          const connection = service.connection(n.id)
          try {
            await connection.connect()
            requireGrantFreeDelegation(await connection.client.describe())
            guard?.()
            await connection.refreshDelegations()
            const approved = await connection.delegation.destinations(parent)
            if (approved.length) {
              const cards = await connection.delegation.cards(parent)
              const children = []
              for (const card of cards) {
                if (!card.delegationId) continue
                try {
                  requireDelegationScope(
                    chat,
                    n.expectedNodeId ?? n.id,
                    card.projectId,
                    card.workspaceId
                  )
                } catch {
                  continue
                }
                try {
                  children.push(await connection.delegation.status(parent, card.delegationId))
                } catch {
                  /* Revoked/foreign resources are not model context. */
                }
              }
              destinations.push({
                node: n.expectedNodeId ?? n.id,
                label: n.label,
                approved,
                children,
              })
            }
          } catch (error) {
            if (error instanceof UiError) throw error
            destinations.push({
              node: n.expectedNodeId ?? n.id,
              label: n.label,
              state: 'unavailable',
            })
          }
        }
        return destinations
      }
    ),
    tool(
      'node_delegate',
      'Delegate to node',
      'Assign a bounded task to an project in this chat’s node access and available Claude Code, pi or Codex provider. Returns immediately; the durable mailbox delivers reports even after Obsidian closes. Use a stable task_key and preserve the EXACT body on retries after uncertain outcomes; never allocate a new key to retry. Human permissions appear in the parent delegation card and linked child chat; only the owner answers them. This is not a filesystem sandbox.',
      {
        type: 'object',
        properties: {
          node,
          task_key: {
            type: 'string',
            description:
              'Stable task identity within this parent; reuse with identical arguments on retry (max 128 characters)',
          },
          project_id: { type: 'string' },
          provider: { type: 'string', enum: nodeDelegationProviders() },
          title: { type: 'string' },
          text: { type: 'string' },
          base_ref: { type: 'string', description: 'Branch/commit on the node; defaults to HEAD' },
        },
        required: ['node', 'task_key', 'provider', 'title', 'text'],
      },
      async (parent, params, _service, signal, chat, guard, resolvedConnection) => {
        const { node: _node, ...input } = Create.parse(params)
        const connection = resolvedConnection!
        await connection.connect()
        guard?.()
        requireGrantFreeDelegation(await connection.client.describe())
        guard?.()
        checkCancelled(signal)
        try {
          const child = await connection.delegation.create(
            parent,
            input,
            signal,
            chat?.permissionMode?.value
          )
          if (signal?.aborted && 'delegation_id' in child) {
            await connection.delegation.cancel(parent, child.delegation_id).catch(() => {})
            checkCancelled(signal)
          }
          return child
        } finally {
          await connection.refreshDelegations().catch(() => {})
        }
      }
    ),
    tool(
      'node_delegation_send',
      'Follow up on node task',
      'Send review feedback or continue work in the same child session and worktree owned by this parent, including a finished child on nodes that support resuming delegation. Does not steer or answer human permission prompts. If an older node refuses a finished child, explain the limitation; do not retry resource_busy in a loop or create a replacement developer automatically.',
      {
        type: 'object',
        properties: { node, delegation_id, text: { type: 'string' } },
        required: ['node', 'delegation_id', 'text'],
      },
      async (parent, params, _service, signal, _chat, guard, resolvedConnection) => {
        const input = Send.parse(params)
        const connection = resolvedConnection!
        await connection.connect()
        guard?.()
        requireGrantFreeDelegation(await connection.client.describe())
        guard?.()
        checkCancelled(signal)
        return connection.delegation.send(parent, input.delegation_id, input.text, signal)
      }
    ),
    tool(
      'node_delegation_status',
      'Read node task status',
      'Read child status and bounded mailbox reports. pending_human_prompts means the owner must answer in the parent card or child chat; mailbox questions cannot approve execution.',
      { type: 'object', properties: { node, delegation_id }, required: ['node', 'delegation_id'] },
      async (parent, params, _service, _signal, _chat, guard, resolvedConnection) => {
        const input = Target.parse(params)
        const connection = resolvedConnection!
        await connection.connect()
        guard?.()
        requireGrantFreeDelegation(await connection.client.describe())
        guard?.()
        const status = await connection.delegation.status(parent, input.delegation_id)
        await connection.refreshDelegations()
        return status
      }
    ),
    tool(
      'node_delegation_cancel',
      'Cancel node task',
      'Cancel a child owned by this parent. Retains workspaces, branches, files and transcript. A cancellation receipt is not proof that every process has exited.',
      { type: 'object', properties: { node, delegation_id }, required: ['node', 'delegation_id'] },
      async (parent, params, _service, _signal, _chat, guard, resolvedConnection) => {
        const input = Target.parse(params)
        const connection = resolvedConnection!
        await connection.connect()
        guard?.()
        requireGrantFreeDelegation(await connection.client.describe())
        guard?.()
        const result = await connection.delegation.cancel(parent, input.delegation_id)
        await connection.refreshDelegations()
        return result
      }
    ),
  ]
}
