/**
 * Which model does the plugin's own background work — naming a chat, compacting one.
 *
 * It used to be one global setting whose "unset" meant the globally active model, which itself
 * falls back to the first model of the first provider. So a chat could have its title written
 * by a model nobody had chosen for anything, and there was no way to say "the one this chat is
 * already using" or to give one agent a different one. The order asserted here is the answer:
 * the agent, then the setting, then the chat's own model.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [
    { id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false },
    { id: 'small', name: 'Small', contextWindow: 50, maxTokens: 5, supportsReasoning: false },
    { id: 'cheap', name: 'Cheap', contextWindow: 20, maxTokens: 5, supportsReasoning: false },
  ],
}

function seedAgent(overrides = {}) {
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Default', providerId: 'p1', modelId: 'big', ...overrides })
  registry.setDefault(agent.id)
  return agent
}

const chat = () => new ChatSession(ChatService.getInstance())

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
    // What the plugin considers "active" globally, and what the old fallback would have used.
    activeProviderId: 'p1',
    activeModelId: 'small',
  }
})

describe('with nothing chosen anywhere', () => {
  it('uses the model the chat is already talking to', () => {
    seedAgent({ modelId: 'big' })

    expect(chat().auxiliaryModel().id).toBe('big')
  })

  /** Which is the point: it is no longer whatever model happens to be first or globally active. */
  it('follows the chat onto another model rather than staying on the global one', () => {
    seedAgent({ modelId: 'big' })
    const session = chat()

    session.activeProviderId.value = 'p1'
    session.activeModelId.value = 'cheap'

    expect(session.auxiliaryModel().id).toBe('cheap')
  })
})

describe('with the plugin-wide setting', () => {
  it('uses it over the chat’s own model', () => {
    seedAgent({ modelId: 'big' })
    AbeleConfig.getInstance().ai.auxiliaryModelId = 'cheap'

    expect(chat().auxiliaryModel().id).toBe('cheap')
  })
})

describe('with a model named on the agent', () => {
  it('uses it, over the plugin-wide setting', () => {
    seedAgent({ modelId: 'big', auxiliaryProviderId: 'p1', auxiliaryModelId: 'small' })
    AbeleConfig.getInstance().ai.auxiliaryModelId = 'cheap'

    expect(chat().auxiliaryModel().id).toBe('small')
  })

  it('lets one agent differ from another', () => {
    const registry = AgentRegistry.getInstance()
    seedAgent({ modelId: 'big', auxiliaryProviderId: 'p1', auxiliaryModelId: 'small' })
    const other = registry.create({
      name: 'Other',
      providerId: 'p1',
      modelId: 'big',
      auxiliaryProviderId: 'p1',
      auxiliaryModelId: 'cheap',
    })

    const session = chat()
    session.switchAgent(other.id)

    expect(session.auxiliaryModel().id).toBe('cheap')
  })

  /** A model that has since been removed must not take the chat down with it. */
  it('falls through to the setting when what it names is gone', () => {
    seedAgent({ modelId: 'big', auxiliaryProviderId: 'p1', auxiliaryModelId: 'deleted' })
    AbeleConfig.getInstance().ai.auxiliaryModelId = 'cheap'

    expect(chat().auxiliaryModel().id).toBe('cheap')
  })
})

describe('asked without a chat, as the settings screen does', () => {
  it('answers with the globally active model, as it always did', () => {
    seedAgent({ modelId: 'big' })

    expect(ChatService.getInstance().getAuxiliaryModelConfig().id).toBe('small')
  })
})
