/**
 * The **Chats** section under a note: which chats it shows, and what one card says.
 *
 * The list is derived from the chat index in the settings, which is a plain object Vue never
 * made reactive — so the recompute is driven by a counter, and a test that did not bump it
 * would pass for the wrong reason. Paging is asserted for the same reason as the other footer
 * lists: a note worked on by hundreds of chats must not mount a card for each.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ChatsList from '@/components/ChatsList.vue'
import { ChatLink } from '@/entities/ChatLink'
import { useChatLinks } from '@/composables/useChatLinks'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { DEFAULT_AI_SETTINGS, type AiChatHistoryEntry } from '@/ai/types'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'
import { useVault, configureAbele } from '../helpers/testEnv'

const NOTE = 'Notes/A.md'
const LARGE = 500
const DEFAULT_PAGE_SIZE = 20

let wrapper: VueWrapper | null = null

function entry(over: Partial<AiChatHistoryEntry> = {}): AiChatHistoryEntry {
  return {
    path: 'AI/Chats/One.abchat',
    title: 'One',
    created: '2026-09-01',
    notes: [{ path: NOTE, at: '2026-09-01T10:00:00.000Z' }],
    recap: 'Tidied the note and checked its links.',
    ...over,
  }
}

function seedHistory(entries: AiChatHistoryEntry[]): void {
  AbeleConfig.getInstance().ai.chatHistory = entries
  GlobalStore.getInstance().chatLinksVersion.value++
}

const links = (path = NOTE): ChatLink[] => useChatLinks(() => path).value

function render(chats: ChatLink[]): VueWrapper {
  wrapper = mount(ChatsList as never, { props: { chats } }) as VueWrapper
  return wrapper
}

beforeEach(() => {
  resetFakeIntersectionObservers()
  installFakeIntersectionObserver()
  useVault([
    { path: NOTE, content: 'body' },
    { path: 'AI/Chats/One.abchat', content: '{}' },
  ])
  configureAbele()
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
  }
  GlobalStore.getInstance().chatLinksVersion.value = 0
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

/**
 * The list is flush with the note above it. The other footer lists are indented by a quarter
 * of an icon because their rows start with one; a chat card is a box with its own border, and
 * an indented box reads as a box that missed. Asserted against the stylesheet because this
 * tier lays nothing out — see `designConformance`.
 */
describe('where the list sits', () => {
  it('is not indented away from the text it belongs to', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'src', 'components', 'ChatsList.vue'),
      'utf8'
    )
    const rule = /\.abele-chats-list__chats\s*\{([^}]*)\}/.exec(source)?.[1] ?? ''

    expect(rule).not.toBe('')
    expect(rule).not.toMatch(/padding-left|padding-inline-start|margin-left/)
  })
})

describe('which chats a note lists', () => {
  it('takes the ones that wrote to it, and no others', () => {
    seedHistory([
      entry({ path: 'a.abchat', title: 'Wrote here' }),
      entry({
        path: 'b.abchat',
        title: 'Wrote elsewhere',
        notes: [{ path: 'Notes/B.md', at: 'x' }],
      }),
    ])

    expect(links().map((c) => c.title)).toEqual(['Wrote here'])
  })

  it('leaves out a chat that wrote to nothing', () => {
    seedHistory([entry({ title: 'Only talked', notes: undefined })])

    expect(links()).toEqual([])
  })

  it('puts the most recently written first', () => {
    seedHistory([
      entry({
        path: 'old.abchat',
        title: 'Old',
        notes: [{ path: NOTE, at: '2026-01-01T00:00:00Z' }],
      }),
      entry({
        path: 'new.abchat',
        title: 'New',
        notes: [{ path: NOTE, at: '2026-09-01T00:00:00Z' }],
      }),
    ])

    expect(links().map((c) => c.title)).toEqual(['New', 'Old'])
  })

  /** The index is a plain object; without the counter nothing here would ever recompute. */
  it('follows the index once it says it has changed', () => {
    const list = useChatLinks(() => NOTE)
    expect(list.value).toEqual([])

    seedHistory([entry({ title: 'Arrived later' })])

    expect(list.value.map((c) => c.title)).toEqual(['Arrived later'])
  })

  it('dates the card by when this note was written, not the chat as a whole', () => {
    seedHistory([
      entry({
        notes: [
          { path: 'Notes/B.md', at: '2026-09-02T00:00:00Z' },
          { path: NOTE, at: '2026-03-04T00:00:00Z' },
        ],
      }),
    ])

    expect(links()[0].touchedAt?.format('YYYY-MM-DD')).toBe('2026-03-04')
  })
})

describe('a card in the list', () => {
  it('shows the title, the recap and the date this note was written', () => {
    seedHistory([entry()])

    const view = render(links())

    expect(view.find('.abele-card__name').text()).toBe('One')
    expect(view.find('.abele-card__description').text()).toBe(
      'Tidied the note and checked its links.'
    )
    expect(view.find('.abele-card__meta').text()).toContain('01.09.2026')
  })

  it('names the agent the chat ran on', () => {
    const agent = AgentRegistry.getInstance().create({ name: 'Editor' })
    seedHistory([entry({ agentId: agent.id })])

    const view = render(links())

    expect(view.find('.abele-badge').text()).toBe('Editor')
  })

  it('opens that chat in the sidebar when it is pressed', async () => {
    const open = vi.spyOn(ChatService.getInstance(), 'openChatFile').mockResolvedValue(undefined)
    const reveal = vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
    seedHistory([entry()])

    const view = render(links())
    await view.find('.abele-card').trigger('click')
    await nextTick()

    expect(open).toHaveBeenCalledOnce()
    expect(reveal).toHaveBeenCalledOnce()
  })
})

describe('a note hundreds of chats have written to', () => {
  const many = (): ChatLink[] => {
    seedHistory(
      Array.from({ length: LARGE }, (_, i) =>
        entry({
          path: `AI/Chats/${i}.abchat`,
          title: `Chat ${i}`,
          notes: [{ path: NOTE, at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z` }],
        })
      )
    )
    return links()
  }

  it('mounts one page of cards, not one per chat', () => {
    const view = render(many())

    expect(view.findAll('.abele-card')).toHaveLength(DEFAULT_PAGE_SIZE)
  })

  it('reveals another page when the sentinel scrolls into view', async () => {
    const view = render(many())
    await view.vm.$nextTick()

    const sentinel = view.find('.abele-chats-list__sentinel')
    expect(sentinel.exists()).toBe(true)
    expect(scrollIntoView(sentinel.element)).toBe(1)

    await view.vm.$nextTick()
    expect(view.findAll('.abele-card')).toHaveLength(DEFAULT_PAGE_SIZE * 2)
  })
})
