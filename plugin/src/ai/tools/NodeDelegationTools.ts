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
  description: 'Device-local node reference returned by node_delegations',
}
const delegation_id = { type: 'string', description: 'Child reference returned by node_delegate' }
const checkCancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error('Delegation call cancelled')
}
const result = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})

/** Model API is bounded to this chat. Grant/secret/session control APIs are owner UI only. */
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
      signal?: AbortSignal
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
      const service = NodeService.getInstance()
      const parentId = await parent.ensureDelegationParentId()
      checkCancelled(signal)
      const value = await execute(parentId, params, service, signal)
      if (signal?.aborted && name === 'node_delegate') {
        const child = value as { delegation_id?: string }
        if (child.delegation_id && typeof params.node === 'string')
          await service.connection(params.node).delegation.cancel(parentId, child.delegation_id).catch(() => {})
      }
      checkCancelled(signal)
      return result(value)
    },
  })
  return [
    tool(
      'node_delegations',
      'Node delegation destinations',
      'List owner-approved node projects/providers for this parent chat. If empty, ask the owner to approve a grant in Settings → Nodes. No enrollment or approval is automatic.',
      { type: 'object', properties: {} },
      async (parent, _params, service) => {
        const destinations = []
        for (const n of service.nodes.value) {
          const connection = service.connection(n.id)
          try {
            await connection.connect()
            await connection.refreshDelegations()
            const approved = await connection.delegation.destinations(parent)
            if (approved.length) {
              const cards = await connection.delegation.cards(parent)
              const children = []
              for (const card of cards) {
                if (!card.delegationId) continue
                try {
                  children.push(await connection.delegation.status(parent, card.delegationId))
                } catch {
                  /* Revoked/foreign resources are not model context. */
                }
              }
              destinations.push({ node: n.id, label: n.label, approved, children })
            }
          } catch {
            destinations.push({ node: n.id, label: n.label, state: 'unavailable' })
          }
        }
        return destinations
      }
    ),
    tool(
      'node_delegate',
      'Delegate to node',
      'Assign a bounded task to an owner-approved project and available Claude Code or pi provider. Returns immediately; the durable mailbox delivers reports even after Obsidian closes. Use a stable task_key and preserve the EXACT body on retries after uncertain outcomes; never allocate a new key to retry. Human permissions remain prompts in the linked child chat. This is not a filesystem sandbox.',
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
          provider: { type: 'string', enum: ['claude', 'pi', 'fake'] },
          title: { type: 'string' },
          text: { type: 'string' },
          base_ref: { type: 'string', description: 'Branch/commit on the node; defaults to HEAD' },
        },
        required: ['node', 'task_key', 'provider', 'title', 'text'],
      },
      async (parent, params, service, signal) => {
        const { node, ...input } = Create.parse(params)
        const connection = service.connection(node)
        await connection.connect()
        checkCancelled(signal)
        try {
          const child = await connection.delegation.create(parent, input, signal)
          if (signal?.aborted) {
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
      'Send a serialized follow-up to an active child owned by this parent. Does not steer or answer human permission prompts.',
      {
        type: 'object',
        properties: { node, delegation_id, text: { type: 'string' } },
        required: ['node', 'delegation_id', 'text'],
      },
      async (parent, params, service, signal) => {
        const input = Send.parse(params)
        const connection = service.connection(input.node)
        await connection.connect()
        checkCancelled(signal)
        return connection.delegation.send(parent, input.delegation_id, input.text, signal)
      }
    ),
    tool(
      'node_delegation_status',
      'Read node task status',
      'Read child status and bounded mailbox reports. pending_human_prompts means a human must open the child chat; mailbox questions cannot approve execution.',
      { type: 'object', properties: { node, delegation_id }, required: ['node', 'delegation_id'] },
      async (parent, params, service) => {
        const input = Target.parse(params)
        const connection = service.connection(input.node)
        await connection.connect()
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
      async (parent, params, service) => {
        const input = Target.parse(params)
        const connection = service.connection(input.node)
        await connection.connect()
        const result = await connection.delegation.cancel(parent, input.delegation_id)
        await connection.refreshDelegations()
        return result
      }
    ),
  ]
}
