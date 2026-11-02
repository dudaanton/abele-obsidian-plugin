import { afterEach, expect, it, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { ChatStorage } from '@/ai/ChatStorage'
import { ChatLogWriter, serializeMetadata, type ChatSnapshot } from '@/ai/ChatLog'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

destroyChatsAfterEach()
afterEach(() => {
  ChatStorage.destroy()
  vi.restoreAllMocks()
})

// A long-lived log is mostly repeated metadata, not one enormous visible message. Keep
// the generated data anonymous and in memory; never check a captured conversation in.
function syntheticLog(): string {
  const tools = Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`call-${i}`, 'done']))
  const metadata: ChatSnapshot['metadata'] = {
    type: 'abele-chat',
    title: 'Invented long conversation',
    attention: { tools: tools as Record<string, 'done'> },
    summary: 'Invented summary. '.repeat(50),
  }
  const lines: string[] = []
  for (let i = 0; i < 3000; i++) {
    lines.push(serializeMetadata({ ...metadata, recap: 'Invented recap. '.repeat(1200) }))
    lines.push(
      JSON.stringify({
        k: 'msg',
        id: `message-${i}`,
        role: 'assistant',
        content: 'Invented answer. '.repeat(40),
        timestamp: i + 1,
      }) + '\n'
    )
    lines.push(
      JSON.stringify({
        k: 'int',
        role: 'toolResult',
        toolCallId: `call-${i}`,
        toolName: 'read',
        content: [{ type: 'text', text: 'Invented result. '.repeat(110) }],
        timestamp: i + 1,
      }) + '\n'
    )
  }
  return lines.join('')
}

it('bounds whole-file reads while loading and appending a metadata-heavy 100MB log', async () => {
  const app = useVault([])
  ChatStorage.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    chatFolder: 'SampleChats',
    chatHistory: [],
  }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  await app.vault.createFolder('SampleChats')
  let text = syntheticLog()
  expect(Buffer.byteLength(text)).toBeGreaterThan(100_000_000)
  const file = await app.vault.create('SampleChats/Invented.abchat', text)
  text = ''
  const read = vi.spyOn(app.vault, 'read')
  const append = vi.spyOn(app.vault, 'append')
  const storage = ChatStorage.getInstance()
  const loaded = await storage.loadChat(file as unknown as TFile)
  const loadReads = read.mock.calls.length
  const writer = new ChatLogWriter()
  writer.adopt(loaded)
  const snapshot: ChatSnapshot = {
    metadata: loaded.metadata!,
    messages: loaded.messages,
    internalMessages: loaded.internalMessages,
  }
  snapshot.messages.push({
    id: 'new-message',
    role: 'user',
    content: 'Invented next question',
    timestamp: 4000,
  })
  const plan = writer.plan(snapshot)
  expect(plan.kind).toBe('append')
  expect(plan.kind === 'append' && plan.data.length).toBeLessThan(1000)
  read.mockClear()
  await storage.saveChat(snapshot, plan, file as unknown as TFile)
  const saveReads = read.mock.calls.length
  writer.commit(snapshot, plan)
  expect(append).toHaveBeenCalledOnce()
  // Storage also commits monotone attention resolutions; that metadata is not a rewrite.
  expect(plan.kind === 'append' && plan.data.length).toBeLessThan(100_000)
  console.info('LONG_LOG_READS', JSON.stringify({ loadReads, saveReads }))
  // Every read can allocate another two-byte copy of the entire log in Chromium.
  // An append must not need a stack of recovery, validation and readback transcripts.
  expect(loadReads).toBeLessThanOrEqual(3)
  expect(saveReads).toBeLessThanOrEqual(3)
  const reopened = await storage.loadChat(file as unknown as TFile)
  expect(reopened.messages).toHaveLength(3001)
  expect(reopened.internalMessages).toHaveLength(3000)
  expect(reopened.messages.at(-1)?.id).toBe('new-message')
}, 30000)
