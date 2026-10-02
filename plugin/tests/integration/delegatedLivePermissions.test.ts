import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { DelegateRun } from '@/ai/DelegateRun'
import { RunStorage } from '@/ai/RunStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { Message } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

let targetPath = ''
vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream(_model: unknown, _prompt: string, messages: Message[]) {
      const previous = messages.findLast((message) => message.role === 'toolResult')
      const step = previous?.role === 'toolResult' ? previous.toolName : ''
      const content =
        step === ''
          ? [
              {
                type: 'toolCall',
                id: 'raise-mode',
                name: 'write_settings',
                arguments: { path: targetPath, value: 'allow-all' },
              },
            ]
          : step === 'write_settings'
            ? [
                {
                  type: 'toolCall',
                  id: 'delete-note',
                  name: 'rm',
                  arguments: { path: 'Project/sample-note.md' },
                },
              ]
            : [
                {
                  type: 'text',
                  text:
                    previous?.role === 'toolResult'
                      ? previous.content.map((part) => part.text).join('')
                      : '',
                },
              ]
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content,
          model: 'sample-model',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          stopReason: step === 'rm' ? 'stop' : 'toolUse',
          timestamp: Date.now(),
        },
      }
    }
  },
}))
const provider: AiProvider = {
  id: 'sample-provider',
  name: 'Sample provider',
  baseUrl: 'https://model.example/v1',
  apiKeyId: '',
  models: [
    {
      id: 'sample-model',
      name: 'Sample model',
      contextWindow: 32000,
      maxTokens: 100,
      supportsReasoning: false,
    },
  ],
}

destroyChatsAfterEach()
beforeEach(() => {
  useVault([{ path: 'Project/sample-note.md', content: 'keep this note' }])
  AgentRegistry.destroy()
  RunStorage.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
  }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  vi.spyOn(RunStorage.getInstance(), 'save').mockResolvedValue(null)
})
afterEach(() => vi.restoreAllMocks())

describe('delegated permissions throughout a real tool loop', () => {
  it.each(['confirm-all', 'allow-edit'] as const)(
    'retains parent %s after write_settings raises the executor mode',
    async (parentMode) => {
      const registry = AgentRegistry.getInstance()
      const parentAgent = registry.create({
        name: 'Sample parent',
        providerId: provider.id,
        modelId: 'sample-model',
        permissionMode: parentMode,
        scope: [{ type: 'folder', path: 'Project' }],
        toolModes: { write_settings: 'auto' },
      })
      const target = registry.create({
        name: 'Sample executor',
        providerId: provider.id,
        modelId: 'sample-model',
        permissionMode: 'confirm-all',
        toolModes: { write_settings: 'auto' },
      })
      targetPath = `ai.agents.${target.id}.permissionMode`
      const parent = new ChatSession(ChatService.getInstance(), undefined, {
        agentId: parentAgent.id,
      })
      vi.spyOn(parent, 'flush').mockResolvedValue(undefined)
      const run = new DelegateRun({
        agent: target,
        parent,
        task: 'Sample task',
        items: [],
        batchSize: 1,
        parentToolCallId: 'sample-delegate',
      })
      const result = await run.run()
      // Settings writes stay available: only the run's captured permission bound is enforced.
      expect(registry.get(target.id)?.permissionMode).toBe('allow-all')
      expect(parent.permissionMode.value).toBe(parentMode)
      expect(result.branches[0].result).toMatch(/approval|permitted/)
      expect(
        result.branches[0].messages.find((message) => message.toolName === 'rm')?.toolStatus
      ).toBe('rejected')
      const app = (await import('@/stores/GlobalStore')).GlobalStore.getInstance().app
      expect(app.vault.getAbstractFileByPath('Project/sample-note.md')).not.toBeNull()
    }
  )
})
