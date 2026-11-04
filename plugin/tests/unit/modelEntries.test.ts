import { expect, it } from 'vitest'
import { TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { serializeChat } from '@/ai/ChatLog'
import { createAgent } from '@/ai/agents/types'
import { findModelEntry, migrateModelEntries, modelChoiceKey } from '@/ai/modelEntries'
import type { AiProvider } from '@/ai/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

const provider = (): AiProvider => ({
  id: 'sample',
  name: 'Sample',
  baseUrl: 'https://sample.invalid/v1',
  apiKeyId: '',
  models: ['medium', 'high'].map((effort) => ({
    id: 'sample-model',
    name: effort,
    contextWindow: 1000,
    maxTokens: 100,
    supportsReasoning: true,
    reasoningEffort: effort as 'medium' | 'high',
  })),
})

it('migrates independently to the same keys and keeps identity through edits and reordering', () => {
  const first = provider(),
    otherDevice = provider()
  expect(migrateModelEntries([first])).toBe(true)
  migrateModelEntries([otherDevice])
  expect(first).toEqual(otherDevice)
  expect(migrateModelEntries([first])).toBe(false)
  const second = first.models[1]
  const key = second.entryId!
  expect(key).not.toBe(first.models[0].entryId)
  second.id = 'sample-renamed'
  second.name = 'Renamed'
  first.models.reverse()
  expect(findModelEntry(first.models, key)).toBe(second)
  expect(modelChoiceKey([first], 'sample', key)).toBe(`sample::${key}`)
})

it.each(['sample-model', 'sample-high'])(
  'loads chat model reference %s without losing its entry settings',
  async (reference) => {
    const app = useVault([
      {
        path: 'Chats/sample.abchat',
        content: serializeChat({
          metadata: {
            type: 'abele-chat',
            title: 'Sample',
            created: '2034-01-01',
            agentId: 'sample-agent',
            overrides: { providerId: 'sample', modelId: reference },
          },
          messages: [],
          internalMessages: [],
        }),
      },
    ])
    const config = AbeleConfig.getInstance()
    config.applySettings()
    const configured = provider()
    configured.models[0].entryId = 'sample-medium'
    configured.models[1].entryId = 'sample-high'
    config.ai.providers = [configured]
    config.ai.agents = [
      createAgent({ id: 'sample-agent', providerId: 'sample', modelId: 'sample-model' }),
    ]
    config.ai.defaultAgentId = 'sample-agent'
    const session = new ChatSession(ChatService.getInstance())
    try {
      await session.load(app.vault.getAbstractFileByPath('Chats/sample.abchat') as TFile)
      expect(session.activeModelId.value).toBe(reference)
      expect(session.resolveModel()).toMatchObject({
        id: 'sample-model',
        reasoningEffort: reference === 'sample-high' ? 'high' : 'medium',
      })
    } finally {
      session.destroy()
    }
  }
)
