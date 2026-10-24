import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EnvironmentDialog from '@/components/debugger/http/EnvironmentDialog.vue'

it.each(['cookie', 'session', 'api_key', 'password'])(
  'hides an exposed %s value and moves it only on a click',
  async (key) => {
    const environment = { name: 'dev', vars: [{ key, value: 'sample-private-value' }] }
    const file = 'http-client.env.json'
    const wrapper = mount(EnvironmentDialog, {
      props: { environment, file, fileSecrets: [{ key, file }], secrets: {} },
      global: { stubs: { Modal: { template: '<div><slot/><slot name="footer"/></div>' } } },
    })
    try {
      expect(wrapper.text()).not.toContain('sample-private-value')
      expect(
        wrapper
          .findAll('input')
          .some((input) => (input.element as HTMLInputElement).value === 'sample-private-value')
      ).toBe(false)
      expect(wrapper.emitted('move-key')).toBeUndefined()
      await wrapper
        .findAll('button')
        .find((button) => button.text() === 'Move to keys')!
        .trigger('click')
      expect(wrapper.emitted('move-key')).toEqual([[key, file]])
      expect(environment.vars[0].value).toBe('sample-private-value')
    } finally {
      wrapper.unmount()
    }
  }
)
