/**
 * The **Chats** list under a script in the code view: the same cards a note's footer shows,
 * mounted by the code view below the code.
 *
 * What matters beyond the cards themselves: the list follows the file the view holds — a tab
 * reused for another script, or a rename — and opening a chat from it goes to the sidebar and
 * leaves the script where it is.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import { mountFileChats, type FileChatsModel } from '@/views/codeViewChats'
import { ChatService } from '@/ai/ChatService'
import * as chatNoteLinks from '@/ai/chatNoteLinks'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { DEFAULT_AI_SETTINGS, type AiChatHistoryEntry } from '@/ai/types'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
} from '../helpers/fakeIntersectionObserver'
import { useVault, configureAbele } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const SCRIPT = 'Scripts/tidy.js'
const OTHER = 'Scripts/other.js'

let app: FakeApp
let host: HTMLElement
let unmount: (() => void) | null = null

function entry(over: Partial<AiChatHistoryEntry> = {}): AiChatHistoryEntry {
  return {
    path: 'AI/Chats/One.abchat',
    title: 'One',
    created: '2026-09-01',
    notes: [{ path: SCRIPT, at: '2026-09-01T10:00:00.000Z' }],
    recap: 'Made the script skip empty notes.',
    ...over,
  }
}

function seedHistory(entries: AiChatHistoryEntry[]): void {
  AbeleConfig.getInstance().ai.chatHistory = entries
  GlobalStore.getInstance().chatLinksVersion.value++
}

function mount(path = SCRIPT): FileChatsModel {
  const model = reactive<FileChatsModel>({ path })
  unmount = mountFileChats(host, model)
  return model
}

const titles = () => [...host.querySelectorAll('.abele-card__title')].map((el) => el.textContent)

beforeEach(() => {
  resetFakeIntersectionObservers()
  installFakeIntersectionObserver()
  app = useVault([
    { path: SCRIPT, content: '// @name tidy' },
    { path: OTHER, content: '// @name other' },
    { path: 'AI/Chats/One.abchat', content: '{}' },
    { path: 'AI/Chats/Two.abchat', content: '{}' },
  ])
  configureAbele()
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    scriptsFolder: 'Scripts',
  }
  GlobalStore.getInstance().chatLinksVersion.value = 0
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  unmount?.()
  unmount = null
  host.remove()
  vi.restoreAllMocks()
})

describe('the chats under a script', () => {
  it('shows the chats linked to it, as cards', async () => {
    seedHistory([entry(), entry({ path: 'AI/Chats/Two.abchat', title: 'Two', notes: [] })])

    mount()
    await nextTick()

    expect(titles()).toEqual(['One'])
    expect(host.querySelector('.abele-chats-list__header')?.textContent).toBe('Chats')
  })

  it('draws nothing for a script no chat worked on', async () => {
    seedHistory([entry()])

    mount(OTHER)
    await nextTick()

    expect(host.querySelector('.abele-chats-list')).toBeNull()
  })

  it('draws the card the moment a chat is linked', async () => {
    mount()
    await nextTick()
    expect(titles()).toEqual([])

    seedHistory([entry()])
    await nextTick()

    expect(titles()).toEqual(['One'])
  })

  it('follows the file the view holds', async () => {
    seedHistory([
      entry(),
      entry({
        path: 'AI/Chats/Two.abchat',
        title: 'Two',
        notes: [{ path: OTHER, at: '2026-09-02T10:00:00.000Z' }],
      }),
    ])

    const model = mount()
    await nextTick()
    model.path = OTHER
    await nextTick()

    expect(titles()).toEqual(['Two'])
  })

  it('opens the chat in the sidebar and leaves the script open', async () => {
    const open = vi.spyOn(ChatService.getInstance(), 'openChatFile').mockResolvedValue(undefined)
    const reveal = vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
    const getLeaf = vi.fn()
    const openLinkText = vi.fn()
    ;(app as unknown as { workspace: unknown }).workspace = { getLeaf, openLinkText }
    seedHistory([entry()])

    mount()
    await nextTick()
    ;(host.querySelector('.abele-card') as HTMLElement).click()
    await nextTick()
    await nextTick()

    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0][0].path).toBe('AI/Chats/One.abchat')
    expect(reveal).toHaveBeenCalledOnce()
    expect(getLeaf).not.toHaveBeenCalled()
    expect(openLinkText).not.toHaveBeenCalled()
  })

  it('detaches a chat from the script, saying so', async () => {
    const detach = vi.spyOn(chatNoteLinks, 'detachNote').mockResolvedValue(true)
    seedHistory([entry()])

    mount()
    await nextTick()
    const button = host.querySelector('.abele-chats-list__detach') as HTMLElement
    expect(button.getAttribute('aria-label')).toBe('Detach this chat from the script')
    button.click()
    await nextTick()

    expect(detach).toHaveBeenCalledWith('AI/Chats/One.abchat', SCRIPT)
  })
})
