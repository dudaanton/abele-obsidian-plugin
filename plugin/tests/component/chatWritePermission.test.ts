import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import ChatWritePermission from '@/components/chat/ChatWritePermission.vue'

it('shows automatic writes and lets the user restore prompting', async () => {
  const session = { permissionMode: ref('allow-edit') }
  const wrapper = mount(ChatWritePermission, { props: { session } })
  expect(wrapper.text()).toContain('Writes without asking')
  await wrapper.find('button').trigger('click')
  expect(session.permissionMode.value).toBe('confirm-all')
  expect(wrapper.find('button').exists()).toBe(false)
  wrapper.unmount()
})
