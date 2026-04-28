import type { AgentTool } from '../client'
import { AgentService } from '../AgentService'
import { ChatSession } from '../ChatSession'
import { CORE_TOOLS } from '../types'
import { runSubAgentBatch, type SubAgentResult } from '../SubAgentRunner'
import { createAgentTools } from './index'

export function createDelegateTool(): AgentTool {
  return {
    name: 'delegate',
    label: 'Delegate Tasks',
    description:
      'Delegate repetitive tasks to sub-agents for parallel processing. Each item is processed by an independent sub-agent with a fresh context. Use this when you need to process many items (URLs, files, etc.) with the same instructions. Sub-agents have the same tools and permissions as you (except delegate). They can create files if permission mode is allow-edit or allow-all. Returns a summary of results and errors.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Instructions for processing each item. Be specific — each sub-agent only sees this + one item.',
        },
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of items to process (URLs, file paths, text, etc.)',
        },
        batch_size: {
          type: 'number',
          description: 'Number of sub-agents to run in parallel (default 5, max 10)',
        },
      },
      required: ['task', 'items'],
    },
    execute: async (_id, params, signal) => {
      const task = params.task as string
      const items = params.items as string[]
      const batchSize = Math.min(Math.max((params.batch_size as number) || 5, 1), 10)

      if (!task) throw new Error('Missing required parameter: task')
      if (!items?.length) throw new Error('Missing required parameter: items')

      const agent = AgentService.getInstance()
      const session = ChatSession.getActiveSession()
      const model = agent.getDelegateModelConfig()
      const systemPrompt = await agent.getDelegateSystemPrompt(
        session || agent.activeSession.value!
      )
      const permissions = session
        ? session.getPermissions()
        : agent.activeSession.value!.getPermissions()

      // Build tools list: exclude delegate and filter off tools
      const allTools = createAgentTools()
      const tools = allTools.filter((t) => {
        if (t.name === 'delegate') return false
        if (CORE_TOOLS.has(t.name)) return true
        return (permissions[t.name] ?? 'off') !== 'off'
      })

      const onProgress = (completed: number, total: number, results: SubAgentResult[]) => {
        const succeeded = results.filter((r) => r.success).length
        const failed = results.filter((r) => !r.success && r.error !== 'Aborted').length
        const parts = [`${completed}/${total}`]
        if (succeeded > 0) parts.push(`${succeeded} ok`)
        if (failed > 0) parts.push(`${failed} failed`)
        if (session) {
          session.updateDelegateProgress(parts.join(', '))
        }
      }

      const results = await runSubAgentBatch(
        items,
        task,
        tools,
        model,
        systemPrompt,
        batchSize,
        permissions,
        signal,
        onProgress
      )

      // Build summary
      const succeeded = results.filter((r) => r.success)
      const failed = results.filter((r) => !r.success && r.error !== 'Aborted')
      const aborted = results.filter((r) => r.error === 'Aborted')

      const lines: string[] = []
      lines.push(`## Delegate Results: ${succeeded.length}/${results.length} succeeded`)
      if (aborted.length > 0) lines.push(`${aborted.length} aborted`)

      if (succeeded.length > 0) {
        lines.push('\n### Completed:')
        for (const r of succeeded) {
          const summary = r.text.length > 200 ? r.text.slice(0, 200) + '...' : r.text
          lines.push(`- **${truncateItem(r.item)}**: ${summary}`)
        }
      }

      if (failed.length > 0) {
        lines.push('\n### Failed:')
        for (const r of failed) {
          lines.push(`- **${truncateItem(r.item)}**: ${r.error || 'Unknown error'}`)
        }
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    },
  }
}

function truncateItem(item: string): string {
  return item.length > 80 ? item.slice(0, 80) + '...' : item
}
