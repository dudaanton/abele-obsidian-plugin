import { afterEach, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Fixture from '@/testing/SyncInspectionFixture.vue'
import ChoiceModal from '@/components/obsidian/ChoiceModal.vue'
import { useVault } from '../helpers/testEnv'

afterEach(() => document.body.replaceChildren())
it.each(['Cancel', 'Send this device’s', 'Take the vault’s', 'native close'])(
  'closes the entire confirmation capture via %s before another dialog opens',
  async (action) => {
    useVault([])
    const view = mount(Fixture, {
      props: { area: 'sections', step: 9, onClose: () => view.unmount() },
      attachTo: document.body,
    })
    try {
      await flushPromises()
      expect(document.querySelectorAll('.modal.abele-modal')).toHaveLength(2)
      if (action === 'native close') view.getComponent(ChoiceModal).vm.$emit('close')
      else {
        const button = [
          ...document.querySelectorAll<HTMLButtonElement>('.abele-modal__footer button'),
        ].find((button) => button.textContent === action)
        expect(button).toBeDefined()
        button!.click()
      }
      await flushPromises()
      expect(document.querySelectorAll('.modal.abele-modal')).toHaveLength(0)
      const next = mount(Fixture, { props: { area: 'check', step: 1 }, attachTo: document.body })
      try {
        await flushPromises()
        expect(document.querySelectorAll('.modal.abele-modal')).toHaveLength(1)
        expect(document.querySelector('.modal.abele-modal')?.textContent).toContain(
          'Check against the server'
        )
      } finally {
        next.unmount()
      }
    } finally {
      if (view.exists()) view.unmount()
    }
  }
)
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
