/**
 * A node call refused for want of access keeps its refusal on the call's own message, so the
 * chat can show what was missing under it; the agent still reads the words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { EMPTY_USAGE, type AgentTool, type AssistantMessage } from '@/ai/client'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import { NodeAccessRefusalError } from '@/ai/tools/node/accessRefusal'
import type { TFile } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

const refusal = {
  kind: 'no-access' as const,
  node_id: 'sample-node',
  project_id: 'sample-project',
  target: { kind: 'worktree' as const, worktree_id: 'sample-tree' },
}
const refusing: AgentTool = {
  name: 'sample_node_read',
  label: 'Sample node read',
  description: 'Reads a sample file on a node.',
  parameters: { type: 'object', properties: {} },
  execute: async () => {
    throw new NodeAccessRefusalError('Sample folder is not in this chat’s node access.', refusal)
  },
}

let session: ChatSession
destroyChatsAfterEach()
beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    providers: [
      {
        id: 'sample-provider',
        name: 'Sample provider',
        baseUrl: 'https://sample.invalid/v1',
        apiKeyId: '',
        models: [
          {
            id: 'sample',
            name: 'Sample',
            maxTokens: 1000,
            contextWindow: 100000,
            supportsReasoning: false,
          },
        ],
      },
    ],
  }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Sample agent',
    providerId: 'sample-provider',
    modelId: 'sample',
    permissionMode: 'allow-all',
    toolModes: { sample_node_read: 'auto' },
  })
  registry.setDefault(agent.id)
  const chats = ChatService.getInstance()
  vi.spyOn(chats, 'getSystemPrompt').mockResolvedValue('Synthetic prompt.')
  vi.spyOn(chats, 'saveTabs').mockImplementation(() => {})
  vi.spyOn(ChatStorage.getInstance(), 'saveChat').mockResolvedValue({
    path: 'AI/Chats/sample.abchat',
    basename: 'sample',
  } as TFile)
  session = new ChatSession(chats)
  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  for (const name of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded'])
    vi.spyOn(summarizer, name).mockResolvedValue(undefined)
  vi.spyOn(session as unknown as { getTools(): AgentTool[] }, 'getTools').mockReturnValue([
    refusing,
  ])
})
afterEach(() => vi.restoreAllMocks())

describe('a refused node call in the chat', () => {
  it('keeps the coded refusal on the call’s message and the words in its result', async () => {
    let turn = 0
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(async function* () {
      const content: AssistantMessage['content'] =
        turn++ === 0
          ? [{ type: 'toolCall', id: 'sample-call', name: 'sample_node_read', arguments: {} }]
          : [{ type: 'text', text: 'Sample answer' }]
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content,
          model: 'sample',
          usage: EMPTY_USAGE,
          stopReason: turn === 1 ? 'toolUse' : 'stop',
          timestamp: 1,
        },
      }
    })
    await session.sendMessage('Read the sample file')
    const call = session.messages.value.find((m) => m.role === 'tool-call')!
    expect(call.nodeAccessRefusal).toEqual(refusal)
    expect(call.toolResult).toContain('not in this chat’s node access')
  })
})
