import { afterEach, expect, it, vi } from 'vitest'
import { shallowRef, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import TokenReviewPrompts from '@/components/sync/TokenReviewPrompts.vue'
import { tokenUi } from '@/sync/tokenUi'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'

afterEach(() => {
  tokenUi.value = null
  vi.restoreAllMocks()
})
it('renders a held-delete question for its own connection, then a staged-settings question', async () => {
  const port = {
    heldPrompt: {
      asking: ref({ key: 1, held: [{ fileId: 'sample-file', path: 'sample.md' }] }),
      close: vi.fn(),
    },
    settingsPrompt: {
      asking: ref({ key: 2, changes: [{ path: '.obsidian/hotkeys.json' }], names: {} }),
      later: vi.fn(),
    },
  }
  vi.spyOn(TokenSettingsPort, 'forConnection').mockReturnValue(port as never)
  tokenUi.value = { rows: shallowRef([{ id: 'sample-connection' }]), questions: ref([]) } as never
  const view = mount(TokenReviewPrompts, {
    global: { stubs: { HeldDeletesModal: true, SettingsArrivedModal: true } },
  })
  await flushPromises()
  const held = view.findComponent({ name: 'HeldDeletesModal' })
  expect(held.exists()).toBe(true)
  expect(held.props('port')).toBe(port)
  held.vm.$emit('close')
  expect(port.heldPrompt.close).toHaveBeenCalledOnce()
  port.heldPrompt.asking.value = null as never
  await flushPromises()
  const settings = view.findComponent({ name: 'SettingsArrivedModal' })
  expect(settings.exists()).toBe(true)
  expect(settings.props('port')).toBe(port)
  settings.vm.$emit('close', 2)
  expect(port.settingsPrompt.later).toHaveBeenCalledWith(2)
  view.unmount()
})
