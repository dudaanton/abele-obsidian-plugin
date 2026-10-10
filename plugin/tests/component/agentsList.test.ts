import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import AgentsListDialog from '@/components/AgentsListDialog.vue'
import AgentsButton from '@/components/AgentsButton.vue'
import ListRow from '@/components/obsidian/ListRow.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { openAgents, closeAgents } from '@/agents/openAgents'
import { openDialog } from '@/testing/openDialog'
import { ShellModal } from '@/modal/ShellModal'
import type { AttentionRow } from '@/agents/attention'
import { useVault } from '../helpers/testEnv'

const rows: AttentionRow[] = [
  {
    key: 'sample',
    reference: { kind: 'local', path: 'Chats/sample.abchat' },
    title: 'An intentionally long sample conversation title for narrow screens',
    agent: 'Sample agent',
    source: 'Чат',
    reasons: [{ kind: 'error', id: 'error-1', at: 10, text: 'Sample failure' }],
  },
]
const stub = { template: '<div><slot /></div>' }
describe('agents dialog', () => {
  it('shows all three sections, one row per session, and never approves from the list', () => {
    useVault([])
    const source = {
      rows: ref(rows),
      incomplete: ref(true),
      status: ref('Обновляется'),
      open: vi.fn(),
      markSeen: vi.fn(),
    }
    const wrapper = mount(AgentsListDialog, {
      props: { source },
      global: { stubs: { ObsidianModal: stub } },
    })
    expect(wrapper.text()).toContain('Нужно твоё действие')
    expect(wrapper.text()).toContain('Работают')
    expect(wrapper.text()).toContain('Связь и доставка')
    expect(wrapper.text()).toContain('Обновляется')
    expect(wrapper.findAll('.abele-list-row__main')).toHaveLength(1)
    expect(wrapper.find('input').attributes('autofocus')).toBeUndefined()
    expect(wrapper.text()).not.toContain('Approve')
    wrapper.unmount()
  })
  it('opens without acknowledging and acknowledges only on the separate seen button', async () => {
    const source = {
      rows: ref(rows),
      incomplete: ref(false),
      status: ref(''),
      open: vi.fn().mockResolvedValue(true),
      markSeen: vi.fn().mockResolvedValue(undefined),
    }
    const wrapper = mount(AgentsListDialog, {
      props: { source },
      global: { stubs: { ObsidianModal: stub } },
    })
    await wrapper.find('.abele-list-row__main').trigger('click')
    await flushPromises()
    expect(source.open).toHaveBeenCalledWith(rows[0], rows[0].reasons[0])
    expect(source.markSeen).not.toHaveBeenCalled()
    expect(wrapper.find('.abele-agents__seen').exists()).toBe(false)
    await wrapper.get('.abele-disclosure__control').trigger('click')
    expect(wrapper.find('.abele-agents__seen').element.textContent).toBe('Просмотрено')
    await wrapper.find('.abele-agents__seen').trigger('click')
    expect(source.markSeen).toHaveBeenCalledWith(rows[0], 'error-1')
    wrapper.unmount()
  })
  it('offers dismissals for stale non-error evidence, not live approvals or running work', async () => {
    const reasons = [
      { kind: 'approval' as const, id: 'stale-approval', at: 1, uncertain: true },
      { kind: 'question' as const, id: 'stale-question', at: 2, interrupted: true },
      { kind: 'interrupted' as const, id: 'stale-work', at: 3 },
      { kind: 'approval' as const, id: 'live-approval', at: 4 },
      { kind: 'running' as const, id: 'live-work', at: 5 },
    ]
    const source = {
      rows: ref([{ ...rows[0], reasons }]),
      incomplete: ref(true),
      status: ref(''),
      open: vi.fn(),
      markSeen: vi.fn().mockResolvedValue(undefined),
    }
    const wrapper = mount(AgentsListDialog, {
      props: { source },
      global: { stubs: { ObsidianModal: stub } },
    })
    await wrapper.get('.abele-disclosure__control').trigger('click')
    const buttons = wrapper.findAll('.abele-agents__seen')
    expect(buttons).toHaveLength(3)
    for (const button of buttons) expect(button.text()).toBe('Убрать')
    await buttons[0].trigger('click')
    expect(source.markSeen).toHaveBeenCalledWith(source.rows.value[0], 'stale-approval')
    wrapper.unmount()
  })
  it('uses content-sized native rows, named icon actions and keyboard opening', async () => {
    useVault([])
    const source = {
      rows: ref(rows),
      incomplete: ref(false),
      status: ref(''),
      open: vi.fn().mockResolvedValue(false),
      markSeen: vi.fn().mockResolvedValue(undefined),
    }
    const wrapper = mount(AgentsListDialog, {
      props: { source },
      global: {
        stubs: {
          ObsidianModal: {
            ...stub,
            name: 'ObsidianModal',
            props: { size: String, phoneSheet: Boolean },
          },
        },
      },
    })
    const modal = wrapper.findComponent({ name: 'ObsidianModal' })
    expect(modal.props('size')).not.toBe('tall')
    expect(modal.props('phoneSheet')).toBe(false)
    const row = wrapper.find('.abele-list-row__main')
    expect(wrapper.get('.abele-list-row__line').classes()).toContain('tree-item-self')
    // Native button activation (Enter/Space) is checked in the browser tier: happy-dom
    // does not synthesize the default click for a key event.
    expect(row.element.tagName).toBe('BUTTON')
    expect(row.attributes('type')).toBe('button')
    expect((row.element as HTMLButtonElement).tabIndex).toBe(0)
    expect(wrapper.find('.abele-list-row__title-text').text()).toBe(rows[0].title)
    expect(wrapper.find('.abele-meta-line').text()).toContain(rows[0].agent)
    await wrapper.get('.abele-disclosure__control').trigger('click')
    const action = wrapper.find('.abele-agents__seen')
    expect(action.classes()).toContain('clickable-icon')
    expect(action.attributes('aria-label')).toContain('Просмотрено')
    expect(action.attributes('aria-label')).toContain('Sample failure')
    expect(action.find('[data-icon="check"]').exists()).toBe(true)
    await row.trigger('click')
    await flushPromises()
    expect(source.open).toHaveBeenCalledWith(rows[0], rows[0].reasons[0])
    await row.trigger('click')
    await flushPromises()
    expect(source.open).toHaveBeenCalledTimes(2)
    expect(source.markSeen).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('renders labelled facts, native state glyphs and an opening chevron using the landed row', () => {
    useVault([])
    const source = {
      rows: ref([{ ...rows[0], model: 'Sample model', folder: 'Chats' }]),
      incomplete: ref(false),
      status: ref(''),
      open: vi.fn(),
      markSeen: vi.fn(),
    }
    const wrapper = mount(AgentsListDialog, {
      props: { source },
      global: { stubs: { ObsidianModal: stub } },
    })
    const row = wrapper.getComponent(ListRow)
    expect(row.props('interactive')).toBe(true)
    expect(row.text()).toContain('Модель: Sample model')
    expect(row.text()).toContain('Папка: Chats')
    expect(row.get('.abele-list-row__status-icon [data-icon="triangle-alert"]').exists()).toBe(true)
    expect(row.get('.abele-list-row__opener [data-icon="chevron-right"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('names Reply as opening the waiting question in chat and requests composer focus', async () => {
    const reason = {
      kind: 'question' as const,
      id: 'question-1',
      at: 10,
      text: 'Which sample folder?',
    }
    const row = { ...rows[0], reasons: [reason] }
    const source = {
      rows: ref([row]),
      incomplete: ref(false),
      status: ref(''),
      open: vi.fn().mockResolvedValue(true),
      markSeen: vi.fn(),
    }
    const wrapper = mount(AgentsListDialog, {
      props: { source },
      global: { stubs: { ObsidianModal: stub } },
    })
    const reply = wrapper
      .findAllComponents(Icon)
      .find((c) => c.props('textRight') === 'Ответить в чате')!
    expect(reply.props('tooltip')).toContain('вопрос')
    expect(reply.props('tooltip')).toContain('поле ответа')
    await reply.trigger('click')
    await flushPromises()
    expect(source.open).toHaveBeenCalledWith(row, reason, { focusComposer: true })
    expect(source.markSeen).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
  it('reconnects a node without opening or restarting work and explains the distinction', async () => {
    const row: AttentionRow = {
      ...rows[0],
      reference: { kind: 'node', registrationId: 'sample-node', nodeId: 'node-1', sessionId: '' },
      reasons: [{ kind: 'delivery', id: 'connection-1', at: 0, text: 'Connection lost' }],
    }
    const source = {
      rows: ref([row]),
      incomplete: ref(true),
      status: ref(''),
      open: vi.fn(),
      markSeen: vi.fn(),
      reconnect: vi.fn().mockResolvedValue(undefined),
    }
    const wrapper = mount(AgentsListDialog, {
      props: { source },
      global: { stubs: { ObsidianModal: stub } },
    })
    const retry = wrapper.findAllComponents(Icon).find((c) => c.props('icon') === 'refresh-cw')!
    expect(retry.props('textRight')).toBe('Восстановить связь')
    expect(retry.props('tooltip')).toContain('не перезапускает работу')
    await retry.trigger('click')
    await flushPromises()
    expect(source.reconnect).toHaveBeenCalledWith(row)
    expect(source.open).not.toHaveBeenCalled()
    expect(source.markSeen).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })
  it('owns one modal and releases it cleanly on command cleanup', async () => {
    useVault([])
    openAgents()
    openAgents()
    await flushPromises()
    expect(document.querySelectorAll('.abele-agents')).toHaveLength(1)
    closeAgents()
    await flushPromises()
    expect(document.querySelectorAll('.abele-agents')).toHaveLength(0)
  })
  it('marks the tab-choice fixture as owned and settles its completion on close', async () => {
    useVault([])
    const opened = vi.spyOn(ShellModal.prototype, 'open')
    try {
      const completion = openDialog('agents-tabs')
      expect(document.querySelector('.modal[data-abele-fixture="agents-tabs"]')).not.toBeNull()
      ;(opened.mock.contexts[0] as ShellModal).close()
      await completion
    } finally {
      ;(opened.mock.contexts[0] as ShellModal | undefined)?.close()
      opened.mockRestore()
    }
  })
  it('keeps the shared header entry keyboard accessible', () => {
    useVault([])
    const wrapper = mount(AgentsButton)
    const button = wrapper.find('[role="button"]')
    expect(button.attributes('tabindex')).toBe('0')
    expect(button.attributes('aria-label')).toContain('Агенты')
    wrapper.unmount()
  })
})
