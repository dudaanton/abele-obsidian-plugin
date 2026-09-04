/**
 * What the editor's marker field costs when it asks about the comments on screen.
 *
 * `touch` is called from inside a CodeMirror state computation, once per marker, and every
 * answer it sends back rebuilds that field — so the two failure modes here are a loop and a
 * storm. A marker whose file has been deleted must be answered once and then left alone, and
 * a note with several markers must produce one repaint rather than one per marker.
 *
 * The real `CommentPlugin` is used, not a mock of it: the loop this guards against is the
 * round trip through `dispatchCommentsChanged`, and mocking that away would guard nothing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { MarkdownView, TFile } from 'obsidian'
import { CommentService } from '@/ai/CommentService'
import { ChatService } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { ChatStorage } from '@/ai/ChatStorage'
import { serializeChat } from '@/ai/ChatLog'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const NOTE_PATH = 'Notes/A.md'

let app: FakeApp
let dispatches: number

/** Lets Promise chains and their `.then` continuations run to the end. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** One markdown leaf on the note, which is all `dispatchCommentsChanged` looks for. */
function installWorkspace(): void {
  const view = new MarkdownView() as unknown as {
    file: { path: string }
    editor: { cm: { dispatch: () => void } }
  }
  view.file = { path: NOTE_PATH }
  view.editor = { cm: { dispatch: () => void dispatches++ } }
  ;(app as unknown as { workspace: unknown }).workspace = {
    iterateAllLeaves(callback: (leaf: { view: unknown }) => void) {
      callback({ view })
    },
  }
}

async function writeComment(id: string, quote: string): Promise<void> {
  await app.vault.create(
    `AI/Comments/${id}.abchat`,
    serializeChat({
      metadata: {
        type: 'abele-chat',
        kind: 'comment',
        anchor: { note: NOTE_PATH, quote },
        providerId: 'p1',
        modelId: 'm1',
        created: '2026-09-02',
      },
      messages: [],
      internalMessages: [],
    })
  )
}

beforeEach(() => {
  dispatches = 0
  app = useVault([{ path: NOTE_PATH, content: 'Before. The selected passage After.\n' }])
  installWorkspace()
  AgentRegistry.destroy()
  ChatStorage.destroy()
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    commentFolder: 'AI/Comments',
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  AgentRegistry.getInstance().setDefault(AgentRegistry.getInstance().create({ name: 'D' }).id)
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
})

describe('a marker whose comment file is gone', () => {
  it('is answered with nothing rather than a repaint', async () => {
    CommentService.getInstance().touch(NOTE_PATH, ['zzz999'])

    await settle()

    expect(dispatches).toBe(0)
  })

  /** The repaint would call `touch` again, which would load again, for ever. */
  it('is not looked for a second time', async () => {
    const service = CommentService.getInstance()
    const load = vi.spyOn(service, 'load')
    service.touch(NOTE_PATH, ['zzz999'])
    await settle()
    load.mockClear()

    service.touch(NOTE_PATH, ['zzz999'])
    await settle()

    expect(load).not.toHaveBeenCalled()
    expect(dispatches).toBe(0)
  })

  it('is looked for again once a comment has been made, since the folder has changed', async () => {
    const service = CommentService.getInstance()
    service.touch(NOTE_PATH, ['zzz999'])
    await settle()
    const note = app.vault.getAbstractFileByPath(NOTE_PATH)
    await service.create(note as never, 8, 'The selected passage')
    const load = vi.spyOn(service, 'load')

    service.touch(NOTE_PATH, ['zzz999'])
    await settle()

    expect(load).toHaveBeenCalledWith('zzz999')
  })
})

describe('several markers on one note', () => {
  /** The field calls `touch` once per marker, all inside one synchronous rebuild. */
  it('are repainted once between them, not once each', async () => {
    await writeComment('aaa111', 'The selected passage')
    await writeComment('bbb222', 'The selected passage')
    await writeComment('ccc333', 'The selected passage')
    const service = CommentService.getInstance()

    service.touch(NOTE_PATH, ['aaa111'])
    service.touch(NOTE_PATH, ['bbb222'])
    service.touch(NOTE_PATH, ['ccc333'])
    await settle()

    expect(dispatches).toBe(1)
    expect(service.sessions.size).toBe(3)
  })

  it('still repaint when only one of them could be read', async () => {
    await writeComment('aaa111', 'The selected passage')
    const service = CommentService.getInstance()

    service.touch(NOTE_PATH, ['aaa111'])
    service.touch(NOTE_PATH, ['zzz999'])
    await settle()

    expect(dispatches).toBe(1)
  })

  it('are left alone once they are loaded', async () => {
    await writeComment('aaa111', 'The selected passage')
    const service = CommentService.getInstance()
    service.touch(NOTE_PATH, ['aaa111'])
    await settle()

    service.touch(NOTE_PATH, ['aaa111'])
    await settle()

    expect(dispatches).toBe(1)
  })
})

/**
 * The icon and the conversation behind it.
 *
 * A phone reported that a marker never says an agent is working, and the answer is one
 * dispatch: `commentState` is a computed on the session, and the service watches it so that
 * every editor showing the note repaints. It has to hold for a comment being read in a tab and
 * for one that came back as a tab after a restart, which is the one that had no watcher.
 */
describe('a comment whose state changes', () => {
  const noteFile = () => app.vault.getAbstractFileByPath(NOTE_PATH) as TFile

  it('repaints the marker while the tab it is open in streams', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), 8, 'The selected passage')
    // The one host there is. The icon in the text follows the conversation wherever it is
    // being shown; the fake workspace here has no sidebar to reveal.
    vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
    await service.showInSidebar(session.commentId!)
    await settle()
    dispatches = 0

    session.isStreaming.value = true
    await nextTick()

    expect(dispatches).toBe(1)
  })

  it('repaints it again when the answer has arrived', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), 8, 'The selected passage')
    session.isStreaming.value = true
    await settle()
    dispatches = 0

    session.isStreaming.value = false
    await nextTick()

    expect(dispatches).toBe(1)
  })

  /**
   * A comment expanded into a chat before a restart comes back as one of `ChatService`'s tabs,
   * and the service adopts it the first time the editor asks about the id. Adopting it without
   * watching it left the marker frozen on whatever state it was drawn in.
   */
  it('repaints it for a comment that came back as a tab', async () => {
    await writeComment('aaa111', 'The selected passage')
    const chats = ChatService.getInstance()
    const restored = new ChatSession(chats, undefined, { kind: 'comment' })
    await restored.load(app.vault.getAbstractFileByPath('AI/Comments/aaa111.abchat') as TFile)
    chats.adoptSession(restored)

    const service = CommentService.getInstance()
    expect(service.sessionFor('aaa111')).toBe(restored)
    dispatches = 0

    restored.isStreaming.value = true
    await nextTick()

    expect(dispatches).toBe(1)
  })
})
