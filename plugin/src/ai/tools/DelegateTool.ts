import type { AgentTool } from '../client'
import { ChatSession } from '../ChatSession'
import { ChatService } from '../ChatService'
import { AgentRegistry } from '../agents/AgentRegistry'
import { DelegateRun, canDelegate, resolveTargetAgent } from '../DelegateRun'
import type { RunBranch } from '../RunStorage'

const DEFAULT_BATCH_SIZE = 5
const MAX_BATCH_SIZE = 10
const RESULT_PREVIEW = 200

/**
 * Lists the agents that can be delegated to, the way `SkillTool` lists skills.
 *
 * Utility agents are included on purpose: hidden from the chat picker is the point of them —
 * they exist to be called by something else.
 */
function buildDescription(): string {
  const agents = AgentRegistry.getInstance().list({ includeUtility: true })
  const lines = agents
    .map((a) => `- ${a.name}${a.description ? ': ' + a.description : ''}`)
    .join('\n')

  return [
    'Hand a task to another agent. The sub-agent runs with its own instructions, tools and',
    'permissions, plus whatever files this chat has in scope. Its whole conversation is kept',
    'and can be opened, so you do not need to summarise it back.',
    '',
    'Pass `items` to fan out: each item gets its own sub-agent and its own fresh context.',
    '',
    agents.length ? `Available agents:\n${lines}` : 'No agents are configured.',
  ].join('\n')
}

export function createDelegateTool(): AgentTool {
  return {
    name: 'delegate',
    label: 'Delegate to agent',
    description: buildDescription(),
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Name of the agent to hand the task to.',
        },
        task: {
          type: 'string',
          description:
            'What to do. Be specific — a sub-agent sees only this, and one item if you fan out.',
        },
        items: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional. One sub-agent per item, each processing the task against its own item.',
        },
        batch_size: {
          type: 'number',
          description: `Sub-agents to run at once when fanning out (default ${DEFAULT_BATCH_SIZE}, max ${MAX_BATCH_SIZE}).`,
        },
      },
      required: ['agent', 'task'],
    },
    execute: async (toolCallId, params, signal) => {
      const agentName = params.agent as string
      const task = params.task as string
      const items = (params.items as string[]) ?? []
      const batchSize = Math.min(
        Math.max((params.batch_size as number) || DEFAULT_BATCH_SIZE, 1),
        MAX_BATCH_SIZE
      )

      if (!agentName) throw new Error('Missing required parameter: agent')
      if (!task) throw new Error('Missing required parameter: task')

      const parent = ChatSession.getActiveSession() ?? ChatService.getInstance().activeSession.value
      if (!parent) throw new Error('No active chat to delegate from')

      if (!canDelegate(parent)) {
        const agent = parent.agent.value
        throw new Error(
          agent
            ? `"${agent.name}" may delegate ${agent.maxDelegateDepth} level(s) deep and is already ${parent.depth} deep`
            : 'This chat has no agent and cannot delegate'
        )
      }

      const target = resolveTargetAgent(agentName)
      if (!target) {
        const available = AgentRegistry.getInstance()
          .list({ includeUtility: true })
          .map((a) => a.name)
          .join(', ')
        throw new Error(`Agent "${agentName}" not found. Available: ${available || 'none'}`)
      }

      const run = new DelegateRun({
        agent: target,
        task,
        items,
        batchSize,
        parent,
        parentToolCallId: toolCallId,
        signal,
        onProgress: (completed, total) => {
          parent.updateDelegateProgress(`${target.name}: ${completed}/${total}`)
        },
      })

      // Recorded on the tool call before the work starts, so the branch can be opened while it
      // is still running rather than only once it finishes.
      parent.attachSubAgentRun(toolCallId, {
        runId: run.runId,
        agentId: target.id,
        agentName: target.name,
        path: run.path,
        status: 'running',
        branchCount: items.length || 1,
      })

      const result = await run.run()

      parent.attachSubAgentRun(toolCallId, {
        runId: run.runId,
        agentId: target.id,
        agentName: target.name,
        path: run.path,
        status: result.branches.some((b) => b.status === 'error') ? 'error' : 'done',
        branchCount: result.branches.length,
      })

      return { content: [{ type: 'text', text: summarise(target.name, result.branches) }] }
    },
  }
}

function summarise(agentName: string, branches: RunBranch[]): string {
  const done = branches.filter((b) => b.status === 'done')
  const failed = branches.filter((b) => b.status === 'error')
  const aborted = branches.filter((b) => b.status === 'aborted')

  // A single branch is not a batch; reporting "1/1 succeeded" reads like a machine.
  if (branches.length === 1) {
    const only = branches[0]
    if (only.status === 'done') return only.result || '(the sub-agent returned nothing)'
    return `${agentName} did not finish: ${only.error || only.status}`
  }

  const lines = [`## ${agentName}: ${done.length}/${branches.length} succeeded`]
  if (aborted.length) lines.push(`${aborted.length} aborted`)

  if (done.length) {
    lines.push('\n### Completed:')
    for (const branch of done) {
      const text = branch.result ?? ''
      const preview = text.length > RESULT_PREVIEW ? `${text.slice(0, RESULT_PREVIEW)}...` : text
      lines.push(`- **${truncate(branch.item)}**: ${preview}`)
    }
  }

  if (failed.length) {
    lines.push('\n### Failed:')
    for (const branch of failed) {
      lines.push(`- **${truncate(branch.item)}**: ${branch.error || 'Unknown error'}`)
    }
  }

  return lines.join('\n')
}

function truncate(item: string): string {
  return item.length > 80 ? `${item.slice(0, 80)}...` : item
}
