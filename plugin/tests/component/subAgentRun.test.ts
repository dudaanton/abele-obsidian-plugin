/**
 * The delegated branch, as it appears in the chat.
 *
 * The point of the whole run machinery is that a sub-agent stops being "something happening
 * somewhere" — so what matters here is that the transcript is reachable, that a fan-out reads
 * as a list rather than a wall, and that a read-only run offers no way to type into it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AiSubAgentRun from '@/components/AiSubAgentRun.vue'
import AiRunBranch from '@/components/AiRunBranch.vue'
import AiRunView from '@/components/AiRunView.vue'
import AiRunMessage from '@/components/AiRunMessage.vue'
import Badge from '@/components/obsidian/Badge.vue'
import TreeItem from '@/components/obsidian/TreeItem.vue'
import { RunStorage, type RunBranch, type RunFile } from '@/ai/RunStorage'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage, type SubAgentRunRef } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

function message(role: ChatMessage['role'], content: string, id = content): ChatMessage {
  return { id, role, content, timestamp: 1 }
}

function branch(item: string, count = 2): RunBranch {
  return {
    item,
    status: 'done',
    result: `did ${item}`,
    messages: Array.from({ length: count }, (_, i) =>
      message(i % 2 === 0 ? 'user' : 'assistant', `${item} message ${i}`, `${item}-${i}`)
    ),
  }
}

function runFile(branches: RunBranch[]): RunFile {
  return {
    type: 'abele-run',
    runId: 'r1',
    agentId: 'a1',
    agentName: 'Worker',
    parentChat: 'AI/Chats/parent.abchat',
    parentToolCallId: 'tc1',
    task: 'Summarise each source',
    created: '2026-08-23 10:00',
    status: 'done',
    depth: 1,
    branches,
  }
}

function runRef(overrides: Partial<SubAgentRunRef> = {}): SubAgentRunRef {
  return {
    runId: 'r1',
    agentId: 'a1',
    agentName: 'Worker',
    path: 'AI/Chats/.runs/r1.abchat',
    status: 'done',
    branchCount: 1,
    ...overrides,
  }
}

let stored: RunFile | null = null

beforeEach(() => {
  installFakeIntersectionObserver()
  resetFakeIntersectionObservers()
  useVault([])
  RunStorage.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }

  stored = runFile([branch('alpha')])
  vi.spyOn(RunStorage.getInstance(), 'load').mockImplementation(async () => stored)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The run line itself, with the branches stubbed: what matters here is when they appear. */
const mountRun = (run: SubAgentRunRef) =>
  mount(AiSubAgentRun, { props: { run }, global: { stubs: { AiRunBranch: true } } })
const head = (view: ReturnType<typeof mountRun>) => view.find('.abele-run > .tree-item-self')

describe('a delegated run in the chat', () => {
  it('stays collapsed until asked, naming the agent and the scale of the work', () => {
    const view = mountRun(runRef({ branchCount: 12 }))

    const line = view.findComponent(TreeItem)
    expect(line.props('text')).toBe('Worker · 12 tasks')
    expect(line.props('collapsed')).toBe(true)
    expect(view.find('.abele-run__body').exists()).toBe(false)
    expect(RunStorage.getInstance().load).not.toHaveBeenCalled()
  })

  it('says when a run is still going, and stays open while it works', async () => {
    const view = mountRun(runRef({ status: 'running' }))
    await flushPromises()

    expect(view.findComponent(TreeItem).classes()).toContain('abele-run_running')
    const dot = view.find('.abele-chat-run__dot')
    expect(dot.classes()).toContain('abele-chat-run__dot_running')
    expect(dot.attributes('aria-label')).toBe('Working on it')
    expect(RunStorage.getInstance().load).toHaveBeenCalledWith('r1')
    expect(view.findComponent(AiRunBranch).exists()).toBe(true)
  })

  it('folds once it stops running', async () => {
    const view = mountRun(runRef({ status: 'running' }))
    await flushPromises()
    await view.setProps({ run: runRef({ status: 'done' }) })
    await flushPromises()

    expect(view.findComponent(TreeItem).props('collapsed')).toBe(true)
    expect(view.find('.abele-run__body').exists()).toBe(false)
  })

  it('says when a run finished badly rather than quietly', () => {
    const view = mountRun(runRef({ status: 'error' }))

    const dot = view.find('.abele-chat-run__dot')
    expect(dot.classes()).toContain('abele-chat-run__dot_failed')
    expect(dot.attributes('aria-label')).toBe('Finished with errors')
  })

  it('loads the transcript on expand', async () => {
    const view = mountRun(runRef())

    await head(view).trigger('click')
    await flushPromises()

    expect(RunStorage.getInstance().load).toHaveBeenCalledWith('r1')
    expect(view.findComponent(AiRunBranch).exists()).toBe(true)
  })

  it('goes straight to the messages when there was only one task', async () => {
    const view = mountRun(runRef())

    await head(view).trigger('click')
    await flushPromises()

    // Nothing to choose between, so no item list to click through first.
    expect(view.findComponent(AiRunBranch).props('showItem')).toBe(false)
  })

  it('lists the items when the task fanned out', async () => {
    stored = runFile([branch('alpha'), branch('beta')])
    const view = mountRun(runRef({ branchCount: 2 }))

    await head(view).trigger('click')
    await flushPromises()

    const branches = view.findAllComponents(AiRunBranch)
    expect(branches).toHaveLength(2)
    expect(branches[0].props('showItem')).toBe(true)
  })

  it('pages a wide fan-out rather than rendering every branch at once', async () => {
    stored = runFile(Array.from({ length: 14 }, (_, i) => branch(`item-${i}`)))
    const view = mountRun(runRef({ branchCount: 14 }))

    await head(view).trigger('click')
    await flushPromises()

    expect(view.findAllComponents(AiRunBranch)).toHaveLength(5)

    const sentinel = view.find('.abele-run__sentinel')
    expect(scrollIntoView(sentinel.element)).toBeGreaterThan(0)
    await view.vm.$nextTick()

    expect(view.findAllComponents(AiRunBranch)).toHaveLength(10)
  })

  it('opens the run in its own tab', async () => {
    const openRun = vi
      .spyOn(ChatService.getInstance(), 'openRun')
      .mockImplementation(async () => true)
    const view = mountRun(runRef())

    const open = view.find('.abele-run__open')
    expect(open.attributes('aria-label')).toBe('Open this run in its own tab')
    await open.trigger('click')

    expect(openRun).toHaveBeenCalledWith('r1')
    // The way to the tab does not fold or unfold the line it sits on.
    expect(view.findComponent(TreeItem).props('collapsed')).toBe(true)
  })
})

describe('a run branch', () => {
  it('shows the messages of a single-item run without a click', () => {
    const view = mount(AiRunBranch, {
      props: { branch: branch('alpha', 3), showItem: false },
      shallow: true,
    })

    expect(view.findAll('.abele-run-branch__messages')).toHaveLength(1)
  })

  it('keeps a fanned-out item collapsed until it is opened', async () => {
    const view = mount(AiRunBranch, {
      props: { branch: branch('alpha'), showItem: true },
      global: { stubs: { AiRunMessage: true } },
    })

    expect(view.findComponent(TreeItem).props('text')).toBe('alpha')
    expect(view.find('.abele-run-branch__messages').exists()).toBe(false)

    await view.find('.tree-item-self').trigger('click')

    expect(view.find('.abele-run-branch__messages').exists()).toBe(true)
  })

  it('surfaces what went wrong in a failed branch', async () => {
    const failed: RunBranch = { ...branch('alpha'), status: 'error', error: 'model refused' }

    const view = mount(AiRunBranch, { props: { branch: failed, showItem: false }, shallow: true })

    expect(view.find('.abele-run-branch__error').text()).toBe('model refused')
  })

  it('pages a long transcript', async () => {
    const long = branch('alpha', 46)
    const view = mount(AiRunBranch, { props: { branch: long, showItem: false }, shallow: true })
    await view.vm.$nextTick()

    expect(view.findAllComponents(AiRunMessage)).toHaveLength(20)

    expect(scrollIntoView(view.find('.abele-run-branch__sentinel').element)).toBeGreaterThan(0)
    await view.vm.$nextTick()

    expect(view.findAllComponents(AiRunMessage)).toHaveLength(40)
  })
})

describe('the read-only run tab', () => {
  it('names the agent and the task it was given', () => {
    const view = mount(AiRunView, { props: { run: runFile([branch('alpha')]) }, shallow: true })

    expect(view.find('.abele-run-view__agent').text()).toBe('Worker')
    expect(view.find('.abele-run-view__task').text()).toBe('Summarise each source')
  })

  it('says plainly that it cannot be typed into', () => {
    const view = mount(AiRunView, { props: { run: runFile([branch('alpha')]) }, shallow: true })

    expect(view.findComponent(Badge).props('text')).toBe('read-only')
    // No input, no approval, no questions — this conversation belongs to another agent.
    expect(view.find('textarea').exists()).toBe(false)
    expect(view.findAll('input')).toHaveLength(0)
  })

  it('offers the way back to the chat that started it', () => {
    const view = mount(AiRunView, { props: { run: runFile([branch('alpha')]) }, shallow: true })

    expect(view.find('.abele-run-view__parent').exists()).toBe(true)
  })

  it('omits the back link when the parent chat was never saved', () => {
    const orphan = { ...runFile([branch('alpha')]), parentChat: '' }

    const view = mount(AiRunView, { props: { run: orphan }, shallow: true })

    expect(view.find('.abele-run-view__parent').exists()).toBe(false)
  })
})
