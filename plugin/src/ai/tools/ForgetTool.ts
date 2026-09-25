import { AbeleConfig } from '@/services/AbeleConfig'
import { FORGET_TOOL, REMEMBER_TOOL, forgetMemory } from '../agents/memory'
import type { AgentDefinition } from '../agents/types'
import type { AgentTool } from '../client'

/**
 * Removes one item from the memory of the agent that calls it. The agent is resolved the same
 * way `remember` resolves it, for the same reason: two chats on two agents can run at once.
 */
export function createForgetTool(resolveAgent: () => AgentDefinition | null): AgentTool {
  return {
    name: FORGET_TOOL,
    label: 'Forget',
    description:
      'Remove one item from your own memory, so it is no longer shown to you. ' +
      'Use when the person asks you to forget something you remember. ' +
      'Name the item by its line as written in your memory; a part of it is enough when only one line has that part. ' +
      `To change an item rather than drop it, call ${REMEMBER_TOOL} with the old line as \`replace\`.`,
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The remembered line to forget, or a part of it that only this line has',
        },
      },
      required: ['text'],
    },
    execute: async (_id, params) => {
      // Resolved before anything awaits, as in `remember`.
      const agent = resolveAgent()
      if (!agent) throw new Error('forget is only available to an agent; nothing was removed.')

      const { text } = params as { text?: string }
      const item = forgetMemory(agent, text ?? '')
      await AbeleConfig.getInstance().saveSettings()

      return {
        content: [{ type: 'text', text: `Forgotten: ${item.text}` }],
        details: { agentId: agent.id, item },
      }
    },
  }
}
