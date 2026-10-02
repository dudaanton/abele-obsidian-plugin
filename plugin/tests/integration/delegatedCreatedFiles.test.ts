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

let destination = 'Project/New.md'
vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream(_model: unknown, _prompt: string, messages: Message[]) {
      const results = messages.filter((message) => message.role === 'toolResult')
      const calls = [
        { name: 'workspace', arguments: {} },
        { name: 'create', arguments: { path: destination, content: 'initial' } },
        { name: 'read', arguments: { path: destination } },
        {
          name: 'edit',
          arguments: { path: destination, old_string: 'initial', new_string: 'updated' },
        },
        { name: 'workspace', arguments: {} },
      ]
      const call = calls[results.length]
      const last = results.at(-1)
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content: call
            ? [{ type: 'toolCall', id: `sample-${results.length}`, ...call }]
            : [
                {
                  type: 'text',
                  text:
                    last?.role === 'toolResult'
                      ? last.content.map((part) => part.text).join('')
                      : '',
                },
              ],
          model: 'sample-model',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          stopReason: call ? 'toolUse' : 'stop',
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
let app: ReturnType<typeof useVault>
destroyChatsAfterEach()
beforeEach(() => {
  app = useVault([{ path: 'Project/sample-note.md', content: 'existing' }])
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
  destination = 'Project/New.md'
})
afterEach(() => vi.restoreAllMocks())

async function runWith(targetScope: 'inherit' | 'full' | 'file') {
  const registry = AgentRegistry.getInstance()
  const fields = {
    providerId: provider.id,
    modelId: 'sample-model',
    permissionMode: 'allow-edit' as const,
  }
  const parentAgent = registry.create({ ...fields, scope: [{ type: 'folder', path: 'Project' }] })
  const target = registry.create({
    ...fields,
    fullVaultAccess: targetScope === 'full',
    scope: targetScope === 'file' ? [{ type: 'file', path: destination }] : [],
  })
  const parent = new ChatSession(ChatService.getInstance(), undefined, { agentId: parentAgent.id })
  vi.spyOn(parent, 'flush').mockResolvedValue(undefined)
  return new DelegateRun({
    agent: target,
    parent,
    task: 'Sample task',
    items: [],
    batchSize: 1,
    parentToolCallId: 'sample-delegate',
  }).run()
}

describe('created files under a cached delegation ceiling', () => {
  it.each(['inherit', 'full', 'file'] as const)(
    'can read and edit the created file with target scope %s',
    async (scope) => {
      const result = await runWith(scope)
      expect(
        result.branches[0].messages.filter((message) => message.toolStatus === 'rejected')
      ).toEqual([])
      const file = app.vault.getAbstractFileByPath(destination)!
      expect(await app.vault.read(file as never)).toBe('updated')
      expect(result.branches[0].result).toContain('New.md')
    }
  )
  it('still cannot read or edit a created file outside the parent folder', async () => {
    destination = 'Separate/New.md'
    const result = await runWith('full')
    const file = app.vault.getAbstractFileByPath(destination)!
    expect(await app.vault.read(file as never)).toBe('initial')
    expect(
      result.branches[0].messages.filter((message) => message.toolStatus === 'rejected')
    ).toHaveLength(2)
    expect(result.branches[0].result).not.toContain('Separate')
  })
})
