/**
 * A long-lived node session in its chat: the settings control at the composer's foot, Stop in the
 * composer while anything runs, the background line, the ⋯ menu's Rename… and Stop the session…
 * with its confirmation, and the session's own commands after «/».
 */
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Menu } from 'obsidian'
import NodeChatView from '@/components/NodeChatView.vue'
import AiChatInput from '@/components/AiChatInput.vue'
import SessionSettings from '@/components/nodeSession/SessionSettings.vue'
import BackgroundTasks from '@/components/nodeSession/BackgroundTasks.vue'
import CompactModal from '@/components/nodeSession/CompactModal.vue'
import RenameModal from '@/components/nodeSession/RenameModal.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import ChatSlashSuggest from '@/components/ChatSlashSuggest.vue'
import type { NodeSessionLive } from '@/node/sessionLive'
import { SESSION_COMMANDS } from '@/node/NodeSessionControl'
import { useVault } from '../helpers/testEnv'

const sessionLive = (over: Partial<NodeSessionLive> = {}): NodeSessionLive => ({
  settings: { model: 'opus', effort: 'high', account: 'default', mode: 'bypass' },
  choices: {
    models: [{ id: 'opus', label: 'Opus' }],
    efforts: [{ id: 'high', label: 'High' }],
    accounts: [{ id: 'default', label: 'Main subscription' }],
    bypassAllowed: true,
  },
  context: { used: 412_000, limit: 1_000_000 },
  background: [{ id: 'k1', kind: 'command', title: 'npm test', since: Date.now() - 60_000 }],
  children: [],
  commands: SESSION_COMMANDS,
  change: vi.fn(),
  compact: vi.fn(),
  stop: vi.fn(),
  rename: vi.fn(),
  open: vi.fn(),
  ...over,
})
const presenter = (live: NodeSessionLive | null, runs: string[] = []) => ({
  id: 'sample-node-tab',
  reference: { registrationId: 'sample' },
  label: ref('Sample session'),
  provider: ref('claude'),
  nativeSessionId: ref('sample-native'),
  state: ref(runs.length ? 'running' : 'idle'),
  connection: { state: ref('connected'), error: ref(''), connect: vi.fn() },
  messages: ref([]),
  projection: ref({
    activeRuns: runs,
    queuedInputs: [],
    prompts: [],
    children: {},
    artifacts: [],
    unknown: [],
  }),
  queued: ref([]),
  rejected: ref([]),
  error: ref(''),
  draft: ref({ text: '', attachments: [] }),
  live: ref(live),
  control: { state: ref(null), rename: vi.fn() },
  send: vi.fn(),
  answer: vi.fn(),
  cancelInput: vi.fn(),
  interrupt: vi.fn(),
  openResource: vi.fn(),
})
let wrapper: VueWrapper | undefined
const open = (p: ReturnType<typeof presenter>) => {
  useVault([])
  wrapper = mount(NodeChatView, {
    props: { presenter: p as never },
    global: { stubs: { AiChatMessage: true } },
    attachTo: document.body,
  })
  return wrapper
}
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
})
const menuTitles = async (w: VueWrapper) => {
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  await w.get('[aria-label="More chat actions"]').trigger('click')
  return show.mock.contexts.at(-1) as Menu
}

describe('a node chat that is not a long-lived session', () => {
  it('has no settings control and no background line, and its Rename still works', async () => {
    const p = presenter(null)
    const w = open(p)
    expect(w.findComponent(SessionSettings).exists()).toBe(false)
    expect(w.findComponent(BackgroundTasks).exists()).toBe(false)
    const menu = await menuTitles(w)
    expect(menu.items.map((i) => i.title)).toContain('Rename…')
    expect(menu.items.map((i) => i.title)).not.toContain('Stop the session…')
    menu.items.find((i) => i.title === 'Rename…')!.handler!()
    await flushPromises()
    w.findComponent(RenameModal).vm.$emit('rename', 'Sample new name')
    expect(p.control.rename).toHaveBeenCalledWith('Sample new name')
  })
})

describe('a long-lived node session', () => {
  it('puts its settings at the composer foot and what runs over the composer', () => {
    const w = open(presenter(sessionLive()))
    const input = w.findComponent(AiChatInput)
    expect(input.findComponent(SessionSettings).exists()).toBe(true)
    expect(input.get('.abele-context-meter').text()).toBe('41%')
    expect(w.findComponent(BackgroundTasks).text()).toContain('1 in the background')
  })

  it('stands Stop in the composer while a turn runs, which stops the turn and keeps the session', async () => {
    const p = presenter(sessionLive(), ['p1'])
    const w = open(p)
    expect(w.find('[aria-label="Interrupt turn"]').exists()).toBe(false)
    expect(w.findComponent(AiChatInput).props('isStreaming')).toBe(true)
    await w.get('.abele-chat-input__stop').trigger('click')
    expect(p.interrupt).toHaveBeenCalledWith('p1')
    expect(p.live.value!.stop).not.toHaveBeenCalled()
  })

  it('keeps Stop while it compacts', () => {
    const w = open(presenter(sessionLive({ compacting: true })))
    expect(w.findComponent(AiChatInput).props('isStreaming')).toBe(true)
  })

  it('stops the whole session from ⋯ after saying what stops', async () => {
    const p = presenter(sessionLive())
    const w = open(p)
    const menu = await menuTitles(w)
    menu.items.find((i) => i.title === 'Stop the session…')!.handler!()
    await flushPromises()
    const confirm = w.findComponent(ConfirmModal)
    expect(confirm.props('message')).toContain('the task running in the background')
    expect(confirm.props('message')).toContain('The conversation stays')
    confirm.vm.$emit('confirm')
    expect(p.live.value!.stop).toHaveBeenCalled()
  })

  it('offers its own commands after «/», and opens the compact dialog for /compact', async () => {
    const p = presenter(sessionLive())
    const w = open(p)
    const input = w.findComponent(AiChatInput)
    expect(input.props('slashExtra')!.map((i: { name: string }) => i.name)).toEqual([
      'compact',
      'model',
      'effort',
      'mode',
      'rename',
      'stop',
    ])
    input.vm.$emit('command', '/compact')
    await flushPromises()
    const modal = w.findComponent(CompactModal)
    modal.vm.$emit('compact', 'the parser', 'Go on.')
    expect(p.live.value!.compact).toHaveBeenCalledWith('the parser', 'Go on.')
  })

  it('renames by «/rename» with words, without sending them to the agent', async () => {
    const p = presenter(sessionLive())
    const w = open(p)
    w.findComponent(AiChatInput).vm.$emit('send', '/rename Sample renamed')
    await flushPromises()
    expect(p.live.value!.rename).toHaveBeenCalledWith('Sample renamed')
    expect(p.send).not.toHaveBeenCalled()
  })

  it('offers the agent’s own commands and skills after the session’s, and sends one as the message', async () => {
    const p = {
      ...presenter(sessionLive()),
      agentCommands: ref([
        { name: 'compact', description: 'The agent’s own compact' },
        { name: 'review', description: 'Review the changes', input_hint: 'branch' },
        { name: 'sample-skill', description: null, source: 'skill' },
      ]),
    }
    const w = open(p)
    const input = w.findComponent(AiChatInput)
    const items = input.props('slashExtra') as { kind: string; name: string; title: string }[]
    // A name the session answers itself stays the session's.
    expect(items.filter((i) => i.name === 'compact')).toHaveLength(1)
    expect(items.slice(-2)).toEqual([
      expect.objectContaining({ kind: 'agent', name: 'review', title: '/review branch' }),
      expect.objectContaining({ kind: 'skill', name: 'sample-skill', title: '/sample-skill' }),
    ])
    input.vm.$emit('send', '/review main')
    await flushPromises()
    expect(p.send).toHaveBeenCalled()
    expect(p.send.mock.calls[0][0]).toBe('/review main')
  })

  it('offers the agent’s commands in a chat that is not a long-lived one too', () => {
    const p = {
      ...presenter(null),
      agentCommands: ref([{ name: 'review', description: 'Review' }]),
    }
    const items = open(p).findComponent(AiChatInput).props('slashExtra') as { name: string }[]
    expect(items.map((i) => i.name)).toEqual(['review'])
  })

  it('lists only the session commands in the «/» list', () => {
    const list = mount(ChatSlashSuggest, {
      props: {
        query: '',
        textOnly: true,
        extra: SESSION_COMMANDS.map((c) => ({ ...c, title: `/${c.name}` })),
      },
    })
    expect(list.text()).toContain('/rename')
    expect(list.text()).not.toContain('/load')
    list.unmount()
  })
})

describe('a background task', () => {
  it('has no stop of its own while the node cannot stop one task alone', async () => {
    const w = open(presenter(sessionLive()))
    await w.get('.abele-bg-tasks .tree-item-self').trigger('click')
    expect(w.find('.abele-bg-tasks__task [aria-label="Stop this task"]').exists()).toBe(false)
  })
})

describe('a long session', () => {
  it('keeps following when a pending scroll event arrives after streamed content grows', async () => {
    const p = presenter(null)
    const w = open(p)
    const list = w.get('.abele-ai-chat__messages')
    const element = list.element as HTMLElement
    let height = 1000
    Object.defineProperties(element, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 400 },
    })
    element.scrollTop = 600
    await list.trigger('scroll')
    height = 1400
    // This event was queued at the old end before the new output was laid out.
    await list.trigger('scroll')
    p.messages.value = []
    await flushPromises()
    expect(element.scrollTop).toBe(1400)
  })

  it('lets the reader scroll away while live messages continue', async () => {
    const p = presenter(null)
    const w = open(p)
    const list = w.get('.abele-ai-chat__messages')
    const element = list.element as HTMLElement
    Object.defineProperties(element, {
      scrollHeight: { get: () => 1000 },
      clientHeight: { get: () => 400 },
    })
    element.scrollTop = 600
    await list.trigger('scroll')
    element.scrollTop = 400
    await list.trigger('scroll')
    p.messages.value = []
    await flushPromises()
    expect(element.scrollTop).toBe(400)
  })

  it('reads the earlier page from the node when the list is scrolled to its top', async () => {
    const p = {
      ...presenter(sessionLive()),
      hasOlder: ref(true),
      olderState: ref('idle'),
      loadOlder: vi.fn(async () => {}),
    }
    const w = open(p as never)
    expect(w.get('.abele-node-chat__older').text()).toBe('Loading earlier messages…')
    const list = w.get('.abele-ai-chat__messages')
    ;(list.element as HTMLElement).scrollTop = 0
    await list.trigger('scroll')
    await flushPromises()
    expect(p.loadOlder).toHaveBeenCalled()
  })

  it('offers to try again when the node could not give the earlier page', async () => {
    const p = {
      ...presenter(sessionLive()),
      hasOlder: ref(true),
      olderState: ref('failed'),
      loadOlder: vi.fn(async () => {}),
    }
    const w = open(p as never)
    expect(w.get('.abele-node-chat__older').text()).toContain('Could not read earlier messages')
    await w.get('.abele-node-chat__older button').trigger('click')
    expect(p.loadOlder).toHaveBeenCalled()
  })

  it('shows no such line once the session is shown from its start', () => {
    const w = open({ ...presenter(sessionLive()), hasOlder: ref(false) } as never)
    expect(w.find('.abele-node-chat__older').exists()).toBe(false)
  })
})
