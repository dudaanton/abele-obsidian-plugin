import { AbeleConfig } from '@/services/AbeleConfig'
import {
  REMEMBER_TOOL,
  FORGET_TOOL,
  MEMORY_ITEM_MAX_LENGTH,
  addMemory,
  replaceMemory,
} from '../agents/memory'
import type { AgentDefinition } from '../agents/types'
import type { AgentTool } from '../client'

/**
 * Adds one short item to the memory of the agent that calls it, or rewrites one already there
 * when `replace` names it — a change is remembering the new line in place of the old.
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
      `One brief line, at most ${MEMORY_ITEM_MAX_LENGTH} characters: the gist of what they asked, not a note or a summary. ` +
      'When the person asks to change something you remember, pass the old line as `replace` and the new one as `text`; ' +
      `to drop it altogether, use ${FORGET_TOOL}.`,
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: `What to remember, in one short line (max ${MEMORY_ITEM_MAX_LENGTH} characters)`,
        },
        replace: {
          type: 'string',
          description:
            'Only to change an item: the remembered line it replaces, as written in your memory ' +
            '(a part of it is enough when only one line has that part)',
        },
      },
      required: ['text'],
    },
    execute: async (_id, params) => {
      // Resolved before anything awaits: the session that is running this call is only
      // guaranteed to be the active one until the first await.
      const agent = resolveAgent()
      if (!agent) throw new Error('remember is only available to an agent; nothing was saved.')

      const { text, replace } = params as { text?: string; replace?: string }

      if (replace?.trim()) {
        const changed = replaceMemory(agent, replace, text ?? '')
        await AbeleConfig.getInstance().saveSettings()
        return {
          content: [{ type: 'text', text: `Changed to: ${changed.text}` }],
          details: { agentId: agent.id, item: changed },
        }
      }

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
