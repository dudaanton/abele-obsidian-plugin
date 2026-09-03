/**
 * What links a chat to a note: writing to it.
 *
 * A chat that changed a note becomes visible from that note, so the record of what it changed
 * has to be exact. Reading links nothing, a call that threw links nothing, and a run — which is
 * never listed anywhere — links nothing either. The record lives in the chat file's own meta,
 * which is the source of truth; the index in the settings is only ever a copy of it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { GlobalStore } from '@/stores/GlobalStore'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { parseChatMetadata, serializeChat } from '@/ai/ChatLog'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import type { AgentTool } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

// The editor is not standing up here: `dispatchCommentsChanged` walks the workspace's leaves,
// which a fake vault has none of. Nothing in this file observes the repaint.
vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))

const NOTE_A = 'Notes/A.md'
const NOTE_B = 'Notes/B.md'

let app: FakeApp

/** A session scoped to `Notes`, with one message so `save()` has something to write. */
function newSession(kind: 'chat' | 'run' | 'comment' = 'chat'): ChatSession {
  const session = new ChatSession(ChatService.getInstance(), undefined, { kind })
  session.scopeResolver.entries.value = [{ type: 'folder', path: 'Notes' }]
  session.permissionMode.value = 'allow-all'
  ;(session as unknown as { allChatMessages: ChatMessage[] }).allChatMessages = [
    { id: 'm1', role: 'user', content: 'tidy A', timestamp: 1 },
  ]
  return session
}

/** The session's own tools, wrapped as a turn would hand them to the loop. */
function toolOf(session: ChatSession, name: string): AgentTool {
  const tools = (session as unknown as { getTools: () => AgentTool[] }).getTools()
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`no ${name} tool`)
  return tool
}

const paths = (session: ChatSession): string[] => session.touched.value.map((t) => t.path)

beforeEach(() => {
  app = useVault([
    { path: NOTE_A, content: 'alpha content here\n' },
    { path: NOTE_B, content: 'beta content here\n' },
  ])
  AgentRegistry.destroy()
  ChatStorage.destroy()
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    chatFolder: 'AI/Chats/{{name}}',
    commentFolder: 'AI/Comments',
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  AgentRegistry.getInstance().setDefault(AgentRegistry.getInstance().create({ name: 'D' }).id)
  AbeleConfig.getInstance().ai.commentAgentId = AgentRegistry.getInstance().create({
    name: 'Comment',
    utility: true,
  }).id
  GlobalStore.getInstance().chatLinksVersion.value = 0
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
})

describe('a chat that writes to a note', () => {
  it('records the path and when it wrote', async () => {
    const session = newSession()
    const before = Date.now()

    await toolOf(session, 'edit').execute('c1', {
      path: NOTE_A,
      old_string: 'alpha',
      new_string: 'ALPHA',
    })

    expect(paths(session)).toEqual([NOTE_A])
    expect(new Date(session.touched.value[0].at).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('writes the record into its file, and reads it back on load', async () => {
    const session = newSession()
    await toolOf(session, 'edit').execute('c1', {
      path: NOTE_A,
      old_string: 'alpha',
      new_string: 'ALPHA',
    })
    await session.save()

    const file = session.currentChatFile.value as TFile
    const meta = parseChatMetadata(await app.vault.read(file))
    expect(meta?.touched?.map((t) => t.path)).toEqual([NOTE_A])

    const reopened = new ChatSession(ChatService.getInstance())
    await reopened.load(file)
    expect(paths(reopened)).toEqual([NOTE_A])
    expect(reopened.touched.value[0].at).toBe(session.touched.value[0].at)
  })

  it('keeps one entry per note, in first-write order, with the latest time', async () => {
    const session = newSession()
    const edit = toolOf(session, 'edit')

    await edit.execute('c1', { path: NOTE_A, old_string: 'alpha', new_string: 'ALPHA' })
    const first = session.touched.value[0].at
    await new Promise((resolve) => setTimeout(resolve, 2))
    await edit.execute('c2', { path: NOTE_B, old_string: 'beta', new_string: 'BETA' })
    await new Promise((resolve) => setTimeout(resolve, 2))
    await edit.execute('c3', { path: NOTE_A, old_string: 'ALPHA', new_string: 'alpha' })

    expect(paths(session)).toEqual([NOTE_A, NOTE_B])
    expect(session.touched.value[0].at).not.toBe(first)
  })

  it('records nothing for a read', async () => {
    const session = newSession()
    await toolOf(session, 'read').execute('c1', { path: NOTE_A })
    expect(session.touched.value).toEqual([])
  })

  it('records nothing for a write that threw', async () => {
    const session = newSession()
    await expect(
      toolOf(session, 'edit').execute('c1', {
        path: NOTE_A,
        old_string: 'nowhere in the file',
        new_string: 'x',
      })
    ).rejects.toThrow()
    expect(session.touched.value).toEqual([])
  })

  it('records nothing for a file that has no footer to appear under', async () => {
    const session = newSession()
    session.scopeResolver.entries.value = [{ type: 'folder', path: 'Attachments' }]
    await toolOf(session, 'create').execute('c1', {
      path: 'Attachments/x.png',
      content: 'binary-ish',
    })
    expect(session.touched.value).toEqual([])
  })
})

describe('a delegated run', () => {
  it('records nothing — it is never listed anywhere', async () => {
    const session = newSession('run')
    await toolOf(session, 'edit').execute('c1', {
      path: NOTE_A,
      old_string: 'alpha',
      new_string: 'ALPHA',
    })
    expect(session.touched.value).toEqual([])
  })
})

const entryOf = (session: ChatSession) =>
  ChatStorage.getInstance()
    .getHistory()
    .find((e) => e.path === session.currentChatFile.value?.path)

describe('the chat index, which is what a footer actually reads', () => {
  it('carries the links the file holds, once the chat has been saved', async () => {
    const session = newSession()
    await toolOf(session, 'edit').execute('c1', {
      path: NOTE_A,
      old_string: 'alpha',
      new_string: 'ALPHA',
    })
    await session.save()

    expect(entryOf(session)?.notes).toEqual(session.touched.value)
  })

  it('says it has changed, since the settings object is not one Vue watches', async () => {
    const store = GlobalStore.getInstance()
    const session = newSession()

    await toolOf(session, 'edit').execute('c1', {
      path: NOTE_A,
      old_string: 'alpha',
      new_string: 'ALPHA',
    })
    await session.save()

    expect(store.chatLinksVersion.value).toBeGreaterThan(0)
  })

  it('leaves a chat with no entry alone, and says nothing changed', () => {
    const store = GlobalStore.getInstance()

    ChatStorage.getInstance().linkNotes('AI/Comments/abc.abchat', [{ path: NOTE_A, at: 'now' }])

    expect(ChatStorage.getInstance().getHistory()).toEqual([])
    expect(store.chatLinksVersion.value).toBe(0)
  })

  it('is rebuilt out of a chat file dropped into the folder by hand', async () => {
    const at = '2026-09-03T10:00:00.000Z'
    await app.vault.create(
      'AI/Chats/Dropped.abchat',
      serializeChat({
        metadata: {
          type: 'abele-chat',
          agentId: 'agent-7',
          providerId: 'p',
          modelId: 'm',
          created: '2026-09-03',
          title: 'Dropped',
          touched: [{ path: NOTE_A, at }],
          recap: 'Tidied A.',
        },
        messages: [],
        internalMessages: [],
      })
    )

    await ChatStorage.getInstance().refreshHistory()

    const entry = ChatStorage.getInstance()
      .getHistory()
      .find((e) => e.title === 'Dropped')
    expect(entry?.notes).toEqual([{ path: NOTE_A, at }])
    expect(entry?.recap).toBe('Tidied A.')
    expect(entry?.agentId).toBe('agent-7')
  })
})

describe('a comment that wrote to a note', () => {
  /** The margin is where a comment lives until somebody promotes it. */
  it('records the link in its own file but appears in no footer', async () => {
    const service = CommentService.getInstance()
    const note = app.vault.getAbstractFileByPath(NOTE_A) as TFile
    const session = await service.create(note, 5, 'alpha')

    await toolOf(session, 'edit').execute('c1', {
      path: NOTE_A,
      old_string: 'content',
      new_string: 'CONTENT',
    })
    await session.save()

    expect(paths(session)).toEqual([NOTE_A])
    expect(ChatStorage.getInstance().getHistory()).toEqual([])
  })

  it('brings its links with it when it is expanded into a chat', async () => {
    const service = CommentService.getInstance()
    const note = app.vault.getAbstractFileByPath(NOTE_A) as TFile
    const session = await service.create(note, 5, 'alpha')
    await toolOf(session, 'edit').execute('c1', {
      path: NOTE_A,
      old_string: 'content',
      new_string: 'CONTENT',
    })
    await session.save()

    expect(await service.expand(session.commentId!)).toBe(true)

    expect(entryOf(session)?.notes).toEqual(session.touched.value)
  })
})
