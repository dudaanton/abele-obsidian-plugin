/**
 * The card in the margin: what it says folded, what it opens into, and what it refuses to do.
 *
 * A sidenote is 180–300 px wide and stacked against its neighbours, so folded it shows four
 * things — whose agent, how it is doing, what was asked, how the answer starts — and each of
 * the last two is clamped to two lines by CSS this tier cannot measure. What it *can* hold is
 * the markup those rules hang off, and the wiring of every action in the header.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref, type Ref } from 'vue'
import { Notice, TFile } from 'obsidian'
import CommentCard from '@/components/CommentCard.vue'
import CommentThread from '@/components/CommentThread.vue'
import CommentInput from '@/components/CommentInput.vue'
import Badge from '@/components/obsidian/Badge.vue'
import Button from '@/components/obsidian/Button.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Tabs from '@/components/obsidian/Tabs.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import { CommentEntry } from '@/entities/Comment'
import { CommentService } from '@/ai/CommentService'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { createAgent } from '@/ai/agents/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { ChatMessage } from '@/ai/types'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const NOTE = 'Notes/Anchor.md'
const QUOTE = 'The selected passage'
const BODY = `${QUOTE}%%c:k7d2ph%% and more.`

type FakeSession = ReturnType<typeof fakeChatSession>

const OTHER = 'Notes/Elsewhere.md'

const open: Ref<string | null> = ref(null)
const remove = vi.fn()
const expand = vi.fn()
const collapse = vi.fn()
const load = vi.fn()
/** Ids the service has written off, which is what the card says so instead of reading. */
const missing = new Set<string>()

let sessions: Record<string, FakeSession>
let app: FakeApp

const noteFile = () => app.vault.getAbstractFileByPath(NOTE) as TFile
const otherFile = () => app.vault.getAbstractFileByPath(OTHER) as TFile

beforeEach(() => {
  app = useVault([
    { path: NOTE, content: BODY },
    { path: OTHER, content: 'Nothing to do with it.' },
  ])
  // The header's agent picker reads the registry, which reads these: a card cannot be drawn
  // in a vault with no AI settings at all.
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
  open.value = null
  sessions = {}
  missing.clear()
  remove.mockReset()
  // Both answer whether the comment moved. True is the ordinary case; a test about a refusal
  // says so for itself.
  expand.mockReset().mockResolvedValue(true)
  collapse.mockReset().mockResolvedValue(true)
  load.mockReset().mockResolvedValue(null)

  vi.spyOn(CommentService, 'getInstance').mockReturnValue({
    open,
    load,
    remove,
    expand,
    collapse,
    isMissing: (id: string) => missing.has(id),
    sessionFor: (id: string) => sessions[id] ?? null,
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function message(over: Partial<ChatMessage> & Pick<ChatMessage, 'role'>): ChatMessage {
  return { id: `m-${over.role}`, content: '', timestamp: 1, ...over } as ChatMessage
}

/** Header actions by what they are, not by where they sit: an added action must not renumber. */
function action(view: VueWrapper, icon: string) {
  const found = view.findAllComponents(Icon).find((i) => i.props('icon') === icon)
  if (!found) throw new Error(`no action carrying the icon "${icon}"`)
  return found
}

function entryFor(ids: string[]): CommentEntry {
  return new CommentEntry({ id: 'vue-1', ids, notePath: NOTE, markerFrom: QUOTE.length })
}

function seed(id: string, overrides: Record<string, unknown> = {}, messages: ChatMessage[] = []) {
  const session = fakeChatSession({ messages: ref(messages), overrides })
  sessions[id] = session
  return session
}

/**
 * The note is read asynchronously for the changed-quote check, so give it two ticks.
 *
 * `ObsidianModal` is stubbed for the same reason `modelEditModal.test.ts` stubs it: the real
 * one opens an Obsidian modal and appends it to the document, which outlives the test.
 */
async function mountCard(ids: string[], host?: 'margin' | 'sheet') {
  const view = mount(CommentCard, {
    props: { entry: entryFor(ids), ...(host ? { host } : {}) },
    attachTo: document.body,
    global: {
      stubs: { ObsidianModal: { template: '<div><slot /></div>' }, Dropdown: true },
    },
  })
  await nextTick()
  await nextTick()
  return view
}

describe('a folded card', () => {
  it('names the agent and shows the question and the start of the answer', async () => {
    seed('k7d2ph', {}, [
      message({ role: 'user', content: 'What does this mean?' }),
      message({ role: 'assistant', content: 'It means this.' }),
    ])

    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(Badge).props('text')).toBe('Comment')
    expect(view.find('.abele-comment-card__line_user').text()).toBe('What does this mean?')
    expect(view.find('.abele-comment-card__line_assistant').text()).toBe('It means this.')
    expect(view.findComponent(CommentThread).exists()).toBe(false)
  })

  it('is the way in, all of it', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])
    const summary = view.find('.abele-comment-card__summary')
    expect(summary.attributes('role')).toBe('button')

    await summary.trigger('click')

    expect(open.value).toBe('k7d2ph')
  })

  it('opens from the keyboard on Space as well as on Enter', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])
    await view.find('.abele-comment-card__summary').trigger('keydown', { key: ' ' })

    expect(open.value).toBe('k7d2ph')
  })

  it('shows the answer that is arriving, not the one before it', async () => {
    seed('k7d2ph', { isStreaming: ref(true), streamingContent: ref('Half a thou') }, [
      message({ id: 'u1', role: 'user', content: 'Why?' }),
      message({ id: 'a1', role: 'assistant', content: 'An older answer.' }),
    ])

    const view = await mountCard(['k7d2ph'])

    expect(view.find('.abele-comment-card__line_assistant').text()).toBe('Half a thou')
  })

  it('wears the state of its conversation', async () => {
    seed('k7d2ph', { commentState: ref('pending') })

    const view = await mountCard(['k7d2ph'])

    expect(view.classes()).toContain('abele-comment-card_pending')
    expect(view.find('.abele-comment-card__state_pending').exists()).toBe(true)
  })

  it('is one surface while it is folded, so the hover is not a box in a box', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])

    expect(view.classes()).toContain('abele-comment-card_collapsed')
  })

  it('shows no state dot when there is nothing to say', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])

    expect(view.find('.abele-comment-card__state').exists()).toBe(false)
  })
})

describe('an opened card', () => {
  beforeEach(() => {
    open.value = 'k7d2ph'
  })

  it('tells the composer which host it is in, so a sheet gets a field a thumb can hit', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'], 'sheet')

    expect(view.findComponent(CommentInput).props('host')).toBe('sheet')
  })

  it('carries the thread, the composer and the actions of both', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(CommentThread).exists()).toBe(true)
    expect(view.findComponent(CommentInput).exists()).toBe(true)
    expect(view.findAllComponents(Icon).map((i) => i.props('icon'))).toEqual([
      'panel-right-open',
      'trash-2',
      'chevron-up',
      // The composer's own buttons come last: dictate, keep a note, and send.
      'mic',
      'sticky-note',
      'send-horizontal',
    ])
  })

  /** A note is the composer's word for it; the session's is a user turn nobody answered. */
  it('keeps a note in the conversation without starting the agent', async () => {
    const addUserNote = vi.fn()
    const sendMessage = vi.fn()
    seed('k7d2ph', { addUserNote, sendMessage })

    const view = await mountCard(['k7d2ph'])
    await view.findComponent(CommentInput).vm.$emit('note', 'Come back to this')

    expect(addUserNote).toHaveBeenCalledWith('Come back to this')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('drops the folded surface once it is open', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])

    expect(view.classes()).not.toContain('abele-comment-card_collapsed')
  })

  it('folds again from the chevron', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])
    await action(view, 'chevron-up').vm.$emit('click')

    expect(open.value).toBeNull()
  })

  it('promotes the comment into a chat, and says so', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])
    await action(view, 'panel-right-open').vm.$emit('click')
    await nextTick()

    expect(expand).toHaveBeenCalledWith('k7d2ph')
    // The conversation is a sidebar tab now. A host that covers the sidebar — the sheet —
    // has to get out of the way, and only the card knows the promotion happened.
    expect(view.emitted('promoted')).toHaveLength(1)
  })

  it('asks before it destroys a conversation', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])
    expect(view.findComponent(ConfirmModal).exists()).toBe(false)

    await action(view, 'trash-2').vm.$emit('click')
    expect(view.findComponent(ConfirmModal).exists()).toBe(true)
    expect(remove).not.toHaveBeenCalled()

    await view.findComponent(ConfirmModal).vm.$emit('confirm')
    expect(remove).toHaveBeenCalledWith('k7d2ph')
  })

  it('folds the card it is about to destroy', async () => {
    // `CommentService.remove` clears `open` too, but only after several vault writes — and a
    // card left expanded meanwhile is a card rendering a session being torn down under it.
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])
    await action(view, 'trash-2').vm.$emit('click')
    await view.findComponent(ConfirmModal).vm.$emit('confirm')

    expect(open.value).toBeNull()
  })

  it('takes the caret for a comment with nothing in it yet', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(CommentInput).props('focus')).toBe(true)
  })

  it('leaves the caret in the note when an existing conversation is expanded', async () => {
    seed('k7d2ph', {}, [message({ id: 'u1', role: 'user', content: 'Asked already' })])

    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(CommentInput).props('focus')).toBe(false)
  })

  it('sends what was typed to the session it is showing', async () => {
    const sendMessage = vi.fn()
    seed('k7d2ph', { sendMessage })

    const view = await mountCard(['k7d2ph'])
    await view.findComponent(CommentInput).vm.$emit('send', 'Why?')

    expect(sendMessage).toHaveBeenCalledWith('Why?')
  })

  it('stops the agent from the same place', async () => {
    const abort = vi.fn()
    seed('k7d2ph', { abort })

    const view = await mountCard(['k7d2ph'])
    await view.findComponent(CommentInput).vm.$emit('abort')

    expect(abort).toHaveBeenCalled()
  })

  it('refuses the composer while the file is still being read', async () => {
    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(CommentInput).props('disabled')).toBe(true)
    expect(view.findComponent(CommentThread).exists()).toBe(false)
  })

  it('asks for the comments at its marker to be read', async () => {
    await mountCard(['k7d2ph', '3mq0xa'])

    expect(load.mock.calls.map(([id]) => id)).toEqual(['k7d2ph', '3mq0xa'])
  })
})

describe('a marker carrying several comments', () => {
  beforeEach(() => {
    open.value = 'k7d2ph'
  })

  it('shows one thread at a time behind a small strip', async () => {
    const first = seed('k7d2ph')
    const second = seed('3mq0xa')

    const view = await mountCard(['k7d2ph', '3mq0xa'])
    const tabs = view.findComponent(Tabs)

    expect(tabs.props('level')).toBe('secondary')
    expect(tabs.props('tabs')).toEqual([
      { id: 'k7d2ph', label: '1', icon: 'message-circle', tooltip: 'Comment 1 of 2' },
      { id: '3mq0xa', label: '2', icon: 'message-circle', tooltip: 'Comment 2 of 2' },
    ])
    // Identity by `===` rather than `toBe`: vitest diffs a session's reactive graph on a
    // failure and runs out of heap doing it — see the contract's addenda.
    expect(view.findComponent(CommentThread).props('session') === first).toBe(true)

    await tabs.vm.$emit('update:modelValue', '3mq0xa')
    await nextTick()

    // The strip moves the marker's open state too, so the icon keeps agreeing with the card.
    expect(open.value).toBe('3mq0xa')
    expect(view.findComponent(CommentThread).props('session') === second).toBe(true)
  })

  it('keeps a half-typed question with the comment it was meant for', async () => {
    seed('k7d2ph')
    seed('3mq0xa')

    const view = await mountCard(['k7d2ph', '3mq0xa'])
    await view.find('textarea').setValue('Half a question')

    await view.findComponent(Tabs).vm.$emit('update:modelValue', '3mq0xa')
    await nextTick()

    expect(view.find('textarea').element.value).toBe('')
  })

  it('shows no strip for a single comment', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(Tabs).exists()).toBe(false)
  })
})

describe('a comment that was promoted into a chat', () => {
  beforeEach(() => {
    open.value = 'k7d2ph'
  })

  it('reads back the first exchange and sends the reader to the sidebar', async () => {
    const switchTab = vi.fn()
    const revealSidebar = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(ChatService, 'getInstance').mockReturnValue({ switchTab, revealSidebar } as never)

    seed('k7d2ph', { kind: 'chat' }, [
      message({ id: 'u1', role: 'user', content: 'What does this mean?' }),
      message({ id: 'a1', role: 'assistant', content: 'It means this.' }),
      message({ id: 'a2', role: 'assistant', content: 'And also this.' }),
    ])

    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(CommentInput).exists()).toBe(false)
    expect(view.findAll('.abele-comment-card__readonly-msg')).toHaveLength(2)

    const button = view.findComponent(Button)
    expect(button.props('text')).toBe('Open in sidebar')

    await button.vm.$emit('click')
    await nextTick()
    expect(switchTab).toHaveBeenCalledWith('session-1')
    expect(revealSidebar).toHaveBeenCalled()
    // Same again: what was asked for is on the sidebar, behind whatever this card is in.
    expect(view.emitted('promoted')).toHaveLength(1)
  })

  it('takes the conversation back to the margin it came from', async () => {
    seed('k7d2ph', { kind: 'chat' }, [
      message({ id: 'u1', role: 'user', content: 'What does this mean?' }),
    ])

    const view = await mountCard(['k7d2ph'])
    const back = view
      .findAllComponents(Button)
      .find((button) => button.props('text') === 'Back to comment')
    expect(back).toBeDefined()

    await back!.vm.$emit('click')
    await nextTick()

    expect(collapse).toHaveBeenCalledWith('k7d2ph')
    // Nothing has been handed to the sidebar, so a sheet has no reason to get out of the way.
    expect(view.emitted('promoted')).toBeUndefined()
  })

  it('offers no second promotion', async () => {
    seed('k7d2ph', { kind: 'chat' })

    const view = await mountCard(['k7d2ph'])

    expect(view.findAllComponents(Icon).map((i) => i.props('icon'))).not.toContain(
      'panel-right-open'
    )
  })
})

describe('a quote that no longer exists', () => {
  beforeEach(() => {
    open.value = 'k7d2ph'
  })

  it('says so quietly and shows what was quoted', async () => {
    seed('k7d2ph', { anchor: ref({ note: NOTE, quote: 'A passage nobody kept' }) })

    const view = await mountCard(['k7d2ph'])

    const notice = view.find('.abele-comment-card__notice')
    expect(notice.text()).toContain('The quoted text was changed')
    expect(notice.find('.abele-comment-card__quote').text()).toBe('A passage nobody kept')
  })

  it('says nothing while the quote is still in the note', async () => {
    seed('k7d2ph', { anchor: ref({ note: NOTE, quote: QUOTE }) })

    const view = await mountCard(['k7d2ph'])

    expect(view.find('.abele-comment-card__notice').exists()).toBe(false)
  })

  it('says nothing about a comment that never quoted anything', async () => {
    seed('k7d2ph', { anchor: ref({ note: NOTE }) })

    const view = await mountCard(['k7d2ph'])

    expect(view.find('.abele-comment-card__notice').exists()).toBe(false)
  })
})

/**
 * The note is a fact the card holds a copy of, and a copy read once is a copy that goes stale:
 * the reader edits the passage, or an agent rewrites it, and the notice keeps the answer from
 * whenever the card happened to be mounted.
 */
describe('the note the card was reading', () => {
  it('is read again when the card is opened', async () => {
    seed('k7d2ph', { anchor: ref({ note: NOTE, quote: QUOTE }) })
    const view = await mountCard(['k7d2ph'])
    await app.vault.modify(noteFile(), 'Nothing like it%%c:k7d2ph%% and more.')

    open.value = 'k7d2ph'
    await nextTick()
    await nextTick()

    expect(view.find('.abele-comment-card__notice').exists()).toBe(true)
  })

  it('is read again when the note changes under an open card', async () => {
    open.value = 'k7d2ph'
    seed('k7d2ph', { anchor: ref({ note: NOTE, quote: QUOTE }) })
    const view = await mountCard(['k7d2ph'])
    expect(view.find('.abele-comment-card__notice').exists()).toBe(false)

    await app.vault.modify(noteFile(), 'Nothing like it%%c:k7d2ph%% and more.')
    app.emit('vault', 'modify', noteFile())
    await nextTick()
    await nextTick()

    expect(view.find('.abele-comment-card__notice').exists()).toBe(true)
  })

  it('is left alone when some other note changes', async () => {
    open.value = 'k7d2ph'
    seed('k7d2ph', { anchor: ref({ note: NOTE, quote: QUOTE }) })
    await mountCard(['k7d2ph'])
    const reads = app.stats.read

    app.emit('vault', 'modify', otherFile())
    await nextTick()

    expect(app.stats.read).toBe(reads)
  })

  it('stops being listened for once the card goes', async () => {
    open.value = 'k7d2ph'
    seed('k7d2ph')
    const offref = vi.spyOn(app.vault, 'offref')
    const view = await mountCard(['k7d2ph'])

    view.unmount()

    expect(offref).toHaveBeenCalled()
  })
})

describe('a comment with no file behind it', () => {
  beforeEach(() => {
    open.value = 'k7d2ph'
  })

  it('is still being read while nothing has been settled either way', async () => {
    const view = await mountCard(['k7d2ph'])

    expect(view.text()).toContain('Reading this comment')
  })

  it('says the file is missing once the service has written it off', async () => {
    missing.add('k7d2ph')

    const view = await mountCard(['k7d2ph'])

    expect(view.text()).toContain("This comment's file is missing")
    expect(view.text()).not.toContain('Reading this comment')
  })
})

describe('the same card in a sheet', () => {
  it('leaves the closing to the dialog rather than offering a second way out', async () => {
    open.value = 'k7d2ph'
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'], 'sheet')

    expect(view.findAllComponents(Icon).map((i) => i.props('icon'))).not.toContain('chevron-up')
  })
})

/**
 * A comment is a chat, and a chat runs on an agent — so the card says which, and lets it be
 * changed without opening the conversation as a full one.
 *
 * The list is the one a person would recognise: the agents they configured. Utility agents are
 * kept out, because they exist for scripts and delegation rather than for being talked to —
 * with one exception, the agent `commentAgentId` names, which is a utility agent in every
 * vault that took the default and is the very agent this card is running on.
 */
describe('the agent a comment runs on', () => {
  const AGENTS = [
    createAgent({ id: 'comment-agent', name: 'Comment', utility: true }),
    createAgent({ id: 'writer', name: 'Writer' }),
    createAgent({ id: 'summariser', name: 'Summariser', utility: true }),
  ]

  beforeEach(() => {
    open.value = 'k7d2ph'
    AgentRegistry.destroy()
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: AGENTS.map((agent) => ({ ...agent })),
      commentAgentId: 'comment-agent',
    }
  })

  it('offers the configured agents and the comment agent, and no other utility one', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(Dropdown).props('options')).toEqual([
      { value: 'comment-agent', display: 'Comment' },
      { value: 'writer', display: 'Writer' },
    ])
  })

  it('shows the one this conversation is already on', async () => {
    seed('k7d2ph', { agentId: ref('writer') })

    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(Dropdown).props('modelValue')).toBe('writer')
  })

  it('switches the session, which is what carries the choice into the file', async () => {
    const switchAgent = vi.fn()
    seed('k7d2ph', { switchAgent })

    const view = await mountCard(['k7d2ph'])
    await view.findComponent(Dropdown).vm.$emit('update:model-value', 'writer')

    expect(switchAgent).toHaveBeenCalledWith('writer')
  })

  it('says nothing twice: the picker replaces the badge only once the card is open', async () => {
    open.value = null
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(Dropdown).exists()).toBe(false)
    expect(view.findComponent(Badge).props('text')).toBe('Comment')
  })
})

/**
 * A turn that has stopped to ask something is holding half of itself open.
 *
 * The card already tells `busy` from `pending` — the dot on its edge is drawn from the same
 * distinction — and the composer needs to hear about it, because a note kept now lands between
 * a `tool_use` and its `tool_result` and the next question is refused by the model over it.
 * The session refuses it too; this is what stops the person finding that out by pressing.
 */
describe('a card over a conversation waiting to be answered', () => {
  beforeEach(() => {
    open.value = 'k7d2ph'
    Notice.shown.length = 0
  })

  it('tells the composer, which is where the note button is', async () => {
    seed('k7d2ph', { commentState: ref('pending') })

    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(CommentInput).props('pending')).toBe(true)
    // Streaming is the other thing, and it is reported separately: the send button stops it.
    expect(view.findComponent(CommentInput).props('busy')).toBe(false)
  })

  it('leaves the composer alone when nothing is being waited on', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(CommentInput).props('pending')).toBe(false)
  })

  it('says why a note was refused rather than swallowing it', async () => {
    seed('k7d2ph', { addUserNote: vi.fn().mockResolvedValue(false) })

    const view = await mountCard(['k7d2ph'])
    await view.findComponent(CommentInput).vm.$emit('note', 'Come back to this')
    await nextTick()

    expect(Notice.shown).toContain('Finish or dismiss the pending step first')
  })

  it('says nothing when the note was kept', async () => {
    seed('k7d2ph', { addUserNote: vi.fn().mockResolvedValue(true) })

    const view = await mountCard(['k7d2ph'])
    await view.findComponent(CommentInput).vm.$emit('note', 'Come back to this')
    await nextTick()

    expect(Notice.shown).toEqual([])
  })
})

/**
 * Moving a conversation that is in the middle of a turn.
 *
 * Promoting a comment and sending a chat back to the margin both rebind the agent and rewrite
 * what the file says the conversation is — neither of which may land between a `tool_use` and
 * the `tool_result` that has to follow it. The service refuses both; the card is what stops
 * the person finding that out by pressing, and says so if they press anyway.
 */
describe('a card over a conversation that is mid-turn', () => {
  beforeEach(() => {
    open.value = 'k7d2ph'
    Notice.shown.length = 0
  })

  it('darkens the way into the sidebar, and says why', async () => {
    seed('k7d2ph', { isMidTurn: true })

    const view = await mountCard(['k7d2ph'])
    const promote = action(view, 'panel-right-open')

    expect(promote.props('disabled')).toBe(true)
    expect(promote.props('tooltip')).toContain('still working')
  })

  it('leaves it alone when the conversation is idle', async () => {
    seed('k7d2ph')

    const view = await mountCard(['k7d2ph'])

    expect(action(view, 'panel-right-open').props('disabled')).toBe(false)
  })

  it('darkens the way back to the margin, and says why', async () => {
    seed('k7d2ph', { kind: 'chat', isMidTurn: true }, [
      message({ id: 'u1', role: 'user', content: 'What does this mean?' }),
    ])

    const view = await mountCard(['k7d2ph'])
    const back = view
      .findAllComponents(Button)
      .find((button) => button.props('text') === 'Back to comment')

    expect(back!.props('disabled')).toBe(true)
    expect(back!.props('tooltip')).toContain('still working')
  })

  it('says why a promotion was refused rather than claiming it happened', async () => {
    seed('k7d2ph')
    expand.mockResolvedValue(false)

    const view = await mountCard(['k7d2ph'])
    await action(view, 'panel-right-open').vm.$emit('click')
    await nextTick()

    expect(Notice.shown).toContain('Finish or dismiss the pending step first')
    // Nothing has been handed to the sidebar, so a sheet must not go anywhere.
    expect(view.emitted('promoted')).toBeUndefined()
  })

  it('says why a return to the margin was refused', async () => {
    seed('k7d2ph', { kind: 'chat' }, [message({ id: 'u1', role: 'user', content: 'Why?' })])
    collapse.mockResolvedValue(false)

    const view = await mountCard(['k7d2ph'])
    const back = view
      .findAllComponents(Button)
      .find((button) => button.props('text') === 'Back to comment')
    await back!.vm.$emit('click')
    await nextTick()

    expect(Notice.shown).toContain('Finish or dismiss the pending step first')
  })
})

/**
 * An agent can be deleted while a comment that ran on it is still in the vault.
 *
 * `session.agent` falls back to the default one so the conversation keeps working, but the
 * picker's value is the raw `agentId`, and a `select` given a value none of its options carry
 * shows the first option instead — the card would sit there naming an agent this comment has
 * nothing to do with. The id is shown as itself, marked, which is at least true.
 */
describe('a comment whose agent has been deleted', () => {
  beforeEach(() => {
    open.value = 'k7d2ph'
    AgentRegistry.destroy()
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [createAgent({ id: 'writer', name: 'Writer' })],
      commentAgentId: '',
    }
  })

  it('keeps the missing agent in the list, and says that is what it is', async () => {
    seed('k7d2ph', { agentId: ref('gone-agent') })

    const view = await mountCard(['k7d2ph'])

    expect(view.findComponent(Dropdown).props('options')).toEqual([
      { value: 'writer', display: 'Writer' },
      { value: 'gone-agent', display: 'gone-agent (deleted)' },
    ])
    expect(view.findComponent(Dropdown).props('modelValue')).toBe('gone-agent')
  })
})
