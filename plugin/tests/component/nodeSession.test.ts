/**
 * A long-lived node session in its chat: the mode and model at the composer's foot, the share of
 * the context taken, what runs in the background, the sessions it started and the panel's tree
 * of them. Codes for state, the words in tooltips; each piece hands its action to the session.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionSettings from '@/components/nodeSession/SessionSettings.vue'
import ContextMeter from '@/components/nodeSession/ContextMeter.vue'
import BackgroundTasks from '@/components/nodeSession/BackgroundTasks.vue'
import SessionTree from '@/components/nodeSession/SessionTree.vue'
import SessionMarkLine from '@/components/nodeSession/SessionMarkLine.vue'
import { chatBlocks, runSummary } from '@/ai/toolRuns'
import type { ChatMessage } from '@/ai/types'
import type { ChildSession, NodeSessionLive } from '@/node/sessionLive'

const NOW = 1_000_000_000
const live = (over: Partial<NodeSessionLive> = {}): NodeSessionLive => ({
  settings: { model: 'big', effort: 'high', account: 'one', mode: 'bypass' },
  choices: {
    models: [{ id: 'big', label: 'Sample 5.5' }],
    efforts: [{ id: 'high', label: 'High' }],
    accounts: [{ id: 'one', label: 'First account' }],
    bypassAllowed: true,
  },
  context: { used: 412_000, limit: 1_000_000 },
  background: [],
  children: [],
  commands: [],
  change: vi.fn(),
  stopTask: vi.fn(),
  compact: vi.fn(),
  stop: vi.fn(),
  rename: vi.fn(),
  open: vi.fn(),
  ...over,
})
const child = (over: Partial<ChildSession> = {}): ChildSession => ({
  id: 'c1',
  title: 'Sample task',
  agent: 'Helper',
  kind: 'agent',
  state: 'running',
  started: NOW - 6 * 60e3,
  ...over,
})

describe('SessionSettings', () => {
  it('shows the mode as a glyph, red when nothing is asked, the model by its family and the context share', () => {
    const view = mount(SessionSettings, { props: { live: live() } })
    expect(view.get('.abele-session-settings__mode').classes()).toContain(
      'abele-session-settings__mode_bypass'
    )
    expect(view.get('.abele-session-settings__model').text()).toBe('Sample')
    expect(view.get('.abele-context-meter').text()).toBe('41%')
  })

  it('leaves an asking mode uncoloured', () => {
    const view = mount(SessionSettings, {
      props: {
        live: live({
          settings: { model: 'big', effort: 'high', account: 'one', mode: 'manual' },
        }),
      },
    })
    expect(view.get('.abele-session-settings__mode').classes()).not.toContain(
      'abele-session-settings__mode_bypass'
    )
  })
})

describe('ContextMeter', () => {
  it('says the share taken, quiet until it nears the end, red at it', () => {
    const at = (used: number) =>
      mount(ContextMeter, { props: { context: { used, limit: 1_000_000 } } }).classes()
    expect(at(412_000)).toContain('abele-context-meter_ok')
    expect(at(862_000)).toContain('abele-context-meter_high')
    expect(at(990_000)).toContain('abele-context-meter_full')
  })
})

describe('BackgroundTasks', () => {
  it('draws nothing while nothing runs', () => {
    expect(mount(BackgroundTasks, { props: { tasks: [] } }).html()).not.toContain('abele-bg-tasks')
  })

  it('counts what runs, lists each with how long, and stops one', async () => {
    const view = mount(BackgroundTasks, {
      props: {
        now: NOW,
        expanded: true,
        tasks: [
          { id: 't1', kind: 'command', title: 'npm run sample', since: NOW - 14 * 60e3 },
          { id: 't2', kind: 'monitor', title: 'The sample log', since: NOW - 40e3 },
        ],
      },
    })
    expect(view.get('.abele-tree-item__text').text()).toBe('2 in the background')
    const flairs = view
      .findAll('.abele-bg-tasks__task .abele-tree-item__flair')
      .map((f) => f.text())
    expect(flairs).toEqual(['14m', '40s'])
    await view.findAll('.abele-bg-tasks__task [aria-label="Stop this task"]')[0].trigger('click')
    expect(view.emitted('stop')).toEqual([['t1']])
  })
})

describe('BackgroundTasks with the sessions it started', () => {
  it('lists the agents with the tasks, opens by itself while one waits, and opens its chat', async () => {
    const view = mount(BackgroundTasks, {
      props: {
        now: NOW,
        sessions: [child(), child({ id: 'c2', state: 'waiting' })],
        tasks: [{ id: 't1', kind: 'command', title: 'npm run sample', since: NOW - 60e3 }],
      },
    })
    const head = view.get('.abele-bg-tasks > .abele-tree-item > .tree-item-self')
    expect(head.text()).toContain('3 in the background')
    expect(head.get('.abele-status-dot').classes()).toContain('abele-status-dot_orange')
    await view.findAll('.abele-session-row > .tree-item-self')[1].trigger('click')
    expect(view.emitted('open')).toEqual([['c2']])
  })

  it('stays one folded line while the agents only work', () => {
    const view = mount(BackgroundTasks, { props: { now: NOW, tasks: [], sessions: [child()] } })
    expect(view.text()).toBe('1 in the background')
    expect(view.find('.abele-session-row').exists()).toBe(false)
  })

  it('counts the sessions a started session started in turn in its dot', () => {
    const view = mount(BackgroundTasks, {
      props: {
        now: NOW,
        tasks: [],
        sessions: [child({ state: 'done', children: [child({ id: 'c2', state: 'failed' })] })],
      },
    })
    expect(view.get('.abele-status-dot').classes()).toContain('abele-status-dot_red')
  })
})

describe('SessionTree', () => {
  it('shows two levels at once and folds what is deeper', () => {
    const view = mount(SessionTree, {
      props: {
        now: NOW,
        sessions: [
          child({
            id: 'top',
            kind: 'chat',
            title: 'Sample chat',
            mode: 'bypass',
            children: [child({ children: [child({ id: 'c3', title: 'Deepest task' })] })],
          }),
        ],
      },
    })
    const names = view.findAll('.abele-tree-item__text').map((t) => t.text())
    expect(names).toEqual(['Sample chat', 'Sample task'])
    expect(view.find('[aria-label="Bypass"]').exists()).toBe(true)
  })
})

describe('SessionMarkLine', () => {
  it('says how much a compacting kept', () => {
    const view = mount(SessionMarkLine, {
      props: { mark: { kind: 'compacted', before: 812_000, after: 64_000 } },
    })
    expect(view.text()).toBe('Compacted · 812k → 64k')
  })
})

describe('chatBlocks', () => {
  it('keeps a call that started a session in the run of calls: the session is listed over the composer', () => {
    const call = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
      id,
      role: 'tool-call',
      content: '',
      timestamp: 0,
      toolName: 'Read',
      ...extra,
    })
    const blocks = chatBlocks([call('a'), call('b', { toolName: 'start_session' }), call('c')])
    expect(blocks.map((b) => b.kind)).toEqual(['run'])
    expect(
      runSummary([call('a'), call('b', { toolName: 'start_session', toolResult: 'ok' })])
    ).toBe('Read · Started')
  })
})
