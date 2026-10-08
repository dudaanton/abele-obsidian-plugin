import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, ref, shallowRef } from 'vue'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { Notice, TFile } from 'obsidian'
import AiChat from '@/components/AiChat.vue'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { CommentService } from '@/ai/CommentService'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { serializeChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'
import { useFakeClock } from '../helpers/fakeClock'
const pause = useFakeClock()
let session: ChatSession
let wrapper: VueWrapper
const modal = () => document.querySelector<HTMLElement>('.abele-chat-navigation')!
const open = async () => {
  await wrapper.find('.abele-ai-chat__navigation').trigger('click')
  await flushPromises()
}
const chooseOther = async () => {
  await open()
  modal().querySelector<HTMLElement>('[data-fork-id="q"] > summary')!.click()
  await flushPromises()
  modal().querySelector<HTMLElement>('[data-continuation="b"] > button')!.click()
  await pause(80)
}
beforeEach(async () => {
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  const content = serializeChat({
    metadata: {
      type: 'abele-chat',
      created: '2030-01-01',
      providerId: '',
      modelId: '',
      activeLeafId: 'a2',
    },
    messages: [
      { id: 'q', role: 'user', content: 'Sample question', timestamp: 1 },
      { id: 'a', parentId: 'q', role: 'assistant', content: 'First answer', timestamp: 2 },
      { id: 'a2', parentId: 'a', role: 'user', content: 'First follow-up', timestamp: 3 },
      { id: 'b', parentId: 'q', role: 'assistant', content: 'Other answer', timestamp: 4 },
      { id: 'b1', parentId: 'b', role: 'user', content: 'Earliest later fork', timestamp: 5 },
      { id: 'b2', parentId: 'b', role: 'user', content: 'Later later fork', timestamp: 6 },
    ],
    internalMessages: [],
  })
  const app = useVault([{ path: 'Chats/sample-navigation-branches.abchat', raw: content }])
  const chats = ChatService.getInstance()
  vi.spyOn(chats, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(chats, 'saveTabs').mockImplementation(() => {})
  session = new ChatSession(chats)
  vi.spyOn(session, 'save').mockResolvedValue(undefined)
  await session.load(
    app.vault.getAbstractFileByPath('Chats/sample-navigation-branches.abchat') as TFile
  )
  vi.spyOn(chats, 'activeSession', 'get').mockReturnValue({ value: session } as never)
  chats.activeTabId.value = session.id
  session.draft.value.text = 'An unfinished sample message'
  wrapper = mount(AiChat, { attachTo: document.body })
  await flushPromises()
})
afterEach(() => {
  wrapper?.unmount()
  session?.destroy()
  ChatService.getInstance().activeTabId.value = null
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('branch jumps from navigation', () => {
  it('switches for the next send, displays the selected fork, and restores the exact old branch without losing the draft', async () => {
    await chooseOther()
    expect(session.messages.value.map((m) => m.id)).toEqual(['q', 'b', 'b1'])
    expect(wrapper.find('.abele-ai-chat__continuation').text()).toContain('Continuation 2 of 2')
    expect(session.draft.value.text).toBe('An unfinished sample message')
    await wrapper.find('.abele-ai-chat__continuation button').trigger('click')
    await flushPromises()
    expect(modal().querySelector<HTMLDetailsElement>('[data-fork-id="q"]')!.open).toBe(true)
    const back = [...modal().querySelectorAll('button')].find(
      (b) => b.textContent === 'Back to place'
    )!
    back.click()
    await pause(80)
    expect(session.branchLeafId).toBe('a2')
    expect(session.messages.value.map((m) => m.id)).toEqual(['q', 'a', 'a2'])
    expect(session.draft.value.text).toBe('An unfinished sample message')
  })

  it.each(['approval', 'question', 'action'])(
    'defers an off-path choice during %s and applies it only when the turn is finished',
    async (state) => {
      if (state === 'approval')
        session.pendingToolCalls.value = [
          { id: 'call', type: 'toolCall', name: 'read', arguments: {} },
        ] as never
      if (state === 'question')
        session.pendingQuestions.value = {
          questions: [{ question: 'Sample?', options: ['Yes'] }],
          currentIndex: 0,
          resolve: () => {},
        } as never
      if (state === 'action') session.isExecutingTool.value = true
      await chooseOther()
      expect(session.branchLeafId).toBe('a2')
      expect(wrapper.find('.abele-ai-chat__navigation-pending').text()).toContain(
        'when the agent finishes'
      )
      session.pendingToolCalls.value = []
      session.pendingQuestions.value = null
      session.isExecutingTool.value = false
      await pause(100)
      expect(session.branchLeafId).toBe('b1')
      expect(session.draft.value.text).toBe('An unfinished sample message')
    }
  )

  it('returns to the completed original branch when it grows before a deferred choice can run', async () => {
    session.isExecutingTool.value = true
    await chooseOther()
    const writer = session as unknown as {
      appendChatMessage(message: {
        id: string
        role: 'assistant'
        content: string
        timestamp: number
      }): void
    }
    writer.appendChatMessage({
      id: 'finished-original',
      role: 'assistant',
      content: 'The completed original answer',
      timestamp: 9,
    })
    session.updateVisibleMessages()
    session.isExecutingTool.value = false
    await pause(100)
    expect(session.branchLeafId).toBe('b1')
    await open()
    ;[...modal().querySelectorAll('button')]
      .find((button) => button.textContent === 'Back to place')!
      .click()
    await pause(100)
    expect(session.branchLeafId).toBe('finished-original')
    expect(session.messages.value.map((message) => message.id)).toEqual([
      'q',
      'a',
      'a2',
      'finished-original',
    ])
  })

  it('restores an intentionally unsent interior path instead of following an existing continuation', async () => {
    session.createBranch('a')
    await pause(80)
    await chooseOther()
    await open()
    ;[...modal().querySelectorAll('button')]
      .find((button) => button.textContent === 'Back to place')!
      .click()
    await pause(100)
    expect(session.branchLeafId).toBe('a')
    expect(session.messages.value.map((message) => message.id)).toEqual(['q', 'a'])
  })

  it('does not silently restore to a different reading point after the saved message is removed', async () => {
    const box = wrapper.find('.abele-ai-chat__messages').element as HTMLElement
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => 200 })
    box.getBoundingClientRect = () => ({ top: 0, bottom: 200 }) as DOMRect
    for (const element of box.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const top =
        element.dataset.messageId === 'q' ? -150 : element.dataset.messageId === 'a' ? 0 : 100
      element.getBoundingClientRect = () => ({ top, bottom: top + 100 }) as DOMRect
    }
    box.scrollTop = 100
    await chooseOther()
    const state = session as unknown as { allChatMessages: ChatMessage[] }
    state.allChatMessages = state.allChatMessages
      .filter((message) => message.id !== 'a')
      .map((message) => (message.id === 'a2' ? { ...message, parentId: 'q' } : message))
    session.updateVisibleMessages()
    Notice.shown.length = 0
    await open()
    ;[...modal().querySelectorAll('button')]
      .find((button) => button.textContent === 'Back to place')!
      .click()
    await pause(100)
    expect(session.branchLeafId).toBe('b1')
    expect(Notice.shown.join(' ')).toContain('saved place is no longer')
  })

  it('keeps each conversation continuation marker when another chat is navigated', async () => {
    const first = session
    const active = shallowRef<unknown>(first)
    const chats = ChatService.getInstance()
    vi.spyOn(chats, 'activeSession', 'get').mockReturnValue(computed(() => active.value) as never)
    wrapper.unmount()
    wrapper = mount(AiChat, { attachTo: document.body })
    await flushPromises()
    await chooseOther()
    const all = [...first.allMessages.value]
    const secondMessages = ref(all.filter((message) => ['q', 'a', 'a2'].includes(message.id)))
    const second = fakeChatSession({
      kind: 'chat',
      messages: secondMessages,
      overrides: {
        id: 'second-session',
        allMessages: ref(all),
        switchBranch: () => {
          secondMessages.value = all.filter((message) => ['q', 'b', 'b1'].includes(message.id))
          return true
        },
      },
    })
    active.value = second
    chats.activeTabId.value = second.id
    await pause(80)
    await chooseOther()
    active.value = first
    chats.activeTabId.value = first.id
    await pause(80)
    expect(wrapper.find('.abele-ai-chat__continuation').text()).toContain('Continuation 2 of 2')
  })

  it('resumes a deferred choice after an unfinished reply operation fails without publishing a message update', async () => {
    let failRead!: () => void
    vi.spyOn(GlobalStore.getInstance().app.vault, 'read').mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failRead = () => reject(new Error('sample read failed'))
        })
    )
    const changing = session
      .changeReply('a', (message) => ({ ...message, content: 'Changed sample answer' }))
      .catch((error) => error.message)
    await chooseOther()
    expect(session.branchLeafId).toBe('a2')
    failRead()
    expect(await changing).toBe('sample read failed')
    await pause(100)
    expect(session.branchLeafId).toBe('b1')
  })

  it('keeps a deferred choice outside the entire automatic retry turn, including the countdown handoff', async () => {
    AbeleConfig.getInstance().ai.autoRetry = { attempts: 1, firstDelayMs: 1000 }
    const loop = session as unknown as {
      runAgentLoop(): Promise<void>
      runAgentLoopOnce(): Promise<void>
    }
    const attempts: (string | null)[] = []
    let finishSecond!: () => void
    const second = new Promise<void>((resolve) => {
      finishSecond = resolve
    })
    vi.spyOn(loop, 'runAgentLoopOnce').mockImplementation(async () => {
      attempts.push(session.branchLeafId)
      session.isStreaming.value = true
      if (attempts.length === 1) session.error.value = 'HTTP 503: sample unavailable'
      else {
        await second
        session.error.value = null
      }
      session.isStreaming.value = false
    })
    const turn = loop.runAgentLoop()
    try {
      await flushPromises()
      expect(session.retrying.value).not.toBeNull()
      await chooseOther()
      await pause(1000)
      expect(attempts).toEqual(['a2', 'a2'])
      expect(session.branchLeafId).toBe('a2')
      finishSecond()
      await turn
      await pause(100)
      expect(session.branchLeafId).toBe('b1')
    } finally {
      finishSecond()
      session.cancelAutoRetry()
      await turn
    }
  })

  it('revalidates a discussion return point after its asynchronous open reconciles a changed file', async () => {
    const parent = session
    parent.kind = 'comment'
    vi.spyOn(parent, 'commentId', 'get').mockReturnValue('parent-discussion')
    const child = fakeChatSession({
      overrides: { id: 'child-session', commentId: 'child-discussion', anchor: ref(null) },
    })
    const active = shallowRef<unknown>(parent)
    const chats = ChatService.getInstance()
    const comments = CommentService.getInstance()
    vi.spyOn(chats, 'activeSession', 'get').mockReturnValue(computed(() => active.value) as never)
    vi.spyOn(comments, 'trail').mockResolvedValue([])
    vi.spyOn(comments, 'load').mockResolvedValue(child as never)
    let finishOpen!: () => void
    vi.spyOn(comments, 'showInSidebar').mockImplementation(async (id) => {
      if (id === 'child-discussion') {
        active.value = child
        chats.activeTabId.value = child.id
        return true
      }
      return new Promise<boolean>((resolve) => {
        finishOpen = () => {
          const state = parent as unknown as { allChatMessages: ChatMessage[] }
          state.allChatMessages = state.allChatMessages
            .filter((message) => message.id !== 'a')
            .map((message) => (message.id === 'a2' ? { ...message, parentId: 'q' } : message))
          parent.updateVisibleMessages()
          active.value = parent
          chats.activeTabId.value = parent.id
          resolve(true)
        }
      })
    })
    wrapper.unmount()
    wrapper = mount(AiChat, { attachTo: document.body })
    await flushPromises()
    const box = wrapper.find('.abele-ai-chat__messages').element as HTMLElement
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => 200 })
    box.getBoundingClientRect = () => ({ top: 0, bottom: 200 }) as DOMRect
    for (const element of box.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const top =
        element.dataset.messageId === 'q' ? -150 : element.dataset.messageId === 'a' ? 0 : 100
      element.getBoundingClientRect = () => ({ top, bottom: top + 100 }) as DOMRect
    }
    box.scrollTop = 100
    const version = parent.conversationVersion.value
    await open()
    wrapper.findComponent({ name: 'ChatNavigation' }).vm.$emit('discussion', 'child-discussion')
    await pause(80)
    await open()
    ;[...modal().querySelectorAll('button')]
      .find((button) => button.textContent === 'Back to place')!
      .click()
    await flushPromises()
    expect(finishOpen).toBeTypeOf('function')
    Notice.shown.length = 0
    finishOpen()
    await pause(100)
    expect(parent.conversationVersion.value).toBe(version)
    expect(parent.branchLeafId).toBe('a2')
    expect(parent.allMessages.value.some((message) => message.id === 'a')).toBe(false)
    expect(Notice.shown.join(' ')).toContain('saved place is no longer')
  })

  it('advances each back step when a discussion becomes selected before its sidebar reveal finishes', async () => {
    const root = session
    const parent = fakeChatSession({
      messages: ref([
        { id: 'parent-q', role: 'user', content: 'Parent sample discussion', timestamp: 1 },
      ]),
      overrides: { id: 'parent-session', commentId: 'parent-discussion', anchor: ref(null) },
    })
    const child = fakeChatSession({
      messages: ref([
        { id: 'child-q', role: 'user', content: 'Child sample discussion', timestamp: 2 },
      ]),
      overrides: { id: 'child-session', commentId: 'child-discussion', anchor: ref(null) },
    })
    const active = shallowRef<unknown>(root)
    const chats = ChatService.getInstance()
    const comments = CommentService.getInstance()
    vi.spyOn(chats, 'activeSession', 'get').mockReturnValue(computed(() => active.value) as never)
    vi.spyOn(chats, 'switchTab').mockImplementation((id) => {
      if (id === root.id) {
        active.value = root
        chats.activeTabId.value = id
      }
    })
    vi.spyOn(comments, 'trail').mockResolvedValue([])
    vi.spyOn(comments, 'load').mockImplementation(
      async (id) => (id === 'parent-discussion' ? parent : child) as never
    )
    let slowReveal = false
    let finishReveal!: () => void
    vi.spyOn(comments, 'showInSidebar').mockImplementation(async (id) => {
      const target = id === 'parent-discussion' ? parent : child
      active.value = target
      chats.activeTabId.value = target.id
      if (slowReveal && id === 'parent-discussion')
        await new Promise<void>((resolve) => {
          finishReveal = resolve
        })
      return true
    })
    wrapper.unmount()
    wrapper = mount(AiChat, { attachTo: document.body })
    await flushPromises()
    await open()
    wrapper.findComponent({ name: 'ChatNavigation' }).vm.$emit('discussion', 'parent-discussion')
    await pause(80)
    await open()
    wrapper.findComponent({ name: 'ChatNavigation' }).vm.$emit('discussion', 'child-discussion')
    await pause(80)
    slowReveal = true
    try {
      await open()
      ;[...modal().querySelectorAll('button')]
        .find((button) => button.textContent === 'Back to place')!
        .click()
      await pause(80)
      expect(active.value).toBe(parent)
      expect(finishReveal).toBeTypeOf('function')
      await open()
      ;[...modal().querySelectorAll('button')]
        .find((button) => button.textContent === 'Back to place')!
        .click()
      await pause(80)
      expect(active.value).toBe(root)
    } finally {
      finishReveal?.()
      await flushPromises()
    }
  })

  it('keeps reading available on the current branch while busy and cancels a deferred switch explicitly', async () => {
    session.isExecutingTool.value = true
    await chooseOther()
    await wrapper.find('.abele-ai-chat__navigation-pending button').trigger('click')
    await open()
    modal().querySelector<HTMLElement>('[data-question="q"]')!.click()
    await pause(80)
    expect(session.branchLeafId).toBe('a2')
    expect(modal()).toBeNull()
    session.isExecutingTool.value = false
    await pause(100)
    expect(session.branchLeafId).toBe('a2')
  })

  it('drops a deferred choice if the conversation lifetime changes before the turn finishes', async () => {
    session.isExecutingTool.value = true
    await chooseOther()
    session.conversationVersion.value++
    session.isExecutingTool.value = false
    await pause(100)
    expect(session.branchLeafId).toBe('a2')
    expect(wrapper.find('.abele-ai-chat__navigation-pending').exists()).toBe(false)
  })

  it('opens discussion search results at their exact message and part through the existing comment path', async () => {
    const comments = CommentService.getInstance()
    vi.spyOn(comments, 'load').mockResolvedValue(session)
    const show = vi.spyOn(comments, 'showInSidebar').mockResolvedValue(true)
    await open()
    wrapper
      .findComponent({ name: 'ChatNavigation' })
      .vm.$emit('discussion', 'sample-discussion', 'a', 'content', 'answer')
    await pause(100)
    expect(show.mock.lastCall?.[1]).toEqual(expect.any(Function))
    expect(wrapper.find('.abele-chat-find__count').text()).toBe('1 of 1')
  })
})
