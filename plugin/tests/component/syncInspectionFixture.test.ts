import { afterEach, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Fixture from '@/testing/SyncInspectionFixture.vue'
import ChoiceModal from '@/components/obsidian/ChoiceModal.vue'
import { useVault } from '../helpers/testEnv'

afterEach(() => document.body.replaceChildren())
it.each([
  ...Array.from({ length: 11 }, (_, i) => ['sections', i + 1] as const),
  ...[1, 2, 3, 4, 5, 7, 8].map((step) => ['check', step] as const),
])('mounts the %s capture state %i through the real modal', async (area, step) => {
  useVault([])
  const view = mount(Fixture, { props: { area, step }, attachTo: document.body })
  try {
    await flushPromises()
    expect(document.querySelector('.modal.abele-modal')).not.toBeNull()
    expect(document.body.textContent).toContain(
      area === 'sections' ? 'Abele settings' : 'Check against the server'
    )
    if (area === 'sections' && step === 9)
      expect(view.getComponent(ChoiceModal).props('title')).toBe('Sync Book reader again?')
  } finally {
    view.unmount()
  }
})
