/**
 * The keys of the chat's tabs: which key does what, on a Mac and elsewhere, and that a key
 * the chat does not take goes on to Obsidian's own.
 *
 * The service and its sessions are real, over an in-memory vault; the scope is the mock's,
 * which walks its bindings the way Obsidian's keymap does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Platform, Scope } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import {
  CHAT_TAB_KEYS,
  keyLabel,
  onEscapeStop,
  registerChatTabKeys,
  tabAlong,
  tabAt,
  withShortcut,
} from '@/ai/chatTabKeys'
import { useVault } from '../helpers/testEnv'

const chatPath = (i: number) => `AI/Chats/chat-${i}.abchat`
const meta = (title: string) =>
  JSON.stringify({
    v: 2,
    k: 'meta',
    type: 'abele-chat',
    title,
    providerId: '',
    modelId: '',
    created: '2020-01-01',
  }) + '\n'

type Mod = 'Ctrl' | 'Meta' | 'Alt' | 'Shift'
interface MockScope extends Scope {
  handleKey(evt: KeyboardEvent, ctx: { modifiers: string; key: string }): unknown
}

let service: ChatService
let parent: MockScope
let scope: MockScope
let parentHeard: string[]
const platform = Platform as { isMacOS?: boolean }

/** A key pressed in the chat, as Obsidian's keymap hands it to the scope: what came back. */
const press = (mods: Mod[], key: string): unknown => {
  const evt = new KeyboardEvent('keydown', {
    key,
    metaKey: mods.includes('Meta'),
    ctrlKey: mods.includes('Ctrl'),
    altKey: mods.includes('Alt'),
    shiftKey: mods.includes('Shift'),
  })
  const modifiers = ['Ctrl', 'Meta', 'Alt', 'Shift']
    .filter((m) => mods.includes(m as Mod))
    .join(',')
  return scope.handleKey(evt, { modifiers, key })
}

const active = () => service.activeTabId.value
const order = () => service.tabOrder.value

beforeEach(() => {
  useVault(
    Array.from({ length: 4 }, (_, i) => ({ path: chatPath(i), content: meta(`Sample ${i}`) }))
  )
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true, agents: [] }
  ;(ChatService as unknown as { instance: ChatService | null }).instance = null
  service = ChatService.getInstance()
  platform.isMacOS = true
  parentHeard = []
  parent = new Scope() as MockScope
  parent.register(null, null, (_evt: KeyboardEvent, ctx: { modifiers: string; key: string }) => {
    parentHeard.push(`${ctx.modifiers}+${ctx.key}`)
    return false
  })
  scope = new Scope(parent) as MockScope
  registerChatTabKeys(scope, () => service)
})

afterEach(() => {
  delete platform.isMacOS
  vi.restoreAllMocks()
})

describe('where a switch lands', () => {
  const tabs = ['a', 'b', 'c']
  it('goes along and round the ends', () => {
    expect(tabAlong(tabs, 'b', 1)).toBe('c')
    expect(tabAlong(tabs, 'c', 1)).toBe('a')
    expect(tabAlong(tabs, 'a', -1)).toBe('c')
    expect(tabAlong(tabs, 'x', 1)).toBe('a')
    expect(tabAlong([], null, 1)).toBeNull()
  })

  it('takes Mod+n as the nth tab, and 9 as the last', () => {
    expect(tabAt(tabs, 1)).toBe('a')
    expect(tabAt(tabs, 3)).toBe('c')
    expect(tabAt(tabs, 4)).toBeNull()
    expect(tabAt(tabs, 9)).toBe('c')
  })
})

describe('how a key is written', () => {
  it('in a Mac menu’s glyphs', () => {
    expect(keyLabel(CHAT_TAB_KEYS.close[0], true)).toBe('⌘W')
    expect(keyLabel(CHAT_TAB_KEYS.reopen[0], true)).toBe('⇧⌘T')
    expect(keyLabel(CHAT_TAB_KEYS.next[0], true)).toBe('⌥⌘→')
  })

  it('in words elsewhere', () => {
    expect(keyLabel(CHAT_TAB_KEYS.close[0], false)).toBe('Ctrl+W')
    expect(keyLabel(CHAT_TAB_KEYS.previous[0], false)).toBe('Ctrl+Alt+Left')
    expect(keyLabel(CHAT_TAB_KEYS.previous[1], false)).toBe('Ctrl+Shift+Tab')
  })

  it('after the name of the control it belongs to', () => {
    expect(withShortcut('Close tab', 'close')).toBe('Close tab (⌘W)')
  })
})

describe('the keys in a chat, on a Mac', () => {
  beforeEach(() => {
    for (let i = 0; i < 3; i++) service.createTab()
  })

  it('switches with Cmd+Alt+arrows, Ctrl+Tab, Cmd+Shift+brackets and Ctrl+PageUp/Down', () => {
    const [a, b, c] = order()
    service.switchTab(a)
    expect(press(['Meta', 'Alt'], 'ArrowRight')).toBe(false)
    expect(active()).toBe(b)
    press(['Ctrl'], 'Tab')
    expect(active()).toBe(c)
    press(['Meta', 'Shift'], ']')
    expect(active()).toBe(a)
    press(['Meta', 'Alt'], 'ArrowLeft')
    expect(active()).toBe(c)
    press(['Ctrl', 'Shift'], 'Tab')
    expect(active()).toBe(b)
    press(['Meta', 'Shift'], '[')
    expect(active()).toBe(a)
    press(['Ctrl'], 'PageDown')
    expect(active()).toBe(b)
    press(['Ctrl'], 'PageUp')
    expect(active()).toBe(a)
    expect(parentHeard).toEqual([])
  })

  it('goes to a tab by its number, 9 being the last', () => {
    const [a, , c] = order()
    press(['Meta'], '1')
    expect(active()).toBe(a)
    press(['Meta'], '9')
    expect(active()).toBe(c)
    // Past the last tab nothing moves, and the key is still the chat's.
    press(['Meta'], '2')
    press(['Meta'], '5')
    expect(active()).toBe(order()[1])
    expect(parentHeard).toEqual([])
  })

  it('opens a new chat with Cmd+T', () => {
    press(['Meta'], 't')
    expect(order()).toHaveLength(4)
    expect(active()).toBe(order()[3])
  })

  it('leaves Alt+arrows alone, for moving by word', () => {
    const before = active()
    expect(press(['Alt'], 'ArrowLeft')).toBe(false)
    expect(active()).toBe(before)
    expect(parentHeard).toEqual(['Alt+ArrowLeft'])
  })

  it('hands Ctrl+W, Ctrl+T and Ctrl+1 on to Obsidian: on a Mac those are not the chat’s', () => {
    press(['Ctrl'], 'w')
    press(['Ctrl'], 't')
    press(['Ctrl'], '1')
    expect(order()).toHaveLength(3)
    expect(parentHeard).toEqual(['Ctrl+w', 'Ctrl+t', 'Ctrl+1'])
  })
})

describe('the keys in a chat, elsewhere', () => {
  beforeEach(() => {
    platform.isMacOS = false
    for (let i = 0; i < 2; i++) service.createTab()
  })

  it('takes Ctrl where a Mac takes Cmd', () => {
    const [a, b] = order()
    press(['Ctrl'], '1')
    expect(active()).toBe(a)
    press(['Ctrl', 'Alt'], 'ArrowRight')
    expect(active()).toBe(b)
    press(['Ctrl'], 't')
    expect(order()).toHaveLength(3)
    expect(parentHeard).toEqual([])
  })

  it('hands Cmd (the Windows key) on to the system', () => {
    press(['Meta'], 'w')
    expect(parentHeard).toEqual(['Meta+w'])
  })
})

describe('closing and reopening a tab', () => {
  const open = (i: number) => service.openChatFile(useFile(i))
  let useFile: (i: number) => import('obsidian').TFile

  beforeEach(async () => {
    const { GlobalStore } = await import('@/stores/GlobalStore')
    useFile = (i) =>
      GlobalStore.getInstance().app.vault.getAbstractFileByPath(
        chatPath(i)
      ) as import('obsidian').TFile
    for (const i of [0, 1, 2]) await open(i)
  })

  const pathOf = (id: string | null) =>
    id ? service.getSession(id)?.currentChatFile.value?.path : undefined
  const paths = () => order().map((id) => pathOf(id))

  it('closes the tab in front with Cmd+W, keeping the chat, and Cmd+Shift+T brings it back', async () => {
    expect(paths()).toEqual([chatPath(0), chatPath(1), chatPath(2)])
    service.switchTab(order()[1])

    expect(press(['Meta'], 'w')).toBe(false)
    await vi.waitFor(() => expect(paths()).toEqual([chatPath(0), chatPath(2)]))
    expect(parentHeard).toEqual([])
    const { GlobalStore } = await import('@/stores/GlobalStore')
    expect(GlobalStore.getInstance().app.vault.getAbstractFileByPath(chatPath(1))).toBeTruthy()

    press(['Meta', 'Shift'], 't')
    await vi.waitFor(() => expect(paths()).toContain(chatPath(1)))
    expect(pathOf(active())).toBe(chatPath(1))
  })

  it('reopens the most recently closed first, and each once', async () => {
    service.switchTab(order()[0])
    press(['Meta'], 'w')
    await vi.waitFor(() => expect(paths()).not.toContain(chatPath(0)))
    service.switchTab(order()[0])
    press(['Meta'], 'w')
    await vi.waitFor(() => expect(paths()).toEqual([chatPath(2)]))

    press(['Meta', 'Shift'], 't')
    await vi.waitFor(() => expect(paths()).toContain(chatPath(1)))
    press(['Meta', 'Shift'], 't')
    await vi.waitFor(() => expect(paths()).toContain(chatPath(0)))
    press(['Meta', 'Shift'], 't')
    await new Promise((r) => setTimeout(r, 20))
    expect(paths()).toHaveLength(3)
  })

  it('skips a closed chat that is open again by now', async () => {
    service.switchTab(order()[2])
    press(['Meta'], 'w')
    await vi.waitFor(() => expect(paths()).not.toContain(chatPath(2)))
    await open(2)
    press(['Meta', 'Shift'], 't')
    await new Promise((r) => setTimeout(r, 20))
    expect(paths().filter((p) => p === chatPath(2))).toHaveLength(1)
  })

  it('leaves the last tab alone once it is blank, rather than the pane', async () => {
    for (const _ of [0, 1, 2]) {
      press(['Meta'], 'w')
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(order()).toHaveLength(1)
    expect(ChatService.isBlank(service.getSession(active()!))).toBe(true)
    const blank = active()
    expect(press(['Meta'], 'w')).toBe(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(active()).toBe(blank)
    expect(parentHeard).toEqual([])
  })
})

describe('Esc in a chat', () => {
  it('stops the agent when a chat on screen says there is one to stop', () => {
    let stopping = false
    const stopped: string[] = []
    const withdraw = onEscapeStop(() => {
      if (!stopping) return false
      stopped.push('stop')
      return true
    })
    try {
      // Nothing to stop: Esc goes on where it always went.
      expect(press([], 'Escape')).toBe(false)
      expect(parentHeard).toEqual(['+Escape'])
      stopping = true
      expect(press([], 'Escape')).toBe(false)
      expect(stopped).toEqual(['stop'])
      expect(parentHeard).toEqual(['+Escape'])
      // Shift+Esc is not Esc.
      press(['Shift'], 'Escape')
      expect(stopped).toEqual(['stop'])
    } finally {
      withdraw()
    }
  })
})
