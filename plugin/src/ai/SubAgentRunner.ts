import { AgentLoop } from './client/AgentLoop'
import type { AgentTool, ModelConfig, Message, AssistantMessage, TextContent } from './client'
import { ScopeResolver } from './ScopeResolver'
import { AbeleConfig } from '@/services/AbeleConfig'

export interface SubAgentPermissions {
  allowWebSearch: boolean
  allowFetch: boolean
  allowDownload: boolean
  allowWiseModel: boolean
  allowImageGeneration: boolean
  allowEvalJs: boolean
  allowCreateFiles: boolean
  allowScripts: boolean
  allowedScripts: Record<string, boolean>
  allowCreateScript: boolean
  allowReadLogs: boolean
  allowReadBacklinks: boolean
  allowReadTransactions: boolean
  allowReadTasks: boolean
  allowOpenFile: boolean
}

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
 *
 * Key difference from main agent:
 * - `create` skips scope check (new files don't exist in scope yet)
 * - `edit`/`read`/`rm`/`mv`/`cp` check scope strictly
 * - Permission flags inherited from parent agent
 * - `create`/`edit` allowed if parent's permissionMode is allow-edit or allow-all
 */
function isToolAllowed(
  toolName: string,
  permissions: SubAgentPermissions,
  args?: Record<string, unknown>
): { allowed: boolean; reason?: string } {
  const scope = ScopeResolver.getInstance()
  const mode = AbeleConfig.getInstance().ai.permissionMode

  // Prevent recursion
  if (toolName === 'delegate') return { allowed: false, reason: 'Sub-agents cannot delegate' }

  // Scope check for file tools (except create — new files aren't in scope yet)
  const SCOPED_READ_TOOLS = ['read', 'edit', 'rm', 'mv', 'cp', 'read_image', 'ls', 'find']
  if (args && SCOPED_READ_TOOLS.includes(toolName)) {
    const path = (args.path || args.from) as string
    if (path && !scope.isInScope(path)) {
      return { allowed: false, reason: `Access denied: ${path} is not in workspace scope` }
    }
  }

  // Create — check allowCreateFiles flag
  if (toolName === 'create' && !permissions.allowCreateFiles)
    return { allowed: false, reason: 'File creation not allowed' }

  // Edit/write tools need appropriate permission mode
  const WRITE_TOOLS = ['edit', 'rm', 'mv', 'cp']
  if (WRITE_TOOLS.includes(toolName)) {
    if (mode !== 'allow-edit' && mode !== 'allow-all') {
      return {
        allowed: false,
        reason: `Write operations require allow-edit or allow-all permission mode`,
      }
    }
  }

  // Permission flag checks
  if (toolName === 'web_search' && !permissions.allowWebSearch)
    return { allowed: false, reason: 'Web search not allowed' }
  if (toolName === 'fetch' && !permissions.allowFetch)
    return { allowed: false, reason: 'Fetch not allowed' }
  if ((toolName === 'download_image' || toolName === 'download_file') && !permissions.allowDownload)
    return { allowed: false, reason: 'Download not allowed' }
  if (toolName === 'wise_model' && !permissions.allowWiseModel)
    return { allowed: false, reason: 'Wise model not allowed' }
  if (
    (toolName === 'generate_image' || toolName === 'edit_image') &&
    !permissions.allowImageGeneration
  )
    return { allowed: false, reason: 'Image generation not allowed' }
  if (toolName === 'eval_js' && !permissions.allowEvalJs)
    return { allowed: false, reason: 'Eval JS not allowed' }
  if (
    toolName.startsWith('script_') &&
    !permissions.allowScripts &&
    !permissions.allowedScripts[toolName]
  )
    return { allowed: false, reason: 'Script execution not allowed' }
  if (toolName === 'read_logs' && !permissions.allowReadLogs)
    return { allowed: false, reason: 'Read logs not allowed' }
  if (toolName === 'read_backlinks' && !permissions.allowReadBacklinks)
    return { allowed: false, reason: 'Read backlinks not allowed' }
  if (toolName === 'read_transactions' && !permissions.allowReadTransactions)
    return { allowed: false, reason: 'Read transactions not allowed' }
  if (toolName === 'read_tasks' && !permissions.allowReadTasks)
    return { allowed: false, reason: 'Read tasks not allowed' }
  if (toolName === 'open' && !permissions.allowOpenFile)
    return { allowed: false, reason: 'Open file not allowed' }
  if (toolName === 'create_script' && !permissions.allowCreateScript)
    return { allowed: false, reason: 'Script creation not allowed' }

  return { allowed: true }
}

/**
 * Run a single sub-agent task to completion.
 * Returns result text or error — never prompts for approval.
 */
export async function runSubAgent(
  task: SubAgentTask,
  permissions: SubAgentPermissions
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
      const check = isToolAllowed(toolName, permissions, args)
      if (!check.allowed) {
        return { block: true, reason: check.reason }
      }
    },
  })

  // Extract final text from last assistant message
  const lastAssistant = [...result.messages].reverse().find((m) => m.role === 'assistant') as
    | AssistantMessage
    | undefined

  if (!lastAssistant) return ''

  return lastAssistant.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
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
  permissions: SubAgentPermissions,
  signal?: AbortSignal,
  onProgress?: (completed: number, total: number, results: SubAgentResult[]) => void
): Promise<SubAgentResult[]> {
  const results: SubAgentResult[] = []

  for (let i = 0; i < items.length; i += batchSize) {
    if (signal?.aborted) {
      // Mark remaining items as aborted
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
          permissions
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
