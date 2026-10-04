import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { createAgentTools } from '@/ai/tools'
import { runSubAgent } from '@/ai/SubAgentRunner'
import type { Message, ModelConfig } from '@/ai/client'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { useVault } from '../helpers/testEnv'

const calls = vi.hoisted(() => ({
  args: { path: 'sample.zip', files: [{ path: 'Notes/sample.md' }] },
}))
vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream(_model: unknown, _prompt: string, messages: Message[]) {
      const result = messages.findLast((message) => message.role === 'toolResult')
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content: result
            ? [{ type: 'text', text: result.content.map((p) => p.text).join('') }]
            : [{ type: 'toolCall', id: 'sample-zip', name: 'zip', arguments: calls.args }],
          model: 'sample-model',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          stopReason: result ? 'stop' : 'toolUse',
          timestamp: Date.now(),
        },
      }
    }
  },
}))
let app: App
const sessions: ChatSession[] = []
const provider = {
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
beforeEach(() => {
  app = useVault([{ path: 'Notes/sample.md', content: 'sample' }]) as unknown as App
  ;(app.vault.getAbstractFileByPath('Notes/sample.md') as TFile).stat.size = 6
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    providers: [provider],
  }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue()
  calls.args = { path: 'sample.zip', files: [{ path: 'Notes/sample.md' }] }
})
afterEach(() => {
  sessions.forEach((s) => s.destroy())
  sessions.length = 0
  ChatService.getInstance().destroy()
  ChangeTracker.get()?.uninstall()
  vi.restoreAllMocks()
})
function owner(mode: 'confirm-all' | 'allow-edit' | 'allow-all') {
  const agent = AgentRegistry.getInstance().create({
    name: 'Sample ZIP worker',
    providerId: provider.id,
    modelId: 'sample-model',
    permissionMode: mode,
    scope: [{ type: 'file', path: 'Notes/sample.md' }],
  })
  const s = new ChatSession(ChatService.getInstance(), undefined, { agentId: agent.id })
  sessions.push(s)
  vi.spyOn(s, 'flush').mockResolvedValue()
  vi.spyOn(s, 'save').mockResolvedValue()
  return s
}
it.each(['reject', 'stop', 'approve'] as const)(
  'real session loop %s uses ordinary approval without a source grant',
  async (action) => {
    const s = owner('confirm-all')
    const read = vi.spyOn(app.vault, 'readBinary')
    await s.sendMessage('Pack the selected sample')
    expect(s.pendingToolCalls.value[0]?.name).toBe('zip')
    expect(read).not.toHaveBeenCalled()
    if (action === 'reject') await s.rejectToolCall()
    if (action === 'stop') s.abort()
    if (action === 'approve') {
      await s.approveToolCall()
      expect(s.messages.value.find((m) => m.toolName === 'zip')?.toolResult).toContain('Saved ZIP')
    }
    expect(!!app.vault.getAbstractFileByPath('sample.zip')).toBe(action === 'approve')
    expect(s.scopeResolver.isInScope('sample.zip')).toBe(action === 'approve')
  }
)
it.each(['allow-edit', 'allow-all'] as const)(
  'real session loop automatically admits %s ZIP',
  async (mode) => {
    const s = owner(mode)
    await s.sendMessage('Pack sample')
    expect(s.pendingToolCalls.value).toEqual([])
    expect(app.vault.getAbstractFileByPath('sample.zip')).not.toBeNull()
    expect(s.messages.value.find((m) => m.toolName === 'zip')?.toolResult).toContain('Saved ZIP')
  }
)
it('ordinary rewind removes a successfully saved ZIP through the existing recording path', async () => {
  const s = owner('allow-edit')
  ChangeTracker.install(app)
  await s.sendMessage('Pack sample')
  const plan = await s.rewind.planSince(0)
  expect(plan.items).toMatchObject([{ path: 'sample.zip', action: 'remove' }])
  const result = await s.rewind.apply(plan)
  expect(result.restored).toContain('sample.zip')
  expect(app.vault.getAbstractFileByPath('sample.zip')).toBeNull()
})

it.each(['confirm-all', 'allow-edit'] as const)(
  'actual unattended loop honors %s and uses registered ZIP',
  async (mode) => {
    const s = owner(mode)
    const answer = await runSubAgent(
      {
        systemPrompt: '',
        userMessage: 'Pack sample',
        tools: createAgentTools({ agentId: s.agent.value!.id }),
        model: { id: 'sample-model', baseUrl: provider.baseUrl, apiKey: '' } as ModelConfig,
      },
      s.agent.value!
    )
    expect(!!app.vault.getAbstractFileByPath('sample.zip')).toBe(mode === 'allow-edit')
    expect(answer).toMatch(mode === 'allow-edit' ? /Saved ZIP/ : /approval/)
  }
)
