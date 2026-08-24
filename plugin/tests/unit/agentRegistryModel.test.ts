import { describe, it, expect, beforeEach } from 'vitest'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { createAgent } from '@/ai/agents/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const openai: AiProvider = {
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyId: 'openai-key',
  models: [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      contextWindow: 128000,
      maxTokens: 4096,
      supportsReasoning: false,
    },
    {
      id: 'o3',
      name: 'o3',
      contextWindow: 200000,
      maxTokens: 8192,
      supportsReasoning: true,
      reasoningEffort: 'high',
    },
  ],
}

const local: AiProvider = {
  id: 'local',
  name: 'Local',
  baseUrl: 'http://localhost:1234/v1',
  apiKeyId: 'local-key',
  models: [
    { id: 'qwen', name: 'Qwen', contextWindow: 32000, maxTokens: 2048, supportsReasoning: false },
  ],
}

beforeEach(() => {
  const app = useVault([])
  app.secretStorage.setSecret('openai-key', 'sk-test')
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [openai, local],
    agents: [],
    defaultAgentId: '',
  }
})

describe('AgentRegistry.resolveModel', () => {
  it('builds a model config from the agent provider and model, with the key from the keychain', () => {
    const agent = createAgent({ providerId: 'openai', modelId: 'o3' })

    const model = AgentRegistry.getInstance().resolveModel(agent)!

    expect(model).toEqual({
      id: 'o3',
      name: 'o3',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      contextWindow: 200000,
      maxTokens: 8192,
      supportsReasoning: true,
      reasoningEffort: 'high',
    })
  })

  it('finds the model by scanning providers when the agent names no provider', () => {
    // Migrated interceptors stored only a model id; scanning preserves that behaviour.
    const agent = createAgent({ providerId: '', modelId: 'qwen' })

    const model = AgentRegistry.getInstance().resolveModel(agent)!

    expect(model.id).toBe('qwen')
    expect(model.baseUrl).toBe('http://localhost:1234/v1')
  })

  it('returns null rather than a wrong model when nothing matches', () => {
    const agent = createAgent({ providerId: 'openai', modelId: 'does-not-exist' })

    expect(AgentRegistry.getInstance().resolveModel(agent)).toBeNull()
  })

  it('resolves the fallback pair when asked for it', () => {
    const agent = createAgent({
      providerId: 'openai',
      modelId: 'o3',
      fallbackProviderId: 'local',
      fallbackModelId: 'qwen',
    })

    const model = AgentRegistry.getInstance().resolveModel(agent, { fallback: true })!

    expect(model.id).toBe('qwen')
    expect(model.baseUrl).toBe('http://localhost:1234/v1')
  })

  it('returns null for a fallback that was never configured, so callers can offer plain retry', () => {
    const agent = createAgent({ providerId: 'openai', modelId: 'o3' })

    expect(AgentRegistry.getInstance().resolveModel(agent, { fallback: true })).toBeNull()
  })

  it('returns an empty key rather than throwing when the keychain has nothing', () => {
    const agent = createAgent({ providerId: 'local', modelId: 'qwen' })

    expect(AgentRegistry.getInstance().resolveModel(agent)!.apiKey).toBe('')
  })
})
