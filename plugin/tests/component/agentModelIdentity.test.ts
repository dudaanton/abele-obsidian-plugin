import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import AiAgentSelector from '@/components/AiAgentSelector.vue'

const f = vi.hoisted(() => ({ provider: 'sample-provider' }))
vi.mock('@/ai/ChatService', () => ({
  ChatService: {
    getInstance: () => ({
      activeSession: {
        value: {
          place: { value: null },
          messages: { value: [{}] },
          agent: {
            value: {
              id: 'sample-agent',
              name: 'Sample agent',
              providerId: 'sample-provider',
              modelId: 'sample-model',
            },
          },
          activeProviderId: { value: f.provider },
          activeModelId: { value: 'sample-model' },
          resolveModel: () => ({ id: 'sample-model', name: 'Sample model' }),
          isOverridden: () => true,
        },
      },
    }),
  },
}))
vi.mock('@/ai/agents/AgentRegistry', () => ({
  AgentRegistry: {
    getInstance: () => ({ list: () => [{ id: 'sample-agent', name: 'Sample agent' }] }),
  },
}))
vi.mock('@/services/AbeleConfig', () => ({
  AbeleConfig: {
    getInstance: () => ({
      ai: {
        providers: [
          { id: 'sample-provider', models: [{ id: 'sample-model', name: 'Sample model' }] },
        ],
      },
    }),
  },
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: { getInstance: () => ({ nodes: { value: [] } }) },
}))

it.each(['sample-provider', 'other-provider'])(
  'compares actual provider and model identities rather than the presence of an override (%s)',
  (provider) => {
    f.provider = provider
    const wrapper = mount(AiAgentSelector)
    try {
      expect(wrapper.find('.abele-agent-selector__model').exists()).toBe(
        provider !== 'sample-provider'
      )
    } finally {
      wrapper.unmount()
    }
  }
)
