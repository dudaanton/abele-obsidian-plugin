import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Dropdown from '@/components/obsidian/Dropdown.vue'

it('keeps an explicit empty value when rebuilding options whose first value is not empty', async () => {
  const view = mount(Dropdown, {
    props: {
      modelValue: '',
      options: [
        { value: ':agent', display: 'Agent default' },
        { value: '', display: 'Off' },
      ],
    },
  })
  try {
    expect((view.find('select').element as HTMLSelectElement).value).toBe('')
    await view.setProps({
      options: [
        { value: ':agent', display: 'Agent default (Sample)' },
        { value: '', display: 'Off' },
      ],
    })
    expect((view.find('select').element as HTMLSelectElement).value).toBe('')
  } finally {
    view.unmount()
  }
})
