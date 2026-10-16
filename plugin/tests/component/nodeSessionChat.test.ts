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
  await w.get('[aria-label="Node session menu"]').trigger('click')
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
