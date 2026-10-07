import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsService } from '@/agents/AgentsService'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { serializeChat, parseChatMetadata } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'

const evidence = { errors: [{ id: 'error-1', at: 10, text: 'Sample run failure' }] }
const content = (extra = {}) =>
  serializeChat({
    metadata: {
      type: 'abele-chat',
      providerId: '',
      modelId: '',
      created: '',
      title: 'Sample chat',
      attention: evidence,
      ...extra,
    },
    messages: [],
    internalMessages: [],
  })
beforeEach(() => {
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})
afterEach(() => {
  ChatService.getInstance().destroy()
  AgentsService.destroyCurrent()
  ChatStorage.destroy()
})

describe('one list independent of open tabs', () => {
  it('finds unopened chats and discussions without creating a session', async () => {
    useVault([
      { path: 'Chats/sample.abchat', content: content() },
      {
        path: 'Comments/sample.abchat',
        content: content({
          kind: 'comment',
          anchor: { note: 'Notes/sample.md', quote: 'An invented passage' },
        }),
      },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    expect(agents.rows.value).toHaveLength(2)
    expect(
      agents.rows.value.find((r) => r.reference.path === 'Comments/sample.abchat')?.source
    ).toBe('Обсуждение · Notes/sample.md')
    expect(ChatService.getInstance().getAllSessions()).toHaveLength(0)
    expect(agents.badge.value.attention).toBe(2)
  })
  it('follows rename and deletion and keeps closed discussions', async () => {
    const app = useVault([{ path: 'Chats/sample.abchat', content: content() }])
    const agents = AgentsService.getInstance()
    await agents.start()
    const file = app.vault.getFileByPath('Chats/sample.abchat')!
    await app.fileManager.renameFile(file, 'Chats/renamed.abchat')
    await agents.refresh()
    expect(agents.rows.value[0].reference.path).toBe('Chats/renamed.abchat')
    await app.vault.delete(file)
    await agents.refresh()
    expect(agents.rows.value).toHaveLength(0)
  })
  it('persists only references, reasons and identities in the local index', async () => {
    const app = useVault([{ path: 'Chats/sample.abchat', content: content() }])
    const agents = AgentsService.getInstance()
    await agents.start()
    const stored = JSON.stringify(app.loadLocalStorage('abele-agents-index'))
    expect(stored).toContain('error-1')
    expect(stored).not.toContain('Sample run failure')
    expect(stored).not.toContain('Sample chat')
  })
  it('marks the specific error seen without opening or running the conversation', async () => {
    const app = useVault([{ path: 'Chats/sample.abchat', content: content() }])
    const agents = AgentsService.getInstance()
    await agents.start()
    await agents.markSeen(agents.rows.value[0], 'error-1')
    expect(agents.rows.value).toHaveLength(0)
    expect(ChatService.getInstance().getAllSessions()).toHaveLength(0)
    expect(
      parseChatMetadata(await app.vault.adapter.read('Chats/sample.abchat'))?.attention?.errors?.[0]
        .seen
    ).toBe(true)
  })
  it('deduplicates a live discussion against its file and keeps its error after closure', async () => {
    useVault([])
    const agents = AgentsService.getInstance()
    await agents.start()
    const session = new ChatSession(ChatService.getInstance(), undefined, { kind: 'comment' })
    await session.addUserNote('Sample question')
    session.recordAttentionError('Sample failure')
    await session.save()
    await agents.refresh()
    expect(agents.rows.value).toHaveLength(1)
    session.destroy()
    expect(agents.rows.value).toHaveLength(1)
  })
  it('keeps a newer indexed run as interrupted when its file predates the transition', async () => {
    const app = useVault([
      { path: 'Chats/sample.abchat', content: content({ attention: undefined }) },
    ])
    app.saveLocalStorage('abele-agents-index', [
      {
        reference: { kind: 'local', path: 'Chats/sample.abchat' },
        reasons: [{ kind: 'running', id: 'new-run', at: 100 }],
      },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    expect(agents.rows.value[0]?.reasons).toContainEqual({
      kind: 'interrupted',
      id: 'new-run',
      at: 100,
    })
  })
  it('reports incomplete data rather than a confident zero on a read failure', async () => {
    const app = useVault([{ path: 'Chats/sample.abchat', content: content() }])
    vi.spyOn(app.vault, 'read').mockRejectedValue(new Error('Sample storage unavailable'))
    const agents = AgentsService.getInstance()
    await agents.start()
    expect(agents.badge.value.incomplete).toBe(true)
  })
})
