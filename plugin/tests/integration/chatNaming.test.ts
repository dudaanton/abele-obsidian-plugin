import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { chatsOf } from '@/chats/chatTree'
import { parseChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'

let service: ChatService
let titleReady: Promise<void>
let releaseTitle: () => void
beforeEach(() => {
  titleReady = Promise.resolve()
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    sequentialAuxiliary: true,
    agents: [],
    chatHistory: [],
    providers: [
      {
        id: 'sample',
        name: 'Sample',
        baseUrl: 'http://localhost/v1',
        apiKeyId: '',
        models: [
          {
            id: 'sample-model',
            name: 'Sample',
            contextWindow: 100000,
            maxTokens: 100,
            supportsReasoning: false,
          },
        ],
      },
    ],
  }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Sample', providerId: 'sample', modelId: 'sample-model' })
  registry.setDefault(agent.id)
  service = ChatService.getInstance()
  vi.spyOn(service, 'getSystemPrompt').mockResolvedValue('Sample assistant')
  vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(async function* (model, system) {
    if (system.includes('chat titles')) await titleReady
    const text = system.includes('chat titles') ? 'Sample garden plan' : 'Use seasonal plants.'
    yield { type: 'text_delta', delta: text }
    yield {
      type: 'done',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
        model: model.id,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
        stopReason: 'stop',
        timestamp: 1,
      },
    }
  })
})

it('persists a title that finishes after the other background work', async () => {
  AbeleConfig.getInstance().ai.sequentialAuxiliary = false
  titleReady = new Promise((resolve) => {
    releaseTitle = resolve
  })
  const id = service.createTab()
  const session = service.getSession(id)!
  await session.sendMessage('Plan a small garden')
  await vi.waitFor(() => expect(session.summary.value).toBe('Use seasonal plants.'))
  await session.flush()
  releaseTitle()
  await vi.waitFor(() => expect(session.isGeneratingTitle.value).toBe(false))
  await session.flush()
  const file = session.currentChatFile.value!
  expect(parseChat(await GlobalStore.getInstance().app.vault.read(file)).metadata?.title).toBe(
    'Sample garden plan'
  )
  await service.tree.refresh()
  expect(chatsOf(service.tree.root.value).find((chat) => chat.id === id)?.title).toBe(
    'Sample garden plan'
  )
  await session.load(file)
  expect(service.listOpenChats().find((chat) => chat.id === id)?.title).toBe('Sample garden plan')
})

it('keeps a title chosen through the tree before the first exchange', async () => {
  const id = service.createTab()
  const session = service.getSession(id)!
  service.tree.rename(id, 'Chosen garden title')
  await vi.waitFor(() => expect(session.manualTitle.value).toBe(true))
  await session.sendMessage('Plan a small garden')
  await session.flush()
  expect(session.chatTitle.value).toBe('Chosen garden title')
  expect(service.listOpenChats().find((chat) => chat.id === id)?.title).toBe('Chosen garden title')
  expect(chatsOf(service.tree.root.value).find((chat) => chat.id === id)?.title).toBe(
    'Chosen garden title'
  )
  const file = session.currentChatFile.value!
  await session.load(file)
  expect(session.chatTitle.value).toBe('Chosen garden title')
  expect(session.manualTitle.value).toBe(true)
})
afterEach(() => service.destroy())

it('names the first exchange in the tab and tree and retains it on reopen', async () => {
  const id = service.createTab()
  const session = service.getSession(id)!
  await session.sendMessage('Plan a small garden')
  expect(session.chatTitle.value).toBe('Sample garden plan')
  expect(service.listOpenChats().find((chat) => chat.id === id)?.title).toBe('Sample garden plan')
  expect(chatsOf(service.tree.root.value).find((chat) => chat.id === id)?.title).toBe(
    'Sample garden plan'
  )
  const file = session.currentChatFile.value!
  const saved = parseChat(await GlobalStore.getInstance().app.vault.read(file))
  expect(saved.metadata?.title).toBe('Sample garden plan')
  await session.load(file)
  expect(service.listOpenChats().find((chat) => chat.id === id)?.title).toBe('Sample garden plan')
})
