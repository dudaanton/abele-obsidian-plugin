/**
 * The chat header picks an agent, not a model, and per-chat settings say which of them they
 * came from.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { Notice, TFile } from 'obsidian'
import AiChat from '@/components/AiChat.vue'
import AiAgentSelector from '@/components/AiAgentSelector.vue'
import AiChatInput from '@/components/AiChatInput.vue'
import Icon from '@/components/obsidian/Icon.vue'
import AgentOverrideNotice from '@/components/AgentOverrideNotice.vue'
import { ChatService } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { CommentService } from '@/ai/CommentService'
import { GlobalStore } from '@/stores/GlobalStore'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [
    { id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false },
    { id: 'small', name: 'Small', contextWindow: 50, maxTokens: 5, supportsReasoning: false },
  ],
}

let session: ChatSession

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
  }

  const registry = AgentRegistry.getInstance()
  const main = registry.create({
    name: 'Researcher',
    providerId: 'p1',
    modelId: 'big',
    permissionMode: 'allow-edit',
  })
  registry.setDefault(main.id)
  registry.create({ name: 'Writer', providerId: 'p1', modelId: 'small' })
  registry.create({ name: 'Titler', utility: true, providerId: 'p1', modelId: 'small' })

  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
    value: session,
  } as never)
  vi.spyOn(session, 'save').mockImplementation(async () => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the agent picker', () => {
  it('offers the agents a person can chat with, and not the utility ones', () => {
    const view = mount(AiAgentSelector, { shallow: true })

    const options = view.findComponent({ name: 'Dropdown' }).props('options') as Array<{
      display: string
    }>
    expect(options.map((o) => o.display)).toEqual(['Researcher', 'Writer'])
  })

  it('shows the model in force beside the agent', () => {
    const view = mount(AiAgentSelector, { shallow: true })

    expect(view.find('.abele-agent-selector__model').text()).toBe('Big')
  })

  it('falls back to the model id when the provider gave it no name', () => {
    // Models fetched from a provider's /models endpoint often arrive unnamed.
    AbeleConfig.getInstance().ai.providers[0].models[0].name = ''

    const view = mount(AiAgentSelector, { shallow: true })

    expect(view.find('.abele-agent-selector__model').text()).toBe('big')
  })

  it('follows a per-chat model override', async () => {
    session.activeModelId.value = 'small'

    const view = mount(AiAgentSelector, { shallow: true })

    expect(view.find('.abele-agent-selector__model').text()).toBe('Small')
    expect(view.find('.abele-agent-selector__model').attributes('title')).toContain('overridden')
  })

  it('switches the chat onto another agent', async () => {
    const writer = AgentRegistry.getInstance().getByName('Writer')!
    const view = mount(AiAgentSelector, { shallow: true })

    await view.findComponent({ name: 'Dropdown' }).vm.$emit('update:modelValue', writer.id)

    expect(session.agentId.value).toBe(writer.id)
  })

  it('says so when there is no agent to choose', () => {
    AbeleConfig.getInstance().ai.agents.forEach((a) => (a.utility = true))

    const view = mount(AiAgentSelector, { shallow: true })

    expect(view.find('.abele-agent-selector__empty').exists()).toBe(true)
  })
})

describe('the override notice', () => {
  const props = {
    field: 'permissionMode' as const,
    fromAgent: 'Comes from the agent.',
    overridden: 'Overridden here.',
  }

  it('says a setting comes from the agent, and offers no reset', () => {
    const view = mount(AgentOverrideNotice, { props, shallow: true })

    expect(view.find('.abele-override-notice__text').text()).toBe('Comes from the agent.')
    expect(view.find('.abele-override-notice__reset').exists()).toBe(false)
  })

  it('says a setting was overridden, and offers the way back', async () => {
    session.permissionMode.value = 'allow-all'

    const view = mount(AgentOverrideNotice, { props, shallow: true })

    expect(view.find('.abele-override-notice__text').text()).toBe('Overridden here.')
    expect(view.findComponent('.abele-override-notice__reset').props('textRight')).toContain(
      'Researcher'
    )
  })

  it('resets the field back to the agent', async () => {
    session.permissionMode.value = 'allow-all'
    const view = mount(AgentOverrideNotice, { props, shallow: true })

    await view.findComponent('.abele-override-notice__reset').vm.$emit('click')

    expect(session.isOverridden('permissionMode')).toBe(false)
    expect(session.permissionMode.value).toBe('allow-edit')
  })

  it('resets provider and model together, since they are one choice', async () => {
    session.activeProviderId.value = 'p1'
    session.activeModelId.value = 'small'
    const view = mount(AgentOverrideNotice, {
      props: { ...props, field: 'modelId' as const },
      shallow: true,
    })

    await view.findComponent('.abele-override-notice__reset').vm.$emit('click')

    expect(session.isOverridden('modelId')).toBe(false)
    expect(session.isOverridden('providerId')).toBe(false)
    expect(session.activeModelId.value).toBe('big')
  })
})

describe('resolving the model a chat will send to', () => {
  it('uses the agent model when nothing is overridden', () => {
    expect(session.resolveModel()?.id).toBe('big')
  })

  it('refuses rather than substituting when the model is gone', () => {
    AgentRegistry.getInstance().update(session.agentId.value, { modelId: 'deleted' })

    expect(session.resolveModel()).toBeNull()
  })

  it('reports no fallback until one is configured', () => {
    expect(session.hasFallbackModel).toBe(false)

    AgentRegistry.getInstance().update(session.agentId.value, {
      fallbackProviderId: 'p1',
      fallbackModelId: 'small',
    })

    expect(session.hasFallbackModel).toBe(true)
    expect(session.resolveModel({ fallback: true })?.id).toBe('small')
  })

  it('moves the chat onto the fallback and leaves it there', () => {
    AgentRegistry.getInstance().update(session.agentId.value, {
      fallbackProviderId: 'p1',
      fallbackModelId: 'small',
    })

    expect(session.useFallbackModel()).toBe(true)

    expect(session.activeModelId.value).toBe('small')
    expect(session.isOverridden('modelId')).toBe(true)
  })

  it('declines to move when no fallback exists', () => {
    expect(session.useFallbackModel()).toBe(false)
    expect(session.activeModelId.value).toBe('big')
  })
})

/**
 * The way back out of a comment that was expanded into a chat.
 *
 * The header is where a per-chat action belongs, and this one is per-chat in the strictest
 * sense: it exists only while the chat in front of the reader is a comment's, and pressing it
 * puts the conversation back in the margin of the note it was written against.
 */
describe('an expanded comment in the sidebar', () => {
  const collapse = vi.fn()
  const openLinkText = vi.fn().mockResolvedValue(undefined)

  /** A comment file, so the session has an id to be collapsed by. */
  function anchor(kind: 'chat' | 'comment') {
    const file = new TFile()
    file.path = 'AI/Comments/k7d2ph.abchat'
    file.basename = 'k7d2ph'
    session.currentChatFile.value = file
    session.anchor.value = { note: 'Notes/A.md' }
    session.kind = kind
  }

  beforeEach(() => {
    // Answers whether the chat moved. True is the ordinary case; the refusal is its own test.
    collapse.mockReset().mockResolvedValue(true)
    openLinkText.mockClear()
    Notice.shown.length = 0
    ;(GlobalStore.getInstance().app as unknown as { workspace: unknown }).workspace = {
      openLinkText,
    }
    vi.spyOn(ChatService.getInstance(), 'ensureInitialized').mockImplementation(() => {})
    vi.spyOn(CommentService, 'getInstance').mockReturnValue({ collapse } as never)
  })

  const backToNote = () => {
    // The agent picker's dropdown is Obsidian's own component and is stubbed the way the
    // comment card stubs it; what is being asked here is which actions the header carries.
    const view = mount(AiChat, { attachTo: document.body, global: { stubs: { Dropdown: true } } })
    const icon = view
      .findAllComponents(Icon)
      .find((candidate) => candidate.props('icon') === 'panel-right-close')
    return { view, icon }
  }

  it('is not offered in a chat that was never a comment', () => {
    expect(backToNote().icon).toBeUndefined()
  })

  it('collapses the chat and opens the note it is anchored to', async () => {
    anchor('chat')

    const { icon } = backToNote()
    expect(icon).toBeDefined()

    await icon!.vm.$emit('click')
    await nextTick()

    expect(collapse).toHaveBeenCalledWith('k7d2ph')
    expect(openLinkText).toHaveBeenCalledWith('Notes/A.md', '', false)
  })

  /**
   * The way back rebinds the agent and rewrites what the file says this conversation is, and
   * neither may happen between a `tool_use` and the `tool_result` that has to follow it. The
   * service refuses it; the header is what stops the reader finding that out by pressing.
   */
  it('is dark while the agent is mid-turn, and says why', () => {
    anchor('chat')
    session.pendingToolCalls.value = [{ id: 'tc1', name: 'read_note', input: {} }] as never

    const { icon } = backToNote()

    expect(icon!.props('disabled')).toBe(true)
    expect(icon!.props('tooltip')).toContain('still working')
  })

  it('says why it was refused rather than leaving the note half-opened', async () => {
    anchor('chat')
    collapse.mockResolvedValue(false)

    const { icon } = backToNote()
    await icon!.vm.$emit('click')
    await nextTick()

    expect(Notice.shown).toContain('Finish or dismiss the pending step first')
    expect(openLinkText).not.toHaveBeenCalled()
  })

  /**
   * A move already running is a different refusal from a turn in flight: nothing is wrong, and
   * what was asked for is already happening. Pressing twice on a slow disk is how it is met.
   */
  it('is dark while the same move is already running, and says so', async () => {
    anchor('chat')
    session.moving.value = true

    const { icon } = backToNote()

    expect(icon!.props('disabled')).toBe(true)
    expect(icon!.props('tooltip')).toBe('This comment is being moved')
  })

  it('does not ask a second time for a move it can see running', async () => {
    anchor('chat')
    session.moving.value = true

    const { icon } = backToNote()
    await icon!.vm.$emit('click')
    await nextTick()

    expect(Notice.shown).toEqual(['Already moving this comment'])
    expect(collapse).not.toHaveBeenCalled()
    expect(openLinkText).not.toHaveBeenCalled()
  })
})

/**
 * A comment being read in the sidebar, which is what a phone and a narrow split get instead of
 * a card in the margin.
 *
 * It is still a comment — same file, same kind, same agent — so the header offers the two moves
 * that belong to one and takes away the two that would quietly destroy it: "New chat" resets
 * the session the marker points at, and "History" loads another chat file into it.
 */
describe('a comment shown in the sidebar', () => {
  const showActions = { hideFromSidebar: vi.fn(), expand: vi.fn(), collapse: vi.fn() }
  const openLinkText = vi.fn().mockResolvedValue(undefined)

  function asComment(): void {
    const file = new TFile()
    file.path = 'AI/Comments/k7d2ph.abchat'
    file.basename = 'k7d2ph'
    session.currentChatFile.value = file
    session.anchor.value = { note: 'Notes/A.md' }
    session.kind = 'comment'
  }

  beforeEach(() => {
    showActions.hideFromSidebar.mockReset().mockResolvedValue(undefined)
    showActions.expand.mockReset().mockResolvedValue(true)
    showActions.collapse.mockReset().mockResolvedValue(true)
    openLinkText.mockClear()
    Notice.shown.length = 0
    ;(GlobalStore.getInstance().app as unknown as { workspace: unknown }).workspace = {
      openLinkText,
    }
    vi.spyOn(ChatService.getInstance(), 'ensureInitialized').mockImplementation(() => {})
    vi.spyOn(CommentService, 'getInstance').mockReturnValue(showActions as never)
  })

  const header = () => {
    const view = mount(AiChat, { attachTo: document.body, global: { stubs: { Dropdown: true } } })
    return {
      view,
      // Scoped to the header: the tab strip carries a `plus` of its own, for a new tab.
      icon: (name: string) =>
        view
          .findAllComponents(Icon)
          .find(
            (candidate) =>
              candidate.props('icon') === name &&
              !!candidate.element.closest('.abele-ai-chat__header-actions')
          ),
    }
  }

  it('offers the way back to the note and the way up into a full chat', () => {
    asComment()

    const { icon } = header()

    expect(icon('panel-right-close')).toBeDefined()
    expect(icon('panel-right-open')).toBeDefined()
  })

  it('offers neither in an ordinary chat', () => {
    const { icon } = header()

    expect(icon('panel-right-close')).toBeUndefined()
    expect(icon('panel-right-open')).toBeUndefined()
  })

  it('takes away the two actions that would destroy the comment', () => {
    asComment()

    const { icon } = header()

    expect(icon('plus')).toBeUndefined()
    expect(icon('history')).toBeUndefined()
  })

  it('keeps them for an ordinary chat', () => {
    const { icon } = header()

    expect(icon('plus')).toBeDefined()
    expect(icon('history')).toBeDefined()
  })

  /**
   * Back to the note takes the tab down without ending the conversation: the session goes on
   * writing the same file from the margin, which is where the reader has just been sent.
   */
  it('hands the session back and opens the note it is anchored in', async () => {
    asComment()

    const { icon } = header()
    await icon('panel-right-close')!.vm.$emit('click')
    await nextTick()

    expect(showActions.hideFromSidebar).toHaveBeenCalledWith('k7d2ph')
    expect(showActions.collapse).not.toHaveBeenCalled()
    expect(openLinkText).toHaveBeenCalledWith('Notes/A.md', '', false)
  })

  it('promotes it into a full chat when that is what was pressed', async () => {
    asComment()

    const { icon } = header()
    await icon('panel-right-open')!.vm.$emit('click')
    await nextTick()

    expect(showActions.expand).toHaveBeenCalledWith('k7d2ph')
  })

  it('says why a promotion was refused rather than failing silently', async () => {
    asComment()
    showActions.expand.mockResolvedValue(false)

    const { icon } = header()
    await icon('panel-right-open')!.vm.$emit('click')
    await nextTick()

    expect(Notice.shown).toContain('Finish or dismiss the pending step first')
  })

  it('is dark while the agent is mid-turn, both ways', () => {
    asComment()
    session.pendingToolCalls.value = [{ id: 'tc1', name: 'read_note', input: {} }] as never

    const { icon } = header()

    expect(icon('panel-right-close')!.props('disabled')).toBe(true)
    expect(icon('panel-right-open')!.props('disabled')).toBe(true)
  })

  /** The composer is where a note is written, so the button belongs to it, not to the header. */
  it('lets the composer keep a note, which an ordinary chat may not', () => {
    asComment()
    const { view } = header()

    expect(view.findComponent(AiChatInput).props('canNote')).toBe(true)
  })

  it('keeps the note button out of an ordinary chat', () => {
    const { view } = header()

    expect(view.findComponent(AiChatInput).props('canNote')).toBe(false)
  })

  it('blocks the note button while a turn is open', () => {
    asComment()
    session.pendingToolCalls.value = [{ id: 'tc1', name: 'read_note', input: {} }] as never

    const { view } = header()

    expect(view.findComponent(AiChatInput).props('noteBlocked')).toBe(true)
  })
})

/**
 * The agent a comment runs on is usually a utility agent — `commentAgentId` names one in every
 * vault that took the default — and utility agents are deliberately absent from this list. A
 * `select` handed a value none of its options carry shows the first one instead, so the picker
 * would sit there naming an agent this conversation has nothing to do with.
 */
describe('the agent picker over a chat on an agent it does not list', () => {
  it('adds the session own agent rather than misreporting it', () => {
    const titler = AgentRegistry.getInstance().getByName('Titler')!
    session.kind = 'comment'
    session.agentId.value = titler.id

    const view = mount(AiAgentSelector, { shallow: true })

    const options = view.findComponent({ name: 'Dropdown' }).props('options') as Array<{
      value: string
    }>
    expect(options.map((o) => o.value)).toContain(titler.id)
    expect(view.findComponent({ name: 'Dropdown' }).props('modelValue')).toBe(titler.id)
  })

  it('lists nothing twice for a chat on an agent it does list', () => {
    const view = mount(AiAgentSelector, { shallow: true })

    const options = view.findComponent({ name: 'Dropdown' }).props('options') as Array<{
      display: string
    }>
    expect(options.map((o) => o.display)).toEqual(['Researcher', 'Writer'])
  })
})
