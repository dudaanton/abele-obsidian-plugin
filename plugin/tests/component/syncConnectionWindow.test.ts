import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import ConnectionWindow from '@/components/sync/ConnectionWindow.vue'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import { historyConnection } from '@/sync/tokenHistory'
import { tokenUiFixture } from '@/testing/tokenUiFixture'

afterEach(() => {
  vi.restoreAllMocks()
  historyConnection.value = null
})

it('gives held deletes and staged settings the opened connection port', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const port = {
    settingsPrompt: {
      refresh: vi.fn(async () => {}),
      staged: ref([{ path: '.obsidian/sample.json' }]),
    },
  }
  vi.spyOn(TokenSettingsPort, 'forConnection').mockReturnValue(port as never)
  ui.runtimes.set(id, {
    heldDeletes: async () => [{ fileId: 'sample', path: 'sample.md' }],
  } as never)
  const view = mount(ConnectionWindow, {
    props: { ui, connectionId: id },
    global: {
      stubs: {
        Modal: { template: '<div><slot /><slot name="footer" /></div>' },
        HeldDeletesBlock: true,
        StagedSettingsBlock: true,
        SelectiveSync: true,
      },
    },
  })
  try {
    await flushPromises()
    expect(view.findComponent({ name: 'HeldDeletesBlock' }).props('port')).toBe(port)
    expect(view.findComponent({ name: 'StagedSettingsBlock' }).props('port')).toBe(port)
    const trust = view.findAll('.setting-item').find((one) => one.text().includes('Trusted'))!
    expect(trust.text()).toContain('incoming code')
    await trust.find('[role="checkbox"]').trigger('click')
    expect(ui.registry.records().find((one) => one.id === id)?.trusted).toBe(true)
  } finally {
    view.unmount()
  }
})

it('shows first-pull stage and counts as quiet visible text', () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  ui.publish(id, { pull: { stage: 'Receiving files', completed: 3, total: 12 } })
  const view = mount(ConnectionWindow, {
    props: { ui, connectionId: id },
    global: { stubs: { Modal: { template: '<div><slot /></div>' }, SelectiveSync: true } },
  })
  try {
    expect(view.find('.abele-sync-window__progress').text()).toBe('Receiving files · 3 of 12')
  } finally {
    view.unmount()
  }
})
