import { afterEach, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Fixture from '@/testing/TokenUiFixture.vue'
import { useVault } from '../helpers/testEnv'

afterEach(() => document.body.replaceChildren())
it('mounts the nested connection body through the real modal instead of only its shell', async () => {
  useVault([])
  const view = mount(Fixture, { props: { screen: 'connections' }, attachTo: document.body })
  try {
    await flushPromises()
    document.querySelector<HTMLElement>('.abele-sync-row')!.click()
    await flushPromises()
    expect(document.querySelector('.abele-sync-window')).not.toBeNull()
  } finally {
    view.unmount()
  }
})
