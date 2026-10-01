import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ProtocolWriteModal from '@/components/protocol/ProtocolWriteModal.vue'
import Button from '@/components/obsidian/Button.vue'

it('shows the exact path and complete contents as text, never markdown or HTML', () => {
  const content = '<img src="https://images.example.org/sample.png">\n' + 'sample '.repeat(4000)
  const view = mount(ProtocolWriteModal, {
    props: {
      write: {
        path: 'sample-note.md',
        current: 'before',
        content,
        mode: 'replace',
        creates: false,
      },
    },
    global: { stubs: { ObsidianModal: { template: '<div><slot/><slot name="footer"/></div>' } } },
  })
  expect(view.find('.abele-protocol-write__path').text()).toBe('sample-note.md')
  expect(view.findAll('pre')[1].element.textContent).toBe(content)
  expect(view.find('img').exists()).toBe(false)
  view.findAllComponents(Button)[0].vm.$emit('click')
  expect(view.emitted('confirm')).toBeUndefined()
  view.findAllComponents(Button)[1].vm.$emit('click')
  expect(view.emitted('confirm')).toHaveLength(1)
  view.unmount()
})
