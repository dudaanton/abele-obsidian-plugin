import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import ChatNavigation from '@/components/ChatNavigation.vue'
import AiChat from '@/components/AiChat.vue'
import { CommentService } from '@/ai/CommentService'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { TFile } from 'obsidian'
import { serializeChat } from '@/ai/ChatLog'
import { chatCopyPath } from '@/ai/chatCopy'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'
import { useFakeClock } from '../helpers/fakeClock'

const messages: ChatMessage[] = [
  { id: 'q1', role: 'user', content: 'Plan a sample garden', timestamp: 1000 },
  { id: 'a1', role: 'assistant', content: 'Put a pond near the shed.', timestamp: 2000 },
  {
    id: 't1',
    role: 'tool-call',
    content: '',
    toolName: 'read',
    toolResult: 'A pond liner',
    toolStatus: 'pending',
    timestamp: 3000,
  },
  { id: 'q2', role: 'user', content: 'Add some shade', timestamp: 86401000 },
]
let wrapper: VueWrapper | undefined
const root = () => document.querySelector<HTMLElement>('.abele-chat-navigation')!
const click = async (text: string) => {
  const button = [...root().querySelectorAll<HTMLElement>('button, summary')].find((el) =>
    el.textContent?.includes(text)
  )!
  button.click()
  await flushPromises()
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

const open = async (extra = {}) => {
  wrapper = mount(ChatNavigation, {
    props: { messages, comments: [], state: { expanded: [], scrollTop: 0 }, ...extra },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

describe('the navigation modal', () => {
  it('reads an unopened legacy discussion without migrating or writing its file or safety copies', async () => {
    const comments = CommentService.getInstance()
    const path = comments.commentPath('sample-legacy')
    const source = JSON.stringify({
      metadata: {
        type: 'abele-chat',
        kind: 'comment',
        created: '2030-01-01',
        allowWebSearch: true,
      },
      messages: [
        { id: 'legacy-q', role: 'user', content: 'A sample legacy question', timestamp: 1 },
        { id: 'legacy-a', role: 'assistant', content: 'A sample legacy answer', timestamp: 2 },
      ],
      internalMessages: [],
    })
    const app = useVault([{ path, raw: source }])
    vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
    vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
    const write = vi.spyOn(app.vault.adapter, 'write')
    const remove = vi.spyOn(app.vault.adapter, 'remove')
    try {
      await open({ comments: [{ id: 'sample-legacy', message: 'a1' }] })
      expect(root().textContent).toContain('A sample legacy question')
      wrapper!.unmount()
      wrapper = undefined
      expect(app.stats.written).toBe(0)
      expect(write).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(await app.vault.read(app.vault.getAbstractFileByPath(path) as TFile)).toBe(source)
      expect(comments.sessionFor('sample-legacy')).toBeNull()
      // Choosing the discussion later still uses the ordinary migration path.
      await comments.load('sample-legacy')
      expect(app.stats.written).toBeGreaterThan(0)
    } finally {
      comments.destroy()
    }
  })

  it('inspects a recoverable discussion without repairing its torn file or deleting its safety copy', async () => {
    const comments = CommentService.getInstance()
    const path = comments.commentPath('sample-recovery')
    const metadata = {
      type: 'abele-chat' as const,
      kind: 'comment' as const,
      created: '2030-01-01',
      providerId: '',
      modelId: '',
    }
    const source = JSON.stringify({ v: 2, k: 'meta', ...metadata }) + '\n{"k":"msg"'
    const copy = `${path}\n${serializeChat({ metadata, messages: [{ id: 'recovered-q', role: 'user', content: 'A sample recovered question', timestamp: 1 }], internalMessages: [] })}`
    const app = useVault([{ path, raw: source }])
    const backup = chatCopyPath(app as never, path)
    await app.vault.adapter.mkdir(backup.slice(0, backup.lastIndexOf('/')))
    await app.vault.adapter.write(backup, copy)
    // Count only writes caused by opening the contents, not fixture creation.
    app.stats.written = 0
    const write = vi.spyOn(app.vault.adapter, 'write')
    const remove = vi.spyOn(app.vault.adapter, 'remove')
    await open({ comments: [{ id: 'sample-recovery', message: 'a1' }] })
    expect(root().textContent).toContain('A sample recovered question')
    expect(app.stats.written).toBe(0)
    expect(write).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(await app.vault.read(app.vault.getAbstractFileByPath(path) as TFile)).toBe(source)
    expect(await app.vault.adapter.read(backup)).toBe(copy)
    expect(comments.sessionFor('sample-recovery')).toBeNull()
  })

  it('shows dated questions, leaves the search unfocused, and expands only navigation rows', async () => {
    await open({ activeMessageId: 'a1' })
    expect([...root().querySelectorAll('[data-question]')].map((el) => el.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Plan a sample garden'),
        expect.stringContaining('Add some shade'),
      ])
    )
    expect(root().querySelectorAll('.abele-date-divider')).toHaveLength(2)
    expect(document.activeElement).not.toBe(root().querySelector('input'))
    expect(root().querySelector('[data-current="true"]')).not.toBeNull()
    expect(root().textContent).not.toContain('Put a pond near')
    await click('Answers · 1')
    expect(root().textContent).toContain('Put a pond near')
    expect(wrapper!.emitted('jump')).toBeUndefined()
    await click('Put a pond near')
    expect(wrapper!.emitted('jump')![0]).toEqual(['a1'])
  })

  it('offers start, latest, back, and search results in folded tool details without switching branches', async () => {
    await open({ canGoBack: true })
    await click('To start')
    await click('To latest')
    await click('Back to place')
    expect(wrapper!.emitted('start')).toHaveLength(1)
    expect(wrapper!.emitted('latest')).toHaveLength(1)
    expect(wrapper!.emitted('back')).toHaveLength(1)
    const input = root().querySelector('input')!
    input.value = 'liner'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(root().textContent).toContain('A pond liner')
    await click('A pond liner')
    expect(wrapper!.emitted('jump')![0]).toEqual(['t1', 'result', 'liner'])
    // Scope selection alone never switches a conversation; search still starts on its current path.
    expect(root().querySelector<HTMLSelectElement>('select')!.value).toBe('current')
    expect(
      [...root().querySelectorAll('option')].map((option) => (option as HTMLOptionElement).value)
    ).toEqual(['current', 'all'])
  })

  it('uses arrows to move focus and Enter to jump, and closes with Escape', async () => {
    await open()
    const input = root().querySelector('input')!
    input.focus()
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    )
    expect(document.activeElement?.getAttribute('data-question')).toBe('q1')
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    )
    expect(wrapper!.emitted('jump')![0]).toEqual(['q1'])
    root().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
    expect(wrapper!.emitted('close')).toHaveLength(1)
  })

  it('keeps expansions and list position on reopen', async () => {
    const state = { expanded: [] as string[], scrollTop: 0 }
    await open({ state })
    await click('Answers · 1')
    const list = root().querySelector<HTMLElement>('.abele-chat-navigation__list')!
    list.scrollTop = 120
    list.dispatchEvent(new Event('scroll'))
    await flushPromises()
    wrapper!.unmount()
    await open({ state })
    expect(root().textContent).toContain('Put a pond near')
    expect(root().querySelector('.abele-chat-navigation__list')!.scrollTop).toBe(120)
  })

  it('shows direct discussion questions and jumps through the existing comment path, reading children only on expansion', async () => {
    const comments = CommentService.getInstance()
    const child = fakeChatSession({
      messages: ref([{ id: 'dq', role: 'user', content: 'Which pond liner?', timestamp: 1 }]),
      overrides: { messageComments: ref([{ id: 'nested', message: 'dq', quote: 'liner' }]) },
    })
    const load = vi.spyOn(comments, 'navigationPreview').mockResolvedValue(child as never)
    await open({ comments: [{ id: 'direct', message: 'a1', quote: 'pond' }] })
    expect(root().textContent).toContain('Discussions · 1')
    expect(root().textContent).toContain('Which pond liner?')
    expect(load.mock.calls).toEqual([['direct']])
    await click('Which pond liner?')
    expect(wrapper!.emitted('discussion')![0]).toEqual(['direct'])
    await click('Nested discussions · 1')
    expect(load.mock.calls).toEqual([['direct'], ['nested']])
  })

  it('shows and reads only nested discussions attached to the loaded sub-chat current path', async () => {
    const child = fakeChatSession({
      messages: ref([
        { id: 'discussion-q', role: 'user', content: 'A sample branching question', timestamp: 1 },
        {
          id: 'answer-b',
          parentId: 'discussion-q',
          role: 'assistant',
          content: 'Selected answer',
          timestamp: 3,
        },
        {
          id: 'unsent',
          parentId: 'answer-b',
          role: 'user',
          content: 'Draft question',
          draft: true,
          timestamp: 4,
        },
      ]),
      overrides: {
        messageComments: ref([
          { id: 'hidden-child', message: 'answer-a' },
          { id: 'visible-child', message: 'answer-b' },
          { id: 'draft-child', message: 'unsent' },
          { id: 'removed-child', message: 'removed-answer' },
        ]),
      },
    })
    const visible = fakeChatSession({
      messages: ref([
        { id: 'nested-q', role: 'user', content: 'Visible nested sample question', timestamp: 5 },
      ]),
    })
    const preview = vi
      .spyOn(CommentService.getInstance(), 'navigationPreview')
      .mockImplementation(async (id) => (id === 'direct' ? child : visible) as never)
    await open({ comments: [{ id: 'direct', message: 'a1' }] })
    expect(root().textContent).toContain('Nested discussions · 1')
    expect(preview.mock.calls).toEqual([['direct']])
    await click('Nested discussions · 1')
    expect(preview.mock.calls).toEqual([['direct'], ['visible-child']])
    expect(root().textContent).toContain('Visible nested sample question')
    expect(root().textContent).not.toContain('Draft question')
  })

  it('keeps a long quoted passage compact without changing its stored anchor', async () => {
    vi.spyOn(CommentService.getInstance(), 'navigationPreview').mockResolvedValue(null)
    const quote = 'A sample passage with many words. '.repeat(100)
    const comment = { id: 'long-quote', message: 'a1', quote }
    await open({ comments: [comment] })
    expect(
      root().querySelector('.abele-chat-navigation__discussion button')!.textContent!.length
    ).toBeLessThan(200)
    expect(comment.quote).toBe(quote)
  })

  it('labels missing discussions instead of losing their anchors', async () => {
    vi.spyOn(CommentService.getInstance(), 'navigationPreview').mockResolvedValue(null)
    await open({ comments: [{ id: 'missing', message: 'a1', quote: 'sample passage' }] })
    expect(root().textContent).toContain('sample passage')
    expect(root().textContent).toContain('Discussion unavailable')
  })
})

describe('navigation in the chat header', () => {
  const pause = useFakeClock()
  it('cancels a nested discussion jump when another chat is selected while the previous comment saves', async () => {
    const chats = ChatService.getInstance()
    const comments = CommentService.getInstance()
    vi.spyOn(chats, 'ensureInitialized').mockImplementation(() => {})
    vi.spyOn(chats, 'saveTabs').mockImplementation(() => {})
    vi.spyOn(chats, 'revealSidebar').mockResolvedValue(undefined)
    vi.spyOn(chats, 'sidebarShowing').mockReturnValue(false)
    vi.spyOn(comments, 'trail').mockResolvedValue([])
    vi.spyOn(comments, 'touch').mockImplementation(() => {})
    let finishSaving!: () => void
    const saving = new Promise<void>((resolve) => {
      finishSaving = resolve
    })
    const save = vi.fn(() => saving)
    const lifecycle = {
      anchor: ref(null),
      flush: async () => {},
      destroy: () => {},
      reconcileForSelectionReturn: async () => {},
    }
    const owner = fakeChatSession({
      messages: ref([...messages]),
      kind: 'comment',
      overrides: {
        ...lifecycle,
        id: 'source-session',
        commentId: 'source-comment',
        save,
        messageComments: ref([{ id: 'nested-comment', message: 'a1' }]),
      },
    })
    const target = fakeChatSession({
      messages: ref([
        { id: 'nested-q', role: 'user', content: 'A nested sample question', timestamp: 1 },
      ]),
      overrides: { ...lifecycle, id: 'nested-session', commentId: 'nested-comment' },
    })
    const other = fakeChatSession({
      kind: 'chat',
      overrides: { ...lifecycle, id: 'other-session' },
    })
    comments.sessions.set('source-comment', owner as never)
    vi.spyOn(comments, 'load').mockImplementation(
      async (id) => (id === 'source-comment' ? owner : target) as never
    )
    vi.spyOn(comments, 'navigationPreview').mockResolvedValue(target as never)
    const show = vi.spyOn(comments, 'showInSidebar')
    try {
      chats.adoptSession(other as never)
      await comments.showInSidebar('source-comment')
      wrapper = mount(AiChat, { attachTo: document.body })
      await flushPromises()
      await wrapper.find('.abele-ai-chat__navigation').trigger('click')
      await flushPromises()
      await click('A nested sample question')
      expect(save).toHaveBeenCalledOnce()
      chats.switchTab(other.id)
      expect(chats.activeTabId.value).toBe(other.id)
      finishSaving()
      await flushPromises()
      expect(chats.activeTabId.value).toBe(other.id)
      expect(show.mock.lastCall?.[1]).toEqual(expect.any(Function))
    } finally {
      finishSaving()
      await flushPromises()
      wrapper?.unmount()
      wrapper = undefined
      comments.destroy()
      chats.destroy()
    }
  })

  it('drops old-version return places and saves a new place after reloading the same session', async () => {
    const rows = ref<ChatMessage[]>([...messages])
    const session = fakeChatSession({ messages: rows, kind: 'chat' })
    const chats = ChatService.getInstance()
    vi.spyOn(chats, 'ensureInitialized').mockImplementation(() => {})
    vi.spyOn(chats, 'activeSession', 'get').mockReturnValue({ value: session } as never)
    const switchTab = vi.spyOn(chats, 'switchTab')
    chats.activeTabId.value = session.id
    try {
      wrapper = mount(AiChat, { attachTo: document.body })
      await flushPromises()
      await wrapper.find('.abele-ai-chat__navigation').trigger('click')
      await click('Plan a sample garden')
      await pause(80)
      await wrapper.find('.abele-ai-chat__navigation').trigger('click')
      expect(wrapper.findComponent(ChatNavigation).props('canGoBack')).toBe(true)
      session.conversationVersion.value++
      await pause(80)
      await wrapper.find('.abele-ai-chat__navigation').trigger('click')
      expect(wrapper.findComponent(ChatNavigation).props('canGoBack')).toBe(false)
      await click('Add some shade')
      await pause(80)
      await wrapper.find('.abele-ai-chat__navigation').trigger('click')
      expect(wrapper.findComponent(ChatNavigation).props('canGoBack')).toBe(true)
      await click('Back to place')
      await pause(80)
      expect(switchTab).toHaveBeenCalledWith(session.id)
      await wrapper.find('.abele-ai-chat__navigation').trigger('click')
      expect(wrapper.findComponent(ChatNavigation).props('canGoBack')).toBe(false)
    } finally {
      wrapper?.unmount()
      wrapper = undefined
      chats.activeTabId.value = null
    }
  })

  it('opens the selected search part when reasoning and a tool result contain the same words', async () => {
    const rows = ref<ChatMessage[]>([
      { id: 'q', role: 'user', content: 'Read the sample plan', timestamp: 1 },
      {
        id: 'tool',
        role: 'tool-call',
        content: '',
        toolName: 'read',
        thinking: 'Sample liner',
        toolResult: 'Sample liner',
        toolStatus: 'approved',
        timestamp: 2,
      },
    ])
    const session = fakeChatSession({ messages: rows, kind: 'chat' })
    const service = ChatService.getInstance()
    vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
    vi.spyOn(service, 'activeSession', 'get').mockReturnValue({ value: session } as never)
    wrapper = mount(AiChat, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('.abele-ai-chat__navigation').trigger('click')
    await flushPromises()
    const input = root().querySelector('input')!
    input.value = 'liner'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    root().querySelectorAll<HTMLElement>('[data-nav-item]')[1].click()
    await pause(100)
    expect(wrapper.find('.abele-chat-find__count').text()).toBe('2 of 2')
    expect(wrapper.find('[data-message-id="tool"] [data-find-part="result"]').text()).toBe(
      'Sample liner'
    )
  })

  it('opens beside find and mounts an old question without switching the current branch', async () => {
    const rows = ref<ChatMessage[]>(
      Array.from({ length: 100 }, (_, i) => ({
        id: `q${i}`,
        role: 'user',
        content: `Sample question ${i}`,
        timestamp: i + 1,
      }))
    )
    const switchBranch = vi.fn()
    const session = fakeChatSession({ messages: rows, kind: 'chat', overrides: { switchBranch } })
    const service = ChatService.getInstance()
    vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
    vi.spyOn(service, 'activeSession', 'get').mockReturnValue({ value: session } as never)
    wrapper = mount(AiChat, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('[data-message-id="q0"]').exists()).toBe(false)
    await wrapper.find('.abele-ai-chat__navigation').trigger('click')
    await flushPromises()
    await click('Sample question 0')
    await pause(80)
    expect(root()).toBeNull()
    expect(wrapper.find('[data-message-id="q0"]').exists()).toBe(true)
    expect(switchBranch).not.toHaveBeenCalled()
  })
})
