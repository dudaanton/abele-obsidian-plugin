import { afterEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { Platform } from 'obsidian'
import SharePicker from '@/components/sync/SharePicker.vue'

afterEach(() => {
  Platform.isPhone = false
})

it('switches local choices by kind on the phone and replaces the whole-vault default', async () => {
  Platform.isPhone = true
  const vault = { id: 'vault', kind: 'vault' as const, path: '/' }
  const group = { id: 'group-a', kind: 'group' as const, path: 'Reading.md' }
  const wrapper = mount(SharePicker, {
    attachTo: document.body,
    props: {
      modelValue: [vault],
      choices: [vault, group],
      vaultGivesWay: true,
      members: () => 0,
    },
  })
  try {
    await wrapper.find('input').trigger('focusin')
    expect(wrapper.find('[data-share-kind="group"]').exists()).toBe(false)
    const toggle = wrapper.findAll('.abele-share-picker__kinds .clickable-icon')[1]
    ;(toggle.element as HTMLButtonElement).focus()
    await toggle.trigger('click')
    expect(document.activeElement).toBe(wrapper.find('input').element)
    expect(wrapper.text()).toContain('no notes yet')
    await wrapper.find('[data-share-kind="group"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([[group]])
  } finally {
    wrapper.unmount()
  }
})
