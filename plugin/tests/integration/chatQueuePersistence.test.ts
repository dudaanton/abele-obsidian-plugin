import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { parseChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'
import { TFile } from 'obsidian'

let sessions: ChatSession[]
let app: ReturnType<typeof useVault>
beforeEach(() => {
  app = useVault([{ path: 'sample-note.md', content: 'Sample body' }])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, chatHistory: [] }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  sessions = []
})
afterEach(async () => {
  for (const session of sessions) {
    await session.flush()
    session.destroy()
  }
  vi.restoreAllMocks()
})
const createSession = () => {
  const session = new ChatSession(ChatService.getInstance())
  sessions.push(session)
  return session
}
const queue = async () => {
  const session = createSession()
  session.isStreaming.value = true
  await session.sendMessage('Sample deferred question', [
    'sample-note.md',
    'sample-image.png',
    'sample-file.pdf',
  ])
  return session
}
const fileOf = (session: ChatSession) => {
  expect(session.currentChatFile.value).toBeInstanceOf(TFile)
  return session.currentChatFile.value!
}

it('stores deferred text and attachment paths in the chat, even before its first bubble', async () => {
  const session = await queue()
  const parsed = parseChat(await app.vault.read(fileOf(session)))
  expect(parsed.metadata?.queuedMessages).toEqual(session.queuedMessages.value)
  expect(parsed.messages).toEqual([])
})

it('restores attachments after disposal and reopening without sending them automatically', async () => {
  const session = await queue()
  const queued = session.queuedMessages.value.slice()
  const file = fileOf(session)
  session.destroy()
  const restored = createSession()
  await restored.load(file)
  expect(restored.queuedMessages.value).toEqual(queued)
  expect(restored.messages.value).toEqual([])
})

it('persists removal without deleting the referenced note', async () => {
  const session = await queue()
  const file = fileOf(session)
  session.removeQueuedMessage(session.queuedMessages.value[0].id)
  await session.flush()
  const restored = createSession()
  await restored.load(file)
  expect(restored.queuedMessages.value).toEqual([])
  expect(app.vault.getAbstractFileByPath('sample-note.md')).toBeInstanceOf(TFile)
})

it('saves the old queue before resetting the tab', async () => {
  const session = await queue()
  const queued = session.queuedMessages.value.slice()
  const file = fileOf(session)
  await session.reset()
  const restored = createSession()
  await restored.load(file)
  expect(restored.queuedMessages.value).toEqual(queued)
})
