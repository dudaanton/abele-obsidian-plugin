import { beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { Menu } from 'obsidian'
import ChatBindingState from '@/components/ChatBindingState.vue'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
it('keeps recovery separate from execution and does not offer Retry on uncertain writes', async () => {
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const session = {
    bindingRecoveries: shallowRef([
      {
        id: 'sample',
        targetPath: 'Cards/A very long sample card title.md',
        status: 'uncertain',
        evidence: 'Inspect persisted source.',
      },
    ]),
  }
  const wrapper = mount(ChatBindingState, { props: { session: session as any } })
  expect(wrapper.text()).toContain('uncertain')
  expect(wrapper.text()).toContain('Cards/A very long sample card title.md')
  await wrapper.find('button[aria-label="Card link actions"]').trigger('click')
  const menu = show.mock.contexts[0] as unknown as { items: { title: string }[] }
  expect(menu.items.map((i) => i.title)).toContain('Open card')
  expect(menu.items.map((i) => i.title)).not.toContain('Retry binding only')
  expect(wrapper.text()).not.toContain('Run script')
  wrapper.unmount()
})
