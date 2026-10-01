import { AgentLoop } from './client/AgentLoop'
import { needsSecretApproval } from './tools/secretUtils'
import type { AgentTool, ModelConfig, Message, TextContent } from './client'
import { ScopeResolver } from './ScopeResolver'
import type { AgentDefinition } from './agents/types'
import type { ToolContext } from './toolContext'
import { WRITE_TOOLS } from './types'
import { skillNeedsApproval } from './tools/SkillTool'
import { ReadGuard, withReadGuard } from './readGuard'
import { ResultStore, withResultStore } from './resultStore'

export interface SubAgentTask {
  systemPrompt: string
  userMessage: string
  tools: AgentTool[]
  model: ModelConfig
  signal?: AbortSignal
}

/** Same source-path checks as an ordinary chat; destination restrictions are separate policy. */
const SCOPED = [
  'read',
  'edit',
  'replace',
  'write',
  'rm',
  'mv',
  'cp',
  'read_image',
  'look_at_drawing',
  'ls',
  'find',
]
const READ = [
  'read',
  'read_result',
  'ls',
  'find',
  'workspace',
  'skill',
  'query_docs',
  'list_templates',
  'read_image',
  'look_at_drawing',
  'questions',
]

export function runScopeFor(agent: AgentDefinition): ScopeResolver {
  const scope = new ScopeResolver()
  scope.entries.value = [...agent.scope]
  scope.setFullVaultAccess(agent.fullVaultAccess)
  return scope
}

/** An unattended agent refuses anything an ordinary chat would have to ask about. */
export function subAgentRefusal(
  toolName: string,
  args: Record<string, unknown>,
  agent: AgentDefinition,
  scope: ScopeResolver
): string | null {
  if (needsSecretApproval(toolName, args)) return 'Saved-key requests require interactive approval'
  if (toolName === 'delegate') return 'Script-started agents cannot delegate'
  if (SCOPED.includes(toolName)) {
    const path = (args.path || args.from) as string
    if (path && !scope.isInScope(path)) return `Access denied: ${path} is not in workspace scope`
  }
  if (toolName === 'skill' && skillNeedsApproval(args.name, agent, scope))
    return 'This skill needs interactive approval'
  if (READ.includes(toolName)) return null
  if (WRITE_TOOLS.includes(toolName)) {
    return agent.permissionMode === 'allow-edit' || agent.permissionMode === 'allow-all'
      ? null
      : `Write operations need approval (permission mode: ${agent.permissionMode})`
  }
  if (['rm', 'mv', 'cp'].includes(toolName)) {
    return agent.permissionMode === 'allow-all'
      ? null
      : `${toolName} needs approval (permission mode: ${agent.permissionMode})`
  }
  const mode = agent.toolModes[toolName] ?? 'off'
  return mode === 'auto'
    ? null
    : mode === 'off'
      ? `${toolName} is not enabled`
      : `${toolName} needs approval, which an unattended agent cannot ask for`
}

/** Run with the target's own access, never the global settings or the selected chat's. */
export async function runSubAgent(
  task: SubAgentTask,
  agent: AgentDefinition,
  scope = runScopeFor(agent)
): Promise<string> {
  if (task.signal?.aborted) throw new Error('Aborted')
  const ctx: ToolContext = { scope, agentId: agent.id, interactive: false }
  const bound = task.tools.map((tool) => ({
    ...tool,
    execute: (id: string, params: Record<string, unknown>, signal?: AbortSignal) =>
      tool.execute(id, params, signal, ctx),
  }))
  const guard = new ReadGuard({ history: () => [], scope: () => scope })
  const messages: Message[] = [{ role: 'user', content: task.userMessage, timestamp: Date.now() }]
  const result = await new AgentLoop().run({
    model: task.model,
    systemPrompt: task.systemPrompt,
    tools: withResultStore(withReadGuard(bound, guard), new ResultStore({ messages: () => [] })),
    messages,
    streamOptions: { signal: task.signal },
    beforeToolCall: async (name, _id, args) => {
      if (task.signal?.aborted) return { block: true, reason: 'Aborted' }
      const reason = subAgentRefusal(name, args, agent, scope)
      if (reason) return { block: true, reason }
    },
  })
  const last = [...result.messages].reverse().find((message) => message.role === 'assistant')
  return last
    ? last.content
        .filter((part): part is TextContent => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
    : ''
}
