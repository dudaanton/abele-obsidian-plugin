import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { DraftImports } from '@/ai/draftImports'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { serializeChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'

let session: ChatSession
let file: TFile
beforeEach(() => {
  const app = useVault([{ path: 'Chats/sample.abchat', content: serializeChat({
    metadata: { type: 'abele-chat', title: 'Sample', created: '2026-01-01' },
    messages: [], internalMessages: [],
  }) }])
  file = app.vault.getAbstractFileByPath('Chats/sample.abchat') as TFile
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  session = new ChatSession(ChatService.getInstance())
})
afterEach(() => { session.destroy(); vi.restoreAllMocks() })

it('changes identity synchronously before reset awaits saving the old conversation', async () => {
  const previous = session.conversationVersion.value
  let finish!: () => void
  vi.spyOn(session, 'save').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  const resetting = session.reset()
  expect(session.conversationVersion.value).toBe(previous + 1)
  finish()
  await resetting
})
it('loading another conversation changes identity while retaining the tab ID', async () => {
  const previous = session.conversationVersion.value
  const id = session.id
  await session.load(file)
  expect(session.id).toBe(id)
  expect(session.conversationVersion.value).toBe(previous + 1)
})
it('keeps the owned draft and pending imports when saving the conversation', async () => {
  const draft = session.draft.value
  draft.text = 'An unfinished sample message'
  draft.imports = new DraftImports(draft, { sessionId: session.id, version: session.conversationVersion.value })
  const done = draft.imports.begin('sample-import')!
  await session.save()
  expect(session.draft.value).toBe(draft)
  expect(session.draft.value.text).toBe('An unfinished sample message')
  expect(session.draft.value.imports?.pending.size).toBe(1)
  done()
})
it('retires the owned draft synchronously before reset waits on storage', async () => {
  const draft = session.draft.value
  draft.text = 'A retired sample draft'
  draft.imports = new DraftImports(draft, { sessionId: session.id, version: session.conversationVersion.value })
  let finish!: () => void
  vi.spyOn(session, 'save').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  const resetting = session.reset()
  expect(draft.imports.active).toBe(false)
  expect(session.draft.value).not.toBe(draft)
  expect(session.draft.value.text).toBe('')
  finish()
  await resetting
})
it('retires the owned draft when its session is destroyed', () => {
  const draft = session.draft.value
  draft.imports = new DraftImports(draft, { sessionId: session.id, version: session.conversationVersion.value })
  session.destroy()
  expect(draft.imports.active).toBe(false)
  expect(session.draft.value).not.toBe(draft)
})

it('saving does not change conversation identity; destroying invalidates it', async () => {
  const previous = session.conversationVersion.value
  await session.save()
  expect(session.conversationVersion.value).toBe(previous)
  session.destroy()
  expect(session.conversationVersion.value).toBe(previous + 1)
})
