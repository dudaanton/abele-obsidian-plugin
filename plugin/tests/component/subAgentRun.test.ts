/**
 * The delegated branch, as it appears in the chat.
 *
 * The point of the whole run machinery is that a sub-agent stops being "something happening
 * somewhere" — so what matters here is that the transcript is reachable, that a fan-out reads
 * as a list rather than a wall, and that a read-only run offers no way to type into it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AiSubAgentRun from '@/components/AiSubAgentRun.vue'
import AiRunBranch from '@/components/AiRunBranch.vue'
import AiRunView from '@/components/AiRunView.vue'
import AiRunMessage from '@/components/AiRunMessage.vue'
import Badge from '@/components/obsidian/Badge.vue'
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

describe('a delegated run in the chat', () => {
  it('stays collapsed until asked, naming the agent and the scale of the work', () => {
    const view = mount(AiSubAgentRun, {
      props: { run: runRef({ branchCount: 12 }) },
      shallow: true,
    })

    expect(view.find('.abele-run__agent').text()).toBe('Worker')
    expect(view.find('.abele-run__summary').text()).toContain('12 tasks')
    expect(view.find('.abele-run__body').exists()).toBe(false)
  })

  it('says when a run is still going', () => {
    const view = mount(AiSubAgentRun, {
      props: { run: runRef({ status: 'running' }) },
      shallow: true,
    })

    expect(view.find('.abele-run__summary').text()).toContain('running')
  })

  it('says when a run finished badly rather than quietly', () => {
    const view = mount(AiSubAgentRun, {
      props: { run: runRef({ status: 'error' }) },
      shallow: true,
    })

    expect(view.find('.abele-run__summary').text()).toContain('errors')
  })

  it('loads the transcript on expand', async () => {
    const view = mount(AiSubAgentRun, { props: { run: runRef() }, shallow: true })

    await view.find('.abele-run__head').trigger('click')
    await view.vm.$nextTick()

    expect(view.findComponent(AiRunBranch).exists()).toBe(true)
  })

  it('goes straight to the messages when there was only one task', async () => {
    const view = mount(AiSubAgentRun, { props: { run: runRef() }, shallow: true })

    await view.find('.abele-run__head').trigger('click')
    await view.vm.$nextTick()

    // Nothing to choose between, so no item list to click through first.
    expect(view.findComponent(AiRunBranch).props('showItem')).toBe(false)
  })

  it('lists the items when the task fanned out', async () => {
    stored = runFile([branch('alpha'), branch('beta')])
    const view = mount(AiSubAgentRun, { props: { run: runRef({ branchCount: 2 }) }, shallow: true })

    await view.find('.abele-run__head').trigger('click')
    await view.vm.$nextTick()

    const branches = view.findAllComponents(AiRunBranch)
    expect(branches).toHaveLength(2)
    expect(branches[0].props('showItem')).toBe(true)
  })

  it('pages a wide fan-out rather than rendering every branch at once', async () => {
    stored = runFile(Array.from({ length: 14 }, (_, i) => branch(`item-${i}`)))
    const view = mount(AiSubAgentRun, {
      props: { run: runRef({ branchCount: 14 }) },
      shallow: true,
    })

    await view.find('.abele-run__head').trigger('click')
    await view.vm.$nextTick()

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
    const view = mount(AiSubAgentRun, { props: { run: runRef() }, shallow: true })

    await view.find('.abele-run__open').trigger('click')

    expect(openRun).toHaveBeenCalledWith('r1')
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
      shallow: true,
    })

    expect(view.find('.abele-run-branch__messages').exists()).toBe(false)

    await view.find('.abele-run-branch__head').trigger('click')

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
