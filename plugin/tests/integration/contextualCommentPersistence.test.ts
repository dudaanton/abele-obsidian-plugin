import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatService } from '@/ai/ChatService'
import { CommentService } from '@/ai/CommentService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AgentsService } from '@/agents/AgentsService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

vi.mock('@/editor/CommentPlugin', () => ({ dispatchCommentsChanged: vi.fn() }))

const PATH = 'AI/Chats/sample-passage.abchat'
let app: ReturnType<typeof useVault>
beforeEach(() => {
  app = useVault([
    {
      path: PATH,
      content: serializeChat({
        metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '' },
        messages: [
          { id: 'sample-reply', role: 'assistant', content: 'A quiet garden path.', timestamp: 1 },
        ],
        internalMessages: [],
      }),
    },
  ])
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
})
afterEach(() => {
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AgentsService.destroyCurrent()
  ChatStorage.destroy()
  AgentRegistry.destroy()
  vi.restoreAllMocks()
})

it.each(['ready', 'loading'])(
  'shares a %s marker reader and saves its comment before contextual replacement',
  async (reader) => {
    const chats = ChatService.getInstance(),
      comments = CommentService.getInstance()
    await chats.openChatFile(app.vault.getFileByPath(PATH)!)
    const parent = chats.getSessionByFile(PATH)!
    // A visible marker can discover the file as soon as creation publishes it, before the
    // creator resumes. That reader and the creator must acquire the same log writer.
    const create = app.vault.create.bind(app.vault)
    let discovery: ReturnType<CommentService['load']> | undefined
    const storage = ChatStorage.getInstance(),
      load = storage.loadChat.bind(storage)
    const reading = deferred(),
      readGate = deferred()
    let delayed = false
    vi.spyOn(storage, 'loadChat').mockImplementation(async (file) => {
      if (reader === 'loading' && !delayed && file.path.startsWith('AI/Comments/')) {
        delayed = true
        reading.resolve()
        await readGate.promise
      }
      return load(file)
    })
    vi.spyOn(app.vault, 'create').mockImplementation(async (path, content) => {
      const file = await create(path, content)
      if (path.startsWith('AI/Comments/')) {
        discovery = comments.load(file.basename, file)
        if (reader === 'ready') await discovery
      }
      return file
    })
    const creating = comments.createOnMessage(parent, 'sample-reply', 'garden', 8)
    if (reader === 'loading') {
      await reading.promise
      readGate.resolve()
    }
    const child = (await creating)!
    expect(child === (await discovery)).toBe(true)
    expect(chats.activeSession.value === child).toBe(true)
    await child.addUserNote('An invented question about the garden.')
    chats.switchTab(parent.id)
    const second = (await comments.createOnMessage(parent, 'sample-reply', 'garden', 8))!
    expect(chats.activeSession.value === second).toBe(true)
    expect(chats.getSession(child.id)).toBeNull()
    expect(comments.sessionFor(child.commentId!) === child).toBe(true)
    expect(parseChat(await app.vault.read(child.currentChatFile.value!)).messages[0].content).toBe(
      'An invented question about the garden.'
    )
    await expect(child.saveForRelease()).resolves.toBeUndefined()
  }
)
