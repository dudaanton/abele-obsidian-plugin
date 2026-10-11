import { z } from 'zod'
import { RelativePathSchema, RepositoryRevisionSchema } from '@abele/node-protocol'
import type { RepositoryRevision } from '@abele/node-client'
import type { ChatSession } from '../../ChatSession'
import { NodeScopeTargetSchema, type NodeScopeTarget } from '../../nodeScope'
import { nodeAgentHost } from './owner'

/** An immutable reference to the owner's displayed snapshot, not the current sidebar selection. */
export interface ObsidianNodeContext extends NodeScopeTarget {
  path?: string
  revision?: RepositoryRevision
  content_id?: string
  lines?: { start: number; end: number }
}

/** Owner UI only. Adds quoted displayed bytes to this chat's draft, without sending or granting scope. */
export async function addNodeContextToObsidianChat(
  session: ChatSession,
  reference: ObsidianNodeContext,
  content: string
): Promise<void> {
  const captured = structuredClone(reference),
    version = session.conversationVersion.value
  const location = NodeScopeTargetSchema.parse({
    node_id: captured.node_id,
    project_id: captured.project_id,
    target: captured.target,
  })
  const snapshot = {
    ...location,
    ...(captured.path !== undefined ? { path: RelativePathSchema.parse(captured.path) } : {}),
    ...(captured.revision ? { revision: RepositoryRevisionSchema.parse(captured.revision) } : {}),
    ...(captured.content_id
      ? {
          content_id: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .parse(captured.content_id),
        }
      : {}),
    ...(captured.lines
      ? {
          lines: z
            .object({ start: z.number().int().positive(), end: z.number().int().positive() })
            .strict()
            .refine((range) => range.end >= range.start)
            .parse(captured.lines),
        }
      : {}),
  }
  const bytes = z
    .string()
    .max(2 * 1024 * 1024)
    .parse(content)
  const host = await nodeAgentHost()
  if (session.conversationVersion.value !== version)
    throw new Error('Chat changed while adding node context')
  snapshot.node_id = host.nodeId?.(snapshot.node_id) ?? snapshot.node_id
  const quote = JSON.stringify({ node_context: snapshot, text: bytes }, null, 2)
  const before = session.draft.value
  session.draft.value = { ...before, text: before.text ? `${before.text}\n\n${quote}` : quote }
}

/** Ask here focuses the explicitly chosen chat's draft; it never starts a provider run. */
export async function askNodeContextInObsidianChat(
  session: ChatSession,
  reference: ObsidianNodeContext,
  content: string
): Promise<void> {
  const version = session.conversationVersion.value
  await addNodeContextToObsidianChat(session, reference, content)
  const { ChatService } = await import('../../ChatService')
  if (session.conversationVersion.value !== version)
    throw new Error('Chat changed while focusing node context')
  const service = ChatService.getInstance()
  service.switchTab(session.id)
  service.pendingInput.value = {
    text: '',
    append: true,
    focus: true,
    tabId: session.id,
    conversationVersion: version,
  }
}
