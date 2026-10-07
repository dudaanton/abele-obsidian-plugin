import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import AgentsListDialog from '@/components/AgentsListDialog.vue'
import AgentsButton from '@/components/AgentsButton.vue'
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
    expect(wrapper.findAll('.abele-agents__open')).toHaveLength(1)
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
    await wrapper.find('.abele-agents__open').trigger('click')
    await flushPromises()
    expect(source.open).toHaveBeenCalledWith(rows[0], rows[0].reasons[0])
    expect(source.markSeen).not.toHaveBeenCalled()
    expect(wrapper.find('.abele-agents__seen').element.textContent).toBe('Просмотрено')
    await wrapper.find('.abele-agents__seen').trigger('click')
    expect(source.markSeen).toHaveBeenCalledWith(rows[0], 'error-1')
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
    const original = ShellModal.prototype.open
    let modal!: ShellModal
    const opened = vi.spyOn(ShellModal.prototype, 'open').mockImplementation(function (
      this: ShellModal
    ) {
      modal = this
      original.call(this)
    })
    try {
      const completion = openDialog('agents-tabs')
      expect(document.querySelector('.modal[data-abele-fixture="agents-tabs"]')).not.toBeNull()
      modal.close()
      await completion
    } finally {
      modal?.close()
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
