import { ref } from 'vue'
import type { ChatSession } from '@/ai/ChatSession'
import { createTraceTools } from '@/ai/tools/TraceTools'
import { nodeAgentHost } from '@/ai/tools/node/owner'
import { activeTraceContext } from '@/debugger/trace/agentContext'
import type { NodeScopeEntry } from '@/ai/nodeScope'
import { ScopeResolver } from '@/ai/ScopeResolver'

/** A synthetic executing chat for the live formatter probe, with only this project's read
 * access. Exercise the real tool guard and retire the temporary scope even on failure. */
export async function readAgentTraceTimeline(run: string) {
  const context = activeTraceContext()
  if (!context) throw new Error('No recorded-run context for the fixture')
  const host = await nodeAgentHost()
  const node = host.nodeId?.(context.registrationId) ?? context.registrationId
  const entry: NodeScopeEntry = {
    kind: 'project',
    node_id: node,
    project_id: context.projectId,
    access: 'read',
  }
  const session = {
    nodeScopeIdentity: `sample-trace-analysis-${crypto.randomUUID()}`,
    overrides: ref({ nodeScope: [entry] }),
    conversationVersion: ref(0),
    permissionMode: ref('confirm-all'),
  } as unknown as ChatSession
  try {
    return await createTraceTools(() => context)
      .find((tool) => tool.name === 'trace_timeline')
      .execute('sample-analysis', { run }, undefined, {
        session,
        scope: ScopeResolver.getInstance(),
        interactive: false,
      })
  } finally {
    session.overrides.value = { nodeScope: [] }
    host.ledger.revoke(session)
  }
}
