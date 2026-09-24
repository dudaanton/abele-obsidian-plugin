/**
 * "Chat about this" — a new chat that starts from a link to the note.
 *
 * The owner's words: open a chat, put a link to this note first even when the agent sees the
 * whole vault, so it is clear which note is meant; and when the agent cannot see the note,
 * give it access to that note by itself.
 *
 * The chat service and its sessions are real; only the workspace — menus, the sidebar, the
 * active file — is stood in for, since there is none in a test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Menu, Notice, TFile, TFolder, type Plugin } from 'obsidian'
import {
  CHAT_ABOUT_TITLE,
  chatAboutNote,
  canChatAbout,
  registerChatAbout,
} from '@/commands/chatAboutNote'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import type { ScopeEntry } from '@/ai/ScopeResolver'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const NOTE = 'Projects/Budget.md'
const OTHER = 'Journal/2026-09-24.md'

let app: FakeApp
let service: ChatService

function fileAt(path: string): TFile {
  return app.vault.getAbstractFileByPath(path) as TFile
}

/** The default agent, with the scope the test is about. */
function seedAgent(scope: ScopeEntry[], fullVaultAccess = false) {
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Default', providerId: 'p1', modelId: 'm', scope })
  registry.update(agent.id, { fullVaultAccess })
  registry.setDefault(agent.id)
  return agent
}

beforeEach(() => {
  app = useVault([
    { path: NOTE, content: 'Numbers' },
    { path: OTHER, content: 'A day' },
    { path: 'AI/Chats/old.abchat', content: '' },
  ])
  // Obsidian's link generator, by the vault's link settings: here, shortest wikilinks.
  ;(app.fileManager as unknown as Record<string, unknown>).generateMarkdownLink = (f: TFile) =>
    `[[${f.basename}]]`

  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true, agents: [] }
  ;(ChatService as unknown as { instance: ChatService | null }).instance = null
  service = ChatService.getInstance()
  vi.spyOn(service, 'saveTabs').mockImplementation(() => {})
  vi.spyOn(service, 'revealSidebar').mockResolvedValue(undefined)
  Notice.shown.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('opening the chat', () => {
  it('prefills a link to the note, for the new tab, with the cursor after it', async () => {
    seedAgent([], true)

    expect(await chatAboutNote(fileAt(NOTE))).toBe(true)

    const session = service.activeSession.value!
    expect(service.pendingInput.value).toEqual({
      text: '[[Budget]] ',
      tabId: session.id,
      focus: true,
    })
    expect(service.revealSidebar).toHaveBeenCalled()
  })

  it('does not send anything', async () => {
    seedAgent([], true)
    await chatAboutNote(fileAt(NOTE))

    expect(service.activeSession.value!.allMessages.value).toEqual([])
  })

  it('starts on the default agent', async () => {
    const agent = seedAgent([], true)
    await chatAboutNote(fileAt(NOTE))

    expect(service.activeSession.value!.agentId.value).toBe(agent.id)
  })

  it('uses the blank tab in front rather than adding one', async () => {
    seedAgent([], true)
    service.ensureInitialized()
    const blank = service.activeTabId.value

    await chatAboutNote(fileAt(NOTE))

    expect(service.tabOrder.value).toEqual([blank])
    expect(service.activeTabId.value).toBe(blank)
  })

  it('opens a new tab when the one in front holds a conversation', async () => {
    seedAgent([], true)
    service.ensureInitialized()
    const busy = service.activeSession.value!
    busy.allMessages.value = [
      { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage,
    ]

    await chatAboutNote(fileAt(NOTE))

    expect(service.tabOrder.value).toHaveLength(2)
    expect(service.activeTabId.value).not.toBe(busy.id)
    expect(busy.allMessages.value).toHaveLength(1)
  })

  it('says so, and opens nothing, when every tab is taken', async () => {
    seedAgent([], true)
    for (let i = 0; i < 8; i++) {
      service.createTab()
      service.activeSession.value!.allMessages.value = [
        { id: `m${i}`, role: 'user', content: 'hi', timestamp: 1 } as ChatMessage,
      ]
    }

    expect(await chatAboutNote(fileAt(NOTE))).toBe(false)
    expect(Notice.shown).toContain(ChatService.TABS_FULL)
    expect(service.pendingInput.value).toBeNull()
  })
})

describe('access to the note', () => {
  it('is granted for exactly that note when the agent cannot see it', async () => {
    seedAgent([{ type: 'folder', path: 'Journal' }])

    await chatAboutNote(fileAt(NOTE))

    const scope = service.activeSession.value!.scopeResolver
    expect(scope.isInScope(NOTE)).toBe(true)
    expect(scope.entries.value).toEqual([
      { type: 'folder', path: 'Journal' },
      { type: 'file', path: NOTE },
    ])
  })

  it('is recorded as this chat’s own change, so it is saved with it', async () => {
    seedAgent([{ type: 'folder', path: 'Journal' }])

    await chatAboutNote(fileAt(NOTE))

    expect(service.activeSession.value!.overrides.value.scope).toContainEqual({
      type: 'file',
      path: NOTE,
    })
  })

  it('leaves the agent’s own scope alone', async () => {
    const agent = seedAgent([{ type: 'folder', path: 'Journal' }])

    await chatAboutNote(fileAt(NOTE))

    expect(AgentRegistry.getInstance().get(agent.id)!.scope).toEqual([
      { type: 'folder', path: 'Journal' },
    ])
  })

  it('is not touched when the whole vault is open', async () => {
    seedAgent([], true)

    await chatAboutNote(fileAt(NOTE))

    const session = service.activeSession.value!
    expect(session.scopeResolver.entries.value).toEqual([])
    expect(session.overrides.value.scope).toBeUndefined()
  })

  it('is not touched when a folder already covers the note', async () => {
    seedAgent([{ type: 'folder', path: 'Projects' }])

    await chatAboutNote(fileAt(NOTE))

    const session = service.activeSession.value!
    expect(session.scopeResolver.entries.value).toEqual([{ type: 'folder', path: 'Projects' }])
    expect(session.overrides.value.scope).toBeUndefined()
  })

  it('does not carry over what a reused blank tab was given before', async () => {
    seedAgent([{ type: 'folder', path: 'Journal' }])
    await chatAboutNote(fileAt(NOTE))
    // Nothing was sent; the same blank tab is picked up for another note.
    const other = fileAt(OTHER)

    await chatAboutNote(other)

    const scope = service.activeSession.value!.scopeResolver
    expect(scope.entries.value).toEqual([{ type: 'folder', path: 'Journal' }])
  })
})

describe('what it is offered for', () => {
  it('any vault file but a chat log, and never a folder', () => {
    expect(canChatAbout(fileAt(NOTE))).toBe(true)
    expect(canChatAbout(fileAt('AI/Chats/old.abchat'))).toBe(false)
    expect(canChatAbout(new TFolder())).toBe(false)
    expect(canChatAbout(null)).toBe(false)
  })
})

describe('where it is offered', () => {
  type Handler = (...args: unknown[]) => void
  const handlers = new Map<string, Handler>()
  const commands: Array<{ id: string; name: string; checkCallback: (c: boolean) => boolean }> = []
  let activeFile: TFile | null = null

  function fakePlugin(): Plugin {
    handlers.clear()
    commands.length = 0
    return {
      app: {
        workspace: {
          on: (name: string, fn: Handler) => {
            handlers.set(name, fn)
            return { name }
          },
          getActiveFile: () => activeFile,
        },
      },
      registerEvent: () => {},
      addCommand: (c: (typeof commands)[number]) => commands.push(c),
    } as unknown as Plugin
  }

  const titles = (menu: Menu) => menu.items.map((i) => i.title)

  beforeEach(() => {
    seedAgent([], true)
    registerChatAbout(fakePlugin())
  })

  it('in the file menu — the explorer, a tab header and "more options"', () => {
    for (const source of ['file-explorer-context-menu', 'tab-header', 'more-options']) {
      const menu = new Menu()
      handlers.get('file-menu')!(menu, fileAt(NOTE), source)
      expect(titles(menu)).toEqual([CHAT_ABOUT_TITLE])
    }
  })

  it('not on a folder or a chat log', () => {
    const folder = new Menu()
    handlers.get('file-menu')!(folder, new TFolder(), 'file-explorer-context-menu')
    const log = new Menu()
    handlers.get('file-menu')!(log, fileAt('AI/Chats/old.abchat'), 'file-explorer-context-menu')

    expect(titles(folder)).toEqual([])
    expect(titles(log)).toEqual([])
  })

  it('in the editor’s menu, with or without a selection', () => {
    const menu = new Menu()
    handlers.get('editor-menu')!(menu, {}, { file: fileAt(NOTE) })
    expect(titles(menu)).toEqual([CHAT_ABOUT_TITLE])

    const detached = new Menu()
    handlers.get('editor-menu')!(detached, {}, { file: null })
    expect(titles(detached)).toEqual([])
  })

  it('nowhere while the agent is switched off', () => {
    AbeleConfig.getInstance().ai.enabled = false
    const menu = new Menu()
    handlers.get('file-menu')!(menu, fileAt(NOTE), 'more-options')

    expect(titles(menu)).toEqual([])
    expect(commands[0].checkCallback(true)).toBe(false)
  })

  it('the item opens the chat about that note', async () => {
    const menu = new Menu()
    handlers.get('file-menu')!(menu, fileAt(NOTE), 'file-explorer-context-menu')

    menu.items[0].handler!()
    await vi.waitFor(() => expect(service.pendingInput.value?.text).toBe('[[Budget]] '))
  })

  it('as a command for the note in front, and only when there is one', async () => {
    const command = commands.find((c) => c.id === 'chat-about-current-note')!
    expect(command.name).toBe('Chat about current note')

    activeFile = null
    expect(command.checkCallback(true)).toBe(false)

    activeFile = fileAt(NOTE)
    expect(command.checkCallback(true)).toBe(true)
    expect(service.pendingInput.value).toBeNull()

    command.checkCallback(false)
    await vi.waitFor(() => expect(service.pendingInput.value?.text).toBe('[[Budget]] '))
  })
})
