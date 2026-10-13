import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import AgentsListDialog from '@/components/AgentsListDialog.vue'
import AgentsButton from '@/components/AgentsButton.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { openAgents, closeAgents } from '@/agents/openAgents'
import { openDialog } from '@/testing/openDialog'
import { SuggestModal } from 'obsidian'
import type { AttentionRow } from '@/agents/attention'
import { useVault } from '../helpers/testEnv'

const rows: AttentionRow[] = [
  {
    key: 'sample',
    reference: { kind: 'local', path: 'Chats/sample.abchat' },
    title: 'An intentionally long sample conversation title for narrow screens',
    agent: 'Sample agent',
    source: 'Chat',
    reasons: [{ kind: 'error', id: 'error-1', at: 10, text: 'Sample failure' }],
  },
]
const stub = { template: '<div><slot /></div>' }
const mountWith = (source: object) =>
  mount(AgentsListDialog, { props: { source }, global: { stubs: { ObsidianModal: stub } } })
const sourceOf = (list: AttentionRow[], extra: object = {}) => ({
  rows: ref(list),
  incomplete: ref(false),
  status: ref(''),
  open: vi.fn().mockResolvedValue(true),
  markSeen: vi.fn().mockResolvedValue(undefined),
  ...extra,
})
describe('agents dialog', () => {
  it('offers one native bulk seen action beside the search, independent of what is searched', async () => {
    const source = sourceOf(rows, { markAllSeen: vi.fn().mockResolvedValue(undefined) })
    const wrapper = mountWith(source)
    const action = wrapper.get('.abele-agents__all-seen')
    expect(action.classes()).toContain('clickable-icon')
    expect(action.attributes('aria-label')).toContain('Mark all as seen')
    await wrapper.get('input').setValue('no matching sample')
    await action.trigger('click')
    await flushPromises()
    expect(source.markAllSeen).toHaveBeenCalledOnce()
    expect(source.markSeen).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('groups by state, one row per session, hides empty groups and never approves from the list', () => {
    useVault([])
    const wrapper = mountWith(sourceOf(rows, { incomplete: ref(true), status: ref('Updating…') }))
    expect(wrapper.text()).toContain('Waiting for you')
    expect(wrapper.text()).not.toContain('Working')
    expect(wrapper.text()).not.toContain('Offline')
    expect(wrapper.text()).toContain('Updating…')
    expect(wrapper.findAll('.abele-agents__row')).toHaveLength(1)
    expect(wrapper.find('input').attributes('autofocus')).toBeUndefined()
    expect(wrapper.text()).not.toContain('Approve')
    wrapper.unmount()
  })
  it('says what waits in one line, with a dot for the state and the time', () => {
    useVault([])
    const wrapper = mountWith(sourceOf(rows))
    const row = wrapper.get('.abele-agents__row')
    expect(row.text()).toContain(rows[0].title)
    expect(row.text()).toContain('Sample failure')
    expect(row.text()).not.toContain('Agent:')
    expect(row.get('.abele-status-dot').classes()).toContain('abele-status-dot_red')
    expect(row.get('.abele-status-dot').attributes('aria-label')).toContain('Sample failure')
    wrapper.unmount()
  })
  it('opens without acknowledging and acknowledges only on the separate seen button', async () => {
    const source = sourceOf(rows)
    const wrapper = mountWith(source)
    await wrapper.get('.abele-agents__row').trigger('click')
    await flushPromises()
    expect(source.open).toHaveBeenCalledWith(rows[0], rows[0].reasons[0])
    expect(source.markSeen).not.toHaveBeenCalled()
    const seen = wrapper.get('.abele-agents__seen')
    expect(seen.attributes('aria-label')).toContain('Mark as seen')
    expect(seen.attributes('aria-label')).toContain('Sample failure')
    expect(seen.find('[data-icon="check"]').exists()).toBe(true)
    await seen.trigger('click')
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
    const source = sourceOf([{ ...rows[0], reasons }], { incomplete: ref(true) })
    const wrapper = mountWith(source)
    const buttons = wrapper.findAll('.abele-agents__seen')
    expect(buttons).toHaveLength(3)
    for (const button of buttons) expect(button.attributes('aria-label')).toContain('Dismiss')
    await buttons[0].trigger('click')
    expect(source.markSeen).toHaveBeenCalledWith(source.rows.value[0], 'stale-approval')
    wrapper.unmount()
  })
  it('opens a waiting question with the reply field focused', async () => {
    const reason = {
      kind: 'question' as const,
      id: 'question-1',
      at: 10,
      text: 'Which sample folder?',
    }
    const row = { ...rows[0], reasons: [reason] }
    const source = sourceOf([row])
    const wrapper = mountWith(source)
    expect(wrapper.get('.abele-agents__row').text()).toContain('Which sample folder?')
    await wrapper.get('.abele-agents__row').trigger('click')
    await flushPromises()
    expect(source.open).toHaveBeenCalledWith(row, reason, { focusComposer: true })
    expect(source.markSeen).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
  it('reconnects a node without opening or restarting work', async () => {
    const row: AttentionRow = {
      ...rows[0],
      reference: { kind: 'node', registrationId: 'sample-node', nodeId: 'node-1', sessionId: '' },
      reasons: [{ kind: 'delivery', id: 'connection-1', at: 0, text: 'Connection lost' }],
    }
    const source = sourceOf([row], {
      incomplete: ref(true),
      open: vi.fn(),
      reconnect: vi.fn().mockResolvedValue(undefined),
    })
    const wrapper = mountWith(source)
    expect(wrapper.text()).toContain('Offline')
    const retry = wrapper.findAllComponents(Icon).find((c) => c.props('icon') === 'refresh-cw')!
    expect(retry.props('tooltip')).toContain('does not restart work')
    await retry.trigger('click')
    await flushPromises()
    expect(source.reconnect).toHaveBeenCalledWith(row)
    expect(wrapper.text()).toContain('Connected.')
    expect(source.open).not.toHaveBeenCalled()
    expect(source.markSeen).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeUndefined()
    // A node session that is not there to open takes no click.
    expect(wrapper.get('.abele-agents__row').attributes('role')).toBeUndefined()
    wrapper.unmount()
  })
  it('says there is nobody at work when the list is empty, and no matches when the search finds none', async () => {
    useVault([])
    const empty = mountWith(sourceOf([]))
    expect(empty.text()).toContain('No agents at work')
    empty.unmount()
    const wrapper = mountWith(sourceOf(rows))
    await wrapper.get('input').setValue('nothing like this')
    expect(wrapper.text()).toContain('No matches')
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
    const opened = vi.spyOn(SuggestModal.prototype, 'open')
    try {
      const completion = openDialog('agents-tabs')
      const modal = opened.mock.contexts[0] as SuggestModal<{ label: string; waiting?: boolean }>
      // Quiet chats first: the ones that wait for you or work are last, where they are kept.
      const order = (await modal.getSuggestions('')) as { label: string; waiting?: boolean }[]
      expect(order).toHaveLength(20)
      expect(order.at(-1)?.waiting).toBe(true)
      modal.close()
      await completion
    } finally {
      ;(opened.mock.contexts[0] as SuggestModal<unknown> | undefined)?.close()
      opened.mockRestore()
    }
  })
  it('keeps the shared header entry keyboard accessible', () => {
    useVault([])
    const wrapper = mount(AgentsButton, { attachTo: document.body })
    const button = wrapper.get('button')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('disabled')).toBeUndefined()
    button.element.focus()
    expect(document.activeElement).toBe(button.element)
    expect(button.attributes('aria-label')).toContain('Agents')
    wrapper.unmount()
  })
})
