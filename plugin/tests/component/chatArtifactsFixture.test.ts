import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { chatArtifactsFixture } from '@/testing/chatArtifactsFixture'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

vi.mock('@/components/obsidian/Modal.vue', () => ({
  default: { template: '<div><slot /><slot name="footer" /></div>' },
}))

it('creates real disposable resources for availability-based artifact layout probes', async () => {
  const app = useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  const fixture = await chatArtifactsFixture('populated')
  expect(app.vault.getFiles()).toHaveLength(3)
  const wrapper = mount(fixture)
  await flushPromises()
  expect(
    wrapper.findAll('.abele-chat-artifacts > section:not(.abele-chat-artifacts__changes)')
  ).toHaveLength(3)
  expect(wrapper.find('.abele-chat-artifacts__changes').exists()).toBe(true)
  wrapper.unmount()
  await flushPromises()
  expect(app.vault.getFiles()).toHaveLength(0)
})
