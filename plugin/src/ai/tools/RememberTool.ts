import { AbeleConfig } from '@/services/AbeleConfig'
import { REMEMBER_TOOL, MEMORY_ITEM_MAX_LENGTH, addMemory } from '../agents/memory'
import type { AgentDefinition } from '../agents/types'
import type { AgentTool } from '../client'

/**
 * Adds one short item to the memory of the agent that calls it.
 *
 * The agent is resolved at call time by whoever built the tool list — a chat passes its own
 * agent, a script the agent it runs — because "the current agent" is not global: two chats on
 * two agents can be mid-turn at once, and each must remember into its own.
 */
export function createRememberTool(resolveAgent: () => AgentDefinition | null): AgentTool {
  return {
    name: REMEMBER_TOOL,
    label: 'Remember',
    description:
      'Save one short fact or preference to your own memory, which is shown to you in every later conversation. ' +
      'Use only when the person asks you to remember something. ' +
      `One brief line, at most ${MEMORY_ITEM_MAX_LENGTH} characters: the gist of what they asked, not a note or a summary.`,
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: `What to remember, in one short line (max ${MEMORY_ITEM_MAX_LENGTH} characters)`,
        },
      },
      required: ['text'],
    },
    execute: async (_id, params) => {
      // Resolved before anything awaits: the session that is running this call is only
      // guaranteed to be the active one until the first await.
      const agent = resolveAgent()
      if (!agent) throw new Error('remember is only available to an agent; nothing was saved.')

      const { text } = params as { text?: string }
      const before = agent.memory?.length ?? 0
      const item = addMemory(agent, text ?? '')
      const added = (agent.memory?.length ?? 0) > before

      if (added) await AbeleConfig.getInstance().saveSettings()

      return {
        content: [
          {
            type: 'text',
            text: added ? `Remembered: ${item.text}` : `Already remembered: ${item.text}`,
          },
        ],
        details: { agentId: agent.id, item },
      }
    },
  }
}
