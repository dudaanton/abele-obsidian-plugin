import { afterEach, expect, it, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { performance } from 'node:perf_hooks'
import { ChatStorage } from '@/ai/ChatStorage'
import { ChatLogWriter, serializeChat, type ChatSnapshot } from '@/ai/ChatLog'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

destroyChatsAfterEach()
afterEach(() => {
  ChatStorage.destroy()
  vi.restoreAllMocks()
})

it('measures full synthetic 47MB storage load and append without a real vault', async () => {
  const app = useVault([])
  ChatStorage.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    chatFolder: 'SampleChats',
    chatHistory: [],
  }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  const state: ChatSnapshot = {
    metadata: { type: 'abele-chat', title: 'Synthetic storage sample', created: '2034-01-01' },
    messages: Array.from({ length: 2000 }, (_, i) => ({
      id: `sample-${i}`,
      role: i % 2 ? 'assistant' : 'user',
      content: 'Sample '.repeat(820),
      timestamp: i + 1,
    })),
    internalMessages: Array.from({ length: 2000 }, (_, i) => ({
      role: 'user',
      content: 'Sample '.repeat(2450),
      timestamp: i + 1,
    })),
  }
  let text = serializeChat(state)
  state.messages[0].content += 'x'.repeat(47_000_000 - Buffer.byteLength(text))
  text = serializeChat(state)
  expect(Buffer.byteLength(text)).toBe(47_000_000)
  await app.vault.createFolder('SampleChats')
  const file = await app.vault.create('SampleChats/Synthetic.abchat', text)
  text = ''
  const read = vi.spyOn(app.vault, 'read')
  const append = vi.spyOn(app.vault, 'append')
  const storage = ChatStorage.getInstance()
  const before = performance.now()
  const loaded = await storage.loadChat(file as unknown as TFile)
  const loadedAt = performance.now()
  const loadReads = read.mock.calls.length
  expect(loaded.messages).toHaveLength(2000)
  const writer = new ChatLogWriter()
  writer.adopt(loaded)
  const next: ChatSnapshot = {
    metadata: loaded.metadata!,
    messages: loaded.messages,
    internalMessages: loaded.internalMessages,
  }
  next.messages.push({
    id: 'sample-new',
    role: 'assistant',
    content: 'Sample new turn',
    timestamp: 3000,
  })
  read.mockClear()
  const plannedAt = performance.now()
  const plan = writer.plan(next)
  const saveAt = performance.now()
  expect(plan.kind).toBe('append')
  await storage.saveChat(next, plan, file as unknown as TFile)
  const savedAt = performance.now()
  expect(append).toHaveBeenCalledOnce()
  const bytes = plan.kind === 'append' ? Buffer.byteLength(plan.data) : 0
  expect(bytes).toBeLessThan(1000)
  console.info(
    'SYNTHETIC_STORAGE',
    JSON.stringify({
      loadMs: loadedAt - before,
      planMs: saveAt - plannedAt,
      saveMs: savedAt - saveAt,
      loadReads,
      saveReads: read.mock.calls.length,
      appendBytes: bytes,
    })
  )
  const parsed = await storage.loadChat(file as unknown as TFile)
  expect(parsed.messages.at(-1)?.id).toBe('sample-new')
}, 30000)
