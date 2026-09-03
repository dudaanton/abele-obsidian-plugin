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
import { DEFAULT_AI_SETTINGS, type ChatMessage, type TouchedNote } from '@/ai/types'
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

describe('a note that was renamed', () => {
  const AT = '2026-09-03T10:00:00.000Z'

  /** A chat file in the folder, in the index, carrying a link to `NOTE_A`. */
  async function seedChat(name: string, notes: TouchedNote[]): Promise<TFile> {
    const path = `AI/Chats/${name}.abchat`
    await app.vault.create(
      path,
      serializeChat({
        metadata: {
          type: 'abele-chat',
          providerId: 'p',
          modelId: 'm',
          created: '2026-09-03',
          title: name,
          touched: notes,
        },
        messages: [],
        internalMessages: [],
      })
    )
    ChatStorage.getInstance().addHistoryEntry({
      path,
      title: name,
      created: '2026-09-03',
      notes,
    })
    return app.vault.getAbstractFileByPath(path) as TFile
  }

  it('is renamed in the index too, and only where it is named', async () => {
    await seedChat('Touched A', [{ path: NOTE_A, at: AT }])
    await seedChat('Touched B', [{ path: NOTE_B, at: AT }])
    const before = GlobalStore.getInstance().chatLinksVersion.value

    await ChatStorage.getInstance().handleNoteRename(NOTE_A, 'Notes/Renamed.md')

    const history = ChatStorage.getInstance().getHistory()
    expect(history.find((e) => e.title === 'Touched A')?.notes).toEqual([
      { path: 'Notes/Renamed.md', at: AT },
    ])
    expect(history.find((e) => e.title === 'Touched B')?.notes).toEqual([{ path: NOTE_B, at: AT }])
    expect(GlobalStore.getInstance().chatLinksVersion.value).toBeGreaterThan(before)
  })

  it('is renamed in the chat file, which is the source of truth', async () => {
    const file = await seedChat('Touched A', [{ path: NOTE_A, at: AT }])

    await ChatStorage.getInstance().handleNoteRename(NOTE_A, 'Notes/Renamed.md')

    const meta = parseChatMetadata(await app.vault.read(file))
    expect(meta?.touched).toEqual([{ path: 'Notes/Renamed.md', at: AT }])
  })

  it('reaches a session already holding that file open, without reloading it', async () => {
    const file = await seedChat('Touched A', [{ path: NOTE_A, at: AT }])
    const session = newSession()
    await session.load(file)
    ChatService.getInstance().adoptSession(session)

    await ChatStorage.getInstance().handleNoteRename(NOTE_A, 'Notes/Renamed.md')

    expect(paths(session)).toEqual(['Notes/Renamed.md'])
  })

  it('never opens a chat that did not write the note', async () => {
    await seedChat('Touched B', [{ path: NOTE_B, at: AT }])
    app.resetStats()

    await ChatStorage.getInstance().handleNoteRename(NOTE_A, 'Notes/Renamed.md')

    expect(app.stats.read).toBe(0)
  })

  it('reaches a comment anchored elsewhere that happened to write it', async () => {
    const service = CommentService.getInstance()
    const noteB = app.vault.getAbstractFileByPath(NOTE_B) as TFile
    const session = await service.create(noteB, 4, 'beta')
    const id = session.commentId!
    session.noteTouched(NOTE_A)
    await session.save()
    // Forgotten, so the rename walk has to read the file rather than the live session.
    service.destroy()

    await service.handleRename(NOTE_A, 'Notes/Renamed.md')

    const file = app.vault.getAbstractFileByPath(`AI/Comments/${id}.abchat`) as TFile
    const meta = parseChatMetadata(await app.vault.read(file))
    expect(meta?.touched?.map((t) => t.path)).toEqual(['Notes/Renamed.md'])
    expect(meta?.anchor?.note).toBe(NOTE_B)
  })
})

describe('a note moved or copied', () => {
  it('is recorded where the file ended up, not where it started', async () => {
    const session = newSession()

    await toolOf(session, 'mv').execute('c1', { from: NOTE_A, to: 'Notes/Moved.md' })
    await toolOf(session, 'cp').execute('c2', { from: NOTE_B, to: 'Notes/Copy.md' })

    expect(paths(session)).toEqual(['Notes/Moved.md', 'Notes/Copy.md'])
  })

  /** A `replace` whose actions all came to nothing wrote nothing, so it links nothing. */
  it('links nothing when a replace changed nothing', async () => {
    const session = newSession()
    // `replace` reads the frontmatter and looks for an open editor; the fake vault has
    // neither, and nothing here is about either.
    ;(app as unknown as { fileManager: Record<string, unknown> }).fileManager.processFrontMatter =
      async (_f: unknown, fn: (fm: Record<string, unknown>) => void) => fn({})
    ;(app as unknown as { workspace: unknown }).workspace = { getLeavesOfType: () => [] }

    const result = await toolOf(session, 'replace').execute('c1', {
      path: NOTE_A,
      actions: [{ type: 'remove-property', property: 'never-set' }],
    })

    expect(result.content[0].text).toBe('no changes')
    expect(session.touched.value).toEqual([])
  })
})

describe('the index saying it has changed', () => {
  it('says so when a chat leaves the history, so its card goes with it', () => {
    const store = GlobalStore.getInstance()
    ChatStorage.getInstance().addHistoryEntry({
      path: 'AI/Chats/Gone.abchat',
      title: 'Gone',
      created: '2026-09-03',
      notes: [{ path: NOTE_A, at: 'now' }],
    })
    const before = store.chatLinksVersion.value

    ChatStorage.getInstance().removeHistoryEntry('AI/Chats/Gone.abchat')

    expect(store.chatLinksVersion.value).toBeGreaterThan(before)
  })

  it('says so when a chat arrives in it, so its card can appear', () => {
    const store = GlobalStore.getInstance()
    const before = store.chatLinksVersion.value

    ChatStorage.getInstance().addHistoryEntry({
      path: 'AI/Chats/Arrived.abchat',
      title: 'Arrived',
      created: '2026-09-03',
    })

    expect(store.chatLinksVersion.value).toBeGreaterThan(before)
  })
})

describe('a rename reaching an expanded comment nobody has open', () => {
  /**
   * Both walks used to run at once over the same file, each reading before the other appended.
   * Whichever landed last reverted the other's field — the anchor or the links, at random.
   */
  it('keeps both the anchor and the links, whichever walk finishes first', async () => {
    const service = CommentService.getInstance()
    const note = app.vault.getAbstractFileByPath(NOTE_A) as TFile
    const session = await service.create(note, 5, 'alpha')
    const id = session.commentId!
    session.noteTouched(NOTE_A)
    await session.save()
    expect(await service.expand(id)).toBe(true)

    // Neither walk finds a live session, so both would go to the file.
    service.destroy()
    ChatService.getInstance().destroy()

    await Promise.all([
      service.handleRename(NOTE_A, 'Notes/Renamed.md'),
      ChatStorage.getInstance().handleNoteRename(NOTE_A, 'Notes/Renamed.md'),
    ])

    const file = app.vault.getAbstractFileByPath(`AI/Comments/${id}.abchat`) as TFile
    const meta = parseChatMetadata(await app.vault.read(file))
    expect(meta?.anchor?.note).toBe('Notes/Renamed.md')
    expect(meta?.touched?.map((t) => t.path)).toEqual(['Notes/Renamed.md'])
  })
})

describe('who pays for a recap', () => {
  const wants = (session: ChatSession): boolean =>
    (session as unknown as { wantsRecap(): boolean }).wantsRecap()

  it('is asked for only after a turn that wrote', async () => {
    const session = newSession()
    expect(wants(session)).toBe(false)

    await toolOf(session, 'edit').execute('c1', {
      path: NOTE_A,
      old_string: 'alpha',
      new_string: 'ALPHA',
    })

    expect(wants(session)).toBe(true)
  })

  /** A comment is on the margin, where no card shows a recap. It pays for one when promoted. */
  it('is never asked for by a comment, however much it writes', async () => {
    const service = CommentService.getInstance()
    const note = app.vault.getAbstractFileByPath(NOTE_A) as TFile
    const session = await service.create(note, 5, 'alpha')

    await toolOf(session, 'edit').execute('c1', {
      path: NOTE_A,
      old_string: 'content',
      new_string: 'CONTENT',
    })

    expect(paths(session)).toEqual([NOTE_A])
    expect(wants(session)).toBe(false)
  })
})
