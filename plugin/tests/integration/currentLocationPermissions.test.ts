import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { runSubAgent } from '@/ai/SubAgentRunner'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { AgentTool, Message, ModelConfig } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

const device = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/services/DeviceLocation', () => ({ getDeviceLocation: device.get }))

let requestedTool = 'current_location'
vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream(_model: ModelConfig, _system: string, messages: Message[]) {
      const result = messages.findLast((m) => m.role === 'toolResult')
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content:
            result?.role === 'toolResult'
              ? [{ type: 'text', text: result.content.map((c) => c.text).join('') }]
              : [{ type: 'toolCall', id: 'sample-call', name: requestedTool, arguments: {} }],
          stopReason: result ? 'stop' : 'toolUse',
          timestamp: 1,
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
      contextWindow: 1000,
      maxTokens: 100,
      supportsReasoning: false,
    },
  ],
}
const model: ModelConfig = {
  id: 'sample-model',
  name: 'Sample model',
  baseUrl: provider.baseUrl,
  apiKey: '',
  maxTokens: 100,
  supportsReasoning: false,
}

destroyChatsAfterEach()
beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = structuredClone({ ...DEFAULT_AI_SETTINGS, providers: [provider] })
  requestedTool = 'current_location'
  device.get.mockReset().mockResolvedValue({
    latitude: 12.345,
    longitude: 67.89,
    accuracy: 24,
    timestamp: 1234567890000,
    device: 'sample platform',
  })
})
afterEach(() => vi.restoreAllMocks())

function agent(mode: 'ask' | 'auto' | 'off') {
  return AgentRegistry.getInstance().create({
    name: 'Sample worker',
    providerId: provider.id,
    modelId: 'sample-model',
    toolModes: { current_location: mode },
  })
}

describe('location permission with nobody to confirm', () => {
  it('permits Ask in script ctx.agent like other enabled feature tools', async () => {
    const target = agent('ask')
    const ctx = buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })
    const result = await ctx.agent('Find nearby places', { agent: target.id })
    expect(device.get).toHaveBeenCalledOnce()
    expect(JSON.parse(result as string).latitude).toBe(12.345)
  })

  it('permits explicitly automatic location in script ctx.agent', async () => {
    const target = agent('auto')
    const ctx = buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })
    const result = await ctx.agent('Find nearby places', { agent: target.id })
    expect(device.get).toHaveBeenCalledOnce()
    expect(JSON.parse(result as string).latitude).toBe(12.345)
  })

  it('keeps Off unavailable in script ctx.agent even if a model requests it', async () => {
    const target = agent('off')
    const ctx = buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })
    await ctx.agent('Find nearby places', { agent: target.id })
    expect(device.get).not.toHaveBeenCalled()
  })

  it.each(['ask', 'auto'] as const)(
    'delegated run with mode %s keeps its existing approval guarantee',
    async (mode) => {
      const target = agent(mode)
      const session = new ChatSession(ChatService.getInstance(), undefined, {
        kind: 'run',
        agentId: target.id,
      })
      vi.spyOn(session, 'save').mockResolvedValue(undefined)
      await session.sendMessage('Find nearby places')
      expect(session.pendingToolCalls.value).toEqual([])
      if (mode === 'ask') {
        expect(device.get).not.toHaveBeenCalled()
        expect(session.lastAssistantText()).toMatch(/current_location.*approval.*cannot ask/i)
      } else {
        expect(device.get).toHaveBeenCalledOnce()
        expect(session.lastAssistantText()).toContain('12.345')
      }
      session.destroy()
    }
  )

  it('does not change Ask behaviour for any other tool in script-started agents', async () => {
    requestedTool = 'sample_tool'
    const execute = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'sample answer' }] })
    const tool: AgentTool = {
      name: requestedTool,
      label: 'Sample tool',
      description: 'Sample tool',
      parameters: {},
      execute,
    }
    const result = await runSubAgent(
      { systemPrompt: '', userMessage: 'Use the sample tool', tools: [tool], model },
      { sample_tool: 'ask' }
    )
    expect(result).toBe('sample answer')
    expect(execute).toHaveBeenCalledOnce()
  })
})
