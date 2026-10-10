import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { acceptRevision, undoRevision } from '@/ai/replyAnnotations'
import { captureChatSelection } from '@/selection/anchors'
import type { RevisionPorts } from '@/selection/types'
import { ChatSelectionBindings } from '@/ai/chatBindings'
import { EMPTY_USAGE } from '@/ai/client'

const PATH = 'AI/Chats/sample-anchor.abchat'
const TEXT = 'A lantern beside another lantern.'
let app: ReturnType<typeof useVault>
let session: ChatSession
let counter: number
const ports: RevisionPorts = {
  nextId: () => `sample-id-${++counter}`,
  project: (text) => ({ version: 'plain-v1', text }),
}
const file = () => app.vault.getAbstractFileByPath(PATH) as TFile
const disk = async () => parseChat(await app.vault.read(file()))
const capture = async (start = 2) =>
  captureChatSelection({
    revision: await session.ensureSelectionRevision('reply', ports),
    range: { space: 'rendered', start, end: start + 7 },
    role: 'assistant',
    author: 'Sample agent',
    sentence: TEXT,
    title: 'Sample chat',
    pathHint: PATH,
  })
const reopen = async () => {
  session.destroy()
  session = new ChatSession(ChatService.getInstance())
  await session.load(file())
}

beforeEach(async () => {
  counter = 0
  app = useVault([
    {
      path: PATH,
      content: serializeChat({
        metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '' },
        messages: [{ id: 'reply', role: 'assistant', content: TEXT, timestamp: 1 }],
        internalMessages: [
          {
            role: 'assistant',
            chatMessageId: 'reply',
            content: [{ type: 'text', text: TEXT }],
            model: 'sample',
            timestamp: 1,
            usage: EMPTY_USAGE,
            stopReason: 'stop',
          },
        ],
      }),
    },
  ])
  ChatStorage.destroy()
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  session = new ChatSession(ChatService.getInstance())
  await session.load(file())
})
afterEach(() => session.destroy())

const bindings = () =>
  new ChatSelectionBindings(session, async (source) =>
    source.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
  )
const bind = async () => {
  const snapshot = await capture(25)
  const anchor = await session.ensureChatAnchor(snapshot, ports.nextId)
  return bindings().bind(snapshot, anchor.id, 'Cards/Sample.md')
}

it('journals the card, publishes atomic evidence, preserves anchors/history, reopens and undoes only its link', async () => {
  await app.vault.createFolder('Cards')
  await app.vault.create('Cards/Sample.md', 'A sample card.')
  const history = (await disk()).internalMessages
  const result = await bind()
  expect(result.status).toBe('applied')
  expect((await disk()).messages[0].content).toBe(
    'A lantern beside another [[Cards/Sample|lantern]].'
  )
  expect((await disk()).internalMessages).toEqual(history)
  const message = session.allMessages.value[0]
  expect(message.selection?.anchors[0].placements).toHaveLength(2)
  const model = (session as any).getMessagesForModel()
  expect(model[0].content[0].text).toBe(TEXT)
  expect(model.at(-1).role).toBe('user')
  expect(model.at(-1).content).toContain('Cards/Sample.md')
  expect(model.at(-1).content).not.toContain('A sample card.')
  await reopen()
  await bindings().undo(result.operationId)
  expect((await disk()).messages[0].content).toBe(TEXT)
  expect((session as any).getMessagesForModel()).toEqual(history)
  expect(app.vault.getAbstractFileByPath('Cards/Sample.md')).toBeTruthy()
})

it('retains a failed publication and retries only binding, without duplicate links/cards', async () => {
  await app.vault.createFolder('Cards')
  await app.vault.create('Cards/Sample.md', 'Sample')
  const process = app.vault.process.bind(app.vault)
  let writes = 0
  vi.spyOn(app.vault, 'process').mockImplementation(async (file, fn) => {
    if (++writes === 5) throw Error('sample known-no-write')
    return process(file, fn)
  })
  const result = await bind()
  expect(result.status).toBe('known-not-written')
  expect(result.recoverable).toBe(true)
  expect((await disk()).messages[0].content).toBe(TEXT)
  await reopen()
  expect((await bindings().retry(result.operationId)).status).toBe('applied')
  expect((await bindings().retry(result.operationId)).status).toBe('applied')
  expect((await disk()).messages[0].decorationOperations).toHaveLength(1)
})

it('serializes concurrent binding-only retries by operation identity', async () => {
  await app.vault.createFolder('Cards')
  await app.vault.create('Cards/Sample.md', 'Sample')
  const process = app.vault.process.bind(app.vault)
  let writes = 0
  vi.spyOn(app.vault, 'process').mockImplementation(async (file, fn) => {
    if (++writes === 5) throw Error('Sample prepublication failure')
    return process(file, fn)
  })
  const failed = await bind()
  const results = await Promise.all([
    bindings().retry(failed.operationId),
    bindings().retry(failed.operationId),
  ])
  expect(results.map((result) => result.status)).toEqual(['applied', 'applied'])
  expect((await disk()).messages[0].decorationOperations).toHaveLength(1)
  expect((await disk()).metadata?.bindingRecovery?.[0].status).toBe('applied')
})

it('settles lost acknowledgement only by atomically persisted operation evidence', async () => {
  await app.vault.createFolder('Cards')
  await app.vault.create('Cards/Sample.md', 'Sample')
  const process = app.vault.process.bind(app.vault)
  vi.spyOn(app.vault, 'process').mockImplementation(async (file, fn) => {
    const value = await process(file, fn)
    if ((await disk()).messages[0].decorationOperations?.length)
      throw Error('sample lost acknowledgement')
    return value
  })
  expect((await bind()).status).toBe('applied')
  expect(session.allMessages.value[0].content).toContain('[[Cards/Sample|lantern]]')
})

it('keeps uncertainty across reopen and never retries based on matching bytes', async () => {
  await app.vault.createFolder('Cards')
  await app.vault.create('Cards/Sample.md', 'Sample')
  const process = app.vault.process.bind(app.vault)
  let writes = 0
  vi.spyOn(app.vault, 'process').mockImplementation(async (file, fn) => {
    if (++writes === 5) {
      fn(await app.vault.read(file))
      throw Error('sample interrupted acknowledgement')
    }
    return process(file, fn)
  })
  const result = await bind()
  expect(result.status).toBe('uncertain')
  const previous = await app.vault.read(file())
  await session.save()
  expect(await app.vault.read(file())).toBe(previous)
  await reopen()
  const count = writes
  expect((await bindings().retry(result.operationId)).status).toBe('uncertain')
  expect(writes).toBe(count)
  expect((await disk()).metadata?.bindingRecovery?.[0].status).toBe('uncertain')
})

it('translates ownership across other bindings and card renames without copying retained sources', async () => {
  await app.vault.createFolder('Cards')
  await app.vault.create('Cards/Sample.md', 'Sample')
  await app.vault.create('Cards/Other.md', 'Other')
  const first = await bind()
  const snapshot = captureChatSelection({
    revision: await session.ensureSelectionRevision('reply', {
      nextId: ports.nextId,
      project: (source) => ({
        version: 'plain-v1',
        text: source.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2'),
      }),
    }),
    range: { space: 'rendered', start: 2, end: 9 },
    role: 'assistant',
    author: 'Sample',
    sentence: TEXT,
    title: 'Sample',
    pathHint: PATH,
  })
  const anchor = await session.ensureChatAnchor(snapshot, ports.nextId)
  const second = await bindings().bind(snapshot, anchor.id, 'Cards/Other.md')
  expect(second.status).toBe('applied')
  await app.vault.rename(
    app.vault.getAbstractFileByPath('Cards/Sample.md') as TFile,
    'Cards/Renamed.md'
  )
  await bindings().rename('Cards/Sample.md', 'Cards/Renamed.md')
  expect((await disk()).messages[0].content).toBe(
    'A [[Cards/Other|lantern]] beside another [[Cards/Renamed|lantern]].'
  )
  expect(
    (await disk()).messages[0].decorationOperations!.every(
      (op) => op.publishedContent === undefined
    )
  ).toBe(true)
  await bindings().undo(first.operationId)
  expect((await disk()).messages[0].content).toBe(
    'A [[Cards/Other|lantern]] beside another lantern.'
  )
  await bindings().undo(second.operationId)
  expect((await disk()).messages[0].content).toBe(TEXT)
})

it('undoes a link without erasing a later semantic correction and keeps correction undo available', async () => {
  await app.vault.createFolder('Cards')
  await app.vault.create('Cards/Sample.md', 'Sample')
  const result = await bind()
  const message = session.allMessages.value[0]
  const corrected = acceptRevision(
    message,
    {
      id: 'sample-correction',
      parent: PATH,
      message: 'reply',
      before: message.content,
      from: message.content.length - 1,
      old: '.',
      text: '. More.',
      request: '',
      author: 'Sample',
      at: 2,
      status: 'pending',
    },
    2
  )
  // Use the final punctuation as the semantic patch, outside the bound word.
  ;(session as any).updateChatMessage(
    (m: any) => m.id === 'reply',
    () => corrected
  )
  await bindings().undo(result.operationId)
  expect((await disk()).messages[0].content).toBe(TEXT + ' More.')
  expect(undoRevision(session.allMessages.value[0], 3).content).toBe(TEXT)
})

it('never retargets stale source and leaves card path recoverable when mapping fails', async () => {
  await app.vault.createFolder('Cards')
  await app.vault.create('Cards/Sample.md', 'Sample')
  const snapshot = await capture(25)
  const anchor = await session.ensureChatAnchor(snapshot, ports.nextId)
  const source = session.allMessages.value[0]
  ;(session as any).updateChatMessage(
    (m: any) => m.id === 'reply',
    () =>
      acceptRevision(
        source,
        {
          id: 'sample-change',
          parent: PATH,
          message: 'reply',
          before: TEXT,
          from: 0,
          old: 'A',
          text: 'The',
          request: '',
          author: 'Sample',
          at: 2,
          status: 'pending',
        },
        2
      )
  )
  const result = await bindings().bind(snapshot, anchor.id, 'Cards/Sample.md')
  expect(result.status).toBe('known-not-written')
  expect(result.targetPath).toBe('Cards/Sample.md')
  expect(session.allMessages.value[0].content).not.toContain('[[')
})
