/**
 * Attaching a chat to a note by hand, from both ends: the note's file menu and command, which
 * pick a chat, and the menu behind the link button in a chat's header, which picks a note.
 *
 * The chat files, the index and the sessions are real; only the workspace — menus, the note
 * in front, the pickers' dialogs — is stood in for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FuzzySuggestModal, Menu, Notice, TFile, TFolder, type Plugin } from 'obsidian'
import {
  ATTACH_CHAT_TITLE,
  attachChatToNote,
  chatNotesMenu,
  registerAttachChat,
} from '@/commands/attachChat'
import { pickNote } from '@/helpers/suggesters/NotePicker'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { serializeChat } from '@/ai/ChatLog'
import { DEFAULT_AI_SETTINGS, type AiChatHistoryEntry, type TouchedNote } from '@/ai/types'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))

const NOTE_A = 'Notes/A.md'
const NOTE_B = 'Notes/B.md'
const NOTE_C = 'Notes/C.md'
const AT = '2026-09-03T10:00:00.000Z'

let app: FakeApp
let activeFile: TFile | null = null
let lastOpen: string[] = []
let openSpy: ReturnType<typeof vi.spyOn>

const fileAt = (path: string) => app.vault.getAbstractFileByPath(path) as TFile
const opened = <T>() =>
  openSpy.mock.contexts[openSpy.mock.contexts.length - 1] as FuzzySuggestModal<T>
const linkedTo = (chatPath: string) =>
  (
    ChatStorage.getInstance()
      .getHistory()
      .find((e) => e.path === chatPath)?.notes ?? []
  ).map((n) => n.path)
const titles = (menu: Menu) => menu.items.map((i) => i.title)

async function seedChat(name: string, notes: TouchedNote[] = []): Promise<TFile> {
  const path = `AI/Chats/${name}.abchat`
  await app.vault.create(
    path,
    serializeChat({
      metadata: {
        type: 'abele-chat',
        created: '2026-09-03',
        title: name,
        touched: notes.length ? notes : undefined,
      },
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
      internalMessages: [],
    })
  )
  ChatStorage.getInstance().addHistoryEntry({
    path,
    title: name,
    created: '2026-09-03',
    notes: notes.length ? notes : undefined,
  })
  return fileAt(path)
}

async function openSession(file: TFile): Promise<ChatSession> {
  const session = new ChatSession(ChatService.getInstance())
  await session.load(file)
  ChatService.getInstance().adoptSession(session)
  return session
}

beforeEach(() => {
  app = useVault([
    { path: NOTE_A, content: 'alpha' },
    { path: NOTE_B, content: 'beta' },
    { path: NOTE_C, content: 'gamma' },
    { path: 'Pictures/x.png', content: 'png' },
  ])
  activeFile = null
  lastOpen = []
  ;(app as unknown as { workspace: unknown }).workspace = {
    getActiveFile: () => activeFile,
    getLastOpenFiles: () => lastOpen,
  }
  AgentRegistry.destroy()
  ChatStorage.destroy()
  ChatService.getInstance().destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    chatFolder: 'AI/Chats/{{name}}',
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  AgentRegistry.getInstance().setDefault(AgentRegistry.getInstance().create({ name: 'D' }).id)
  GlobalStore.getInstance().chatLinksVersion.value = 0
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  openSpy = vi.spyOn(FuzzySuggestModal.prototype, 'open').mockImplementation(() => {})
  Notice.shown.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('from a note: picking a chat', () => {
  it('offers the chats not yet attached to it, and attaches the one chosen', async () => {
    await seedChat('Already', [{ path: NOTE_A, at: AT }])
    const trip = await seedChat('Trip')

    const done = attachChatToNote(fileAt(NOTE_A))
    const modal = opened<AiChatHistoryEntry>()
    const items = modal.getItems()
    expect(items.map((e) => modal.getItemText(e))).toEqual(['Trip'])
    modal.onChooseItem(items[0], new MouseEvent('click'))

    expect(await done).toBe(true)
    expect(linkedTo(trip.path)).toEqual([NOTE_A])
    expect(Notice.shown.at(-1)).toContain('Trip')
  })

  it('does nothing when the picker is closed without a choice', async () => {
    const trip = await seedChat('Trip')

    const done = attachChatToNote(fileAt(NOTE_A))
    opened().onClose()

    expect(await done).toBe(false)
    expect(linkedTo(trip.path)).toEqual([])
  })
})

describe('from a note: where it is offered', () => {
  type Handler = (...args: unknown[]) => void
  const handlers = new Map<string, Handler>()
  const commands: Array<{ id: string; name: string; checkCallback: (c: boolean) => boolean }> = []

  beforeEach(() => {
    handlers.clear()
    commands.length = 0
    registerAttachChat({
      app: {
        workspace: {
          on: (name: string, fn: Handler) => handlers.set(name, fn),
          getActiveFile: () => activeFile,
        },
      },
      registerEvent: () => {},
      addCommand: (c: (typeof commands)[number]) => commands.push(c),
    } as unknown as Plugin)
  })

  it('in the file menu of a note — the explorer, a tab header, "more options"', () => {
    const menu = new Menu()
    handlers.get('file-menu')!(menu, fileAt(NOTE_A), 'more-options')

    expect(titles(menu)).toEqual([ATTACH_CHAT_TITLE])
  })

  it('not for a folder, a picture, or while the agent is off', () => {
    const folder = new Menu()
    handlers.get('file-menu')!(folder, new TFolder(), 'file-explorer-context-menu')
    const picture = new Menu()
    handlers.get('file-menu')!(picture, fileAt('Pictures/x.png'), 'file-explorer-context-menu')
    AbeleConfig.getInstance().ai.enabled = false
    const off = new Menu()
    handlers.get('file-menu')!(off, fileAt(NOTE_A), 'more-options')

    expect([titles(folder), titles(picture), titles(off)]).toEqual([[], [], []])
  })

  it('as a command for the note in front', () => {
    const command = commands.find((c) => c.id === 'attach-chat-to-current-note')!
    expect(command.checkCallback(true)).toBe(false)

    activeFile = fileAt(NOTE_A)
    expect(command.checkCallback(true)).toBe(true)
    command.checkCallback(false)
    expect(openSpy).toHaveBeenCalled()
  })
})

describe('from a chat: the menu behind the link button', () => {
  it('offers the note in front first, then any note', async () => {
    const session = await openSession(await seedChat('Trip'))
    activeFile = fileAt(NOTE_A)

    expect(titles(chatNotesMenu(session))).toEqual(['Attach to A', 'Attach to a note…'])
  })

  it('attaches to the note in front', async () => {
    const file = await seedChat('Trip')
    const session = await openSession(file)
    activeFile = fileAt(NOTE_A)

    chatNotesMenu(session).items[0].handler!()

    await vi.waitFor(() => expect(linkedTo(file.path)).toEqual([NOTE_A]))
    expect(session.touched.value.map((n) => n.path)).toEqual([NOTE_A])
  })

  it('lists the notes it is attached to, to detach one', async () => {
    const file = await seedChat('Trip', [
      { path: NOTE_A, at: AT },
      { path: NOTE_B, at: AT },
    ])
    const session = await openSession(file)
    activeFile = fileAt(NOTE_A)

    const menu = chatNotesMenu(session)
    // The note in front is already attached: offering it again would be a no-op.
    expect(titles(menu)).toEqual(['Attach to a note…', 'Detach from A', 'Detach from B'])

    menu.items[2].handler!()
    await vi.waitFor(() => expect(linkedTo(file.path)).toEqual([NOTE_A]))
  })

  it('picks another note, without the ones already attached', async () => {
    const file = await seedChat('Trip', [{ path: NOTE_B, at: AT }])
    const session = await openSession(file)
    activeFile = fileAt(NOTE_A)

    chatNotesMenu(session).items[1].handler!()
    const modal = opened<TFile>()
    const items = modal.getItems()
    expect(items.map((f) => f.path)).toEqual([NOTE_A, NOTE_C])
    modal.onChooseItem(items[1], new MouseEvent('click'))

    await vi.waitFor(() => expect(linkedTo(file.path)).toEqual([NOTE_B, NOTE_C]))
  })

  it('is empty for a chat that has not been saved yet', () => {
    const session = new ChatSession(ChatService.getInstance())

    expect(titles(chatNotesMenu(session))).toEqual([])
  })
})

describe('the note picker', () => {
  it('lists the note in front, then the ones opened lately, then the rest — notes only', () => {
    lastOpen = [NOTE_C, 'Pictures/x.png', 'Gone.md']

    void pickNote(app as never, { first: NOTE_B })
    const modal = opened<TFile>()

    expect(modal.getItems().map((f) => modal.getItemText(f))).toEqual([
      'Notes/B',
      'Notes/C',
      'Notes/A',
    ])
  })
})
