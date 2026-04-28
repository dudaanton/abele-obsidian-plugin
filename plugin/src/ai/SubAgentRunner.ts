import { AgentLoop } from './client/AgentLoop'
import type { AgentTool, ModelConfig, Message, AssistantMessage, TextContent } from './client'
import { ScopeResolver } from './ScopeResolver'
import { AbeleConfig } from '@/services/AbeleConfig'
import { CORE_TOOLS } from './types'
import type { ToolMode } from './types'

export interface SubAgentTask {
  /** System prompt for the sub-agent */
  systemPrompt: string
  /** User message describing the task + item to process */
  userMessage: string
  /** Tools available to the sub-agent */
  tools: AgentTool[]
  /** Model config */
  model: ModelConfig
  /** Abort signal */
  signal?: AbortSignal
}

export interface SubAgentResult {
  /** The item that was processed */
  item: string
  /** Whether the task succeeded */
  success: boolean
  /** Result text from the agent */
  text: string
  /** Error message if failed */
  error?: string
}

/**
 * Check if a tool call is allowed given current parent permissions.
 * Sub-agents: denied = immediate error, no approval prompts.
 */
function isToolAllowed(
  toolName: string,
  toolModes: Record<string, ToolMode>,
  args?: Record<string, unknown>
): { allowed: boolean; reason?: string } {
  const scope = ScopeResolver.getInstance()
  const mode = AbeleConfig.getInstance().ai.permissionMode

  if (toolName === 'delegate') return { allowed: false, reason: 'Sub-agents cannot delegate' }

  // Scope check for file tools
  const SCOPED = ['read', 'edit', 'rm', 'mv', 'cp', 'read_image', 'ls', 'find']
  if (args && SCOPED.includes(toolName)) {
    const path = (args.path || args.from) as string
    if (path && !scope.isInScope(path)) {
      return { allowed: false, reason: `Access denied: ${path} is not in workspace scope` }
    }
  }

  // Write tools: check permissionMode
  const WRITE = ['edit', 'rm', 'mv', 'cp', 'create']
  if (WRITE.includes(toolName)) {
    if (mode !== 'allow-edit' && mode !== 'allow-all') {
      return {
        allowed: false,
        reason: 'Write operations require allow-edit or allow-all permission mode',
      }
    }
    return { allowed: true }
  }

  // Core tools: always allowed
  if (CORE_TOOLS.has(toolName)) return { allowed: true }

  // Feature tools: check toolModes
  const toolMode = toolModes[toolName] ?? 'off'
  if (toolMode === 'off') {
    return { allowed: false, reason: `${toolName} is not enabled` }
  }
  // 'ask' and 'auto' both allowed for sub-agents (no interactive prompt)
  return { allowed: true }
}

/**
 * Run a single sub-agent task to completion.
 * Returns result text or error — never prompts for approval.
 */
export async function runSubAgent(
  task: SubAgentTask,
  toolModes: Record<string, ToolMode>
): Promise<string> {
  if (task.signal?.aborted) throw new Error('Aborted')

  const agentLoop = new AgentLoop()

  const messages: Message[] = [
    {
      role: 'user' as const,
      content: task.userMessage,
      timestamp: Date.now(),
    },
  ]

  const result = await agentLoop.run({
    model: task.model,
    systemPrompt: task.systemPrompt,
    tools: task.tools,
    messages,
    streamOptions: {
      signal: task.signal,
    },
    beforeToolCall: async (toolName, _id, args) => {
      if (task.signal?.aborted) return { block: true, reason: 'Aborted' }
      const check = isToolAllowed(toolName, toolModes, args)
      if (!check.allowed) {
        return { block: true, reason: check.reason }
      }
    },
  })

  // Extract final text from last assistant message
  const lastAssistant = [...result.messages].reverse().find((m) => m.role === 'assistant') as
    | AssistantMessage
    | undefined

  if (lastAssistant) {
    const texts = lastAssistant.content.filter((c): c is TextContent => c.type === 'text')
    if (texts.length) return texts.map((t) => t.text).join('\n')
  }

  return ''
}

/**
 * Run multiple items through sub-agents in batches.
 * Returns results for each item.
 */
export async function runSubAgentBatch(
  items: string[],
  taskDescription: string,
  tools: AgentTool[],
  model: ModelConfig,
  systemPrompt: string,
  batchSize: number,
  toolModes: Record<string, ToolMode>,
  signal?: AbortSignal,
  onProgress?: (completed: number, total: number, results: SubAgentResult[]) => void
): Promise<SubAgentResult[]> {
  const results: SubAgentResult[] = []

  for (let i = 0; i < items.length; i += batchSize) {
    if (signal?.aborted) {
      for (let j = i; j < items.length; j++) {
        results.push({ item: items[j], success: false, text: '', error: 'Aborted' })
      }
      break
    }

    const batch = items.slice(i, i + batchSize)

    const batchPromises = batch.map(async (item): Promise<SubAgentResult> => {
      if (signal?.aborted) {
        return { item, success: false, error: 'Aborted', text: '' }
      }

      try {
        const text = await runSubAgent(
          {
            systemPrompt,
            userMessage: `${taskDescription}\n\nItem to process:\n${item}`,
            tools,
            model,
            signal,
          },
          toolModes
        )
        return { item, success: true, text }
      } catch (err) {
        if (signal?.aborted) return { item, success: false, text: '', error: 'Aborted' }
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { item, success: false, text: '', error: errorMsg }
      }
    })

    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)

    onProgress?.(results.length, items.length, results)
  }

  return results
}
